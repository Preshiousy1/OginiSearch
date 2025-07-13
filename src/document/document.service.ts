import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { IndexService } from '../index/index.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import {
  IndexDocumentDto,
  DocumentResponseDto,
  BulkResponseDto,
  DeleteByQueryResponseDto,
  DeleteByQueryDto,
  ListDocumentsResponseDto,
} from '../api/dtos/document.dto';
import { v4 as uuidv4 } from 'uuid';
import { SearchService } from '../search/search.service';
import { IndexingService } from '../indexing/indexing.service';
import { TermDictionary } from '../index/term-dictionary';
import { SearchQueryDto, SearchResponseDto } from '../api/dtos/search.dto';
import { BulkIndexingService } from '../indexing/services/bulk-indexing.service';

@Injectable()
export class DocumentService implements OnModuleInit {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly documentStorageService: DocumentStorageService,
    private readonly indexService: IndexService,
    private readonly indexingService: IndexingService,
    private readonly searchService: SearchService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: TermDictionary,
    @Inject(forwardRef(() => BulkIndexingService))
    private readonly bulkIndexingService: BulkIndexingService,
  ) {}

  /**
   * On module initialization, check if the term dictionary is empty and rebuild if necessary
   */
  async onModuleInit() {
    if (this.termDictionary.size() === 0) {
      this.logger.log('Term dictionary is empty. This is expected for fresh container starts.');
      this.logger.log('Term dictionary will be populated as documents are indexed/searched.');
    }
  }

  /**
   * Rebuild index from existing documents in storage
   */
  async rebuildIndex(): Promise<void> {
    try {
      this.logger.log('Starting index rebuild...');

      // Get all indices
      const indices = await this.indexService.listIndices();

      for (const index of indices) {
        this.logger.log(`Rebuilding index: ${index.name}`);

        // Get all documents for this index
        const documents = await this.documentStorageService.getDocuments(index.name);
        let processed = 0;

        for (const doc of documents.documents) {
          try {
            await this.indexingService.indexDocument(index.name, doc.documentId, doc.content);
            processed++;

            if (processed % 100 === 0) {
              this.logger.log(`Processed ${processed} documents for index ${index.name}`);
            }
          } catch (error) {
            this.logger.error(
              `Failed to index document ${doc.documentId} in ${index.name}: ${error.message}`,
            );
          }
        }

        this.logger.log(`Completed rebuilding index ${index.name} with ${processed} documents`);
      }
    } catch (error) {
      this.logger.error(`Error rebuilding index: ${error.message}`);
    }
  }

  /**
   * Rebuild a specific index using concurrent job processing
   * More efficient for large datasets using job queue and workers
   */
  async rebuildSpecificIndexConcurrent(
    indexName: string,
    options: {
      batchSize?: number;
      concurrency?: number;
    } = {},
  ): Promise<{
    batchId: string;
    totalBatches: number;
    totalDocuments: number;
    status: string;
  }> {
    const config = {
      batchSize: options.batchSize || 1000,
      concurrency: options.concurrency || parseInt(process.env.INDEXING_CONCURRENCY) || 8,
    };

    try {
      this.logger.log(`Starting concurrent rebuild for index: ${indexName}`);
      this.logger.log(
        `Configuration: batchSize=${config.batchSize}, concurrency=${config.concurrency}`,
      );

      // Verify index exists
      await this.checkIndexExists(indexName);

      // Get total document count
      const totalResult = await this.documentStorageService.getDocuments(indexName, {
        limit: 1,
      });
      const totalDocuments = totalResult.total;

      this.logger.log(`Total documents to rebuild: ${totalDocuments}`);

      if (totalDocuments === 0) {
        this.logger.warn(`No documents found to rebuild for index: ${indexName}`);
        return {
          batchId: 'empty',
          totalBatches: 0,
          totalDocuments: 0,
          status: 'completed',
        };
      }

      // Get all documents to rebuild
      const allDocumentsResult = await this.documentStorageService.getDocuments(indexName, {
        limit: 0, // No limit - get all documents
      });

      // Convert to format expected by BulkIndexingService
      const documentsForQueue = allDocumentsResult.documents.map(doc => ({
        id: doc.documentId,
        document: doc.content,
      }));

      this.logger.log(`Queueing ${documentsForQueue.length} documents for concurrent rebuild`);

      // Use the existing BulkIndexingService for proper queue management and progress tracking
      const queueResult = await this.bulkIndexingService.queueBulkIndexing(
        indexName,
        documentsForQueue,
        {
          batchSize: config.batchSize,
          skipDuplicates: false, // For rebuild, we want to reprocess everything
          enableProgress: true,
          priority: 10, // High priority for rebuild operations
          retryAttempts: 2, // Fewer retries for rebuild to fail fast
        },
      );

      this.logger.log(
        `✅ Concurrent rebuild queued for index: ${indexName} - ${queueResult.totalBatches} batches, ${queueResult.totalDocuments} documents`,
      );

      return {
        batchId: queueResult.batchId,
        totalBatches: queueResult.totalBatches,
        totalDocuments: queueResult.totalDocuments,
        status: queueResult.status,
      };
    } catch (error) {
      this.logger.error(`Error in concurrent rebuild for index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  async indexDocument(
    indexName: string,
    documentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.logger.log(`Indexing document in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Smart Auto-Detection: Check if we need to configure mappings first
    await this.ensureFieldMappings(indexName, [documentDto.document]);

    // Generate ID if not provided
    const documentId = documentDto.id || uuidv4();

    // Store document in storage
    const storedDocument = await this.documentStorageService.storeDocument(indexName, {
      documentId,
      content: documentDto.document,
      metadata: documentDto.document.metadata || {},
    });

    // Index the document for search
    await this.indexingService.indexDocument(indexName, documentId, documentDto.document);

    return {
      id: documentId,
      index: indexName,
      version: 1,
      found: true,
      source: documentDto.document,
    };
  }

  async bulkIndexDocuments(
    indexName: string,
    documents: IndexDocumentDto[],
  ): Promise<BulkResponseDto> {
    this.logger.log(`Queueing ${documents.length} documents for bulk indexing in ${indexName}`);
    const startTime = Date.now();

    try {
      // Check if index exists
      await this.checkIndexExists(indexName);

      // Handle empty array
      if (documents.length === 0) {
        return {
          took: Date.now() - startTime,
          errors: false,
          items: [],
          successCount: 0,
        };
      }

      // Smart Auto-Detection: Use entire batch as sample for better detection
      await this.ensureFieldMappings(
        indexName,
        documents.map(doc => doc.document),
      );

      // Queue documents for bulk indexing
      const { batchId, totalBatches, totalDocuments } =
        await this.bulkIndexingService.queueBulkIndexing(
          indexName,
          documents.map(doc => ({
            id: doc.id || uuidv4(),
            document: doc.document,
          })),
          {
            batchSize: 1000,
            skipDuplicates: true,
            enableProgress: true,
            priority: 5,
          },
        );

      // Return immediate response with batch info
      return {
        took: Date.now() - startTime,
        errors: false,
        items: documents.map(doc => ({
          id: doc.id || uuidv4(),
          index: indexName,
          success: true,
          status: 202, // Accepted
          batchId,
        })),
        successCount: documents.length,
      };
    } catch (error) {
      this.logger.error(`Error in bulk indexing: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process small batches synchronously for immediate response
   */
  private async processBatchSynchronously(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    startTime: number,
  ): Promise<BulkResponseDto> {
    const results = [];
    let successCount = 0;

    for (const doc of documents) {
      try {
        // Store document
        await this.documentStorageService.storeDocument(indexName, {
          documentId: doc.id,
          content: doc.document,
          metadata: doc.document.metadata || {},
        });

        // Index for search
        await this.indexingService.indexDocument(indexName, doc.id, doc.document);

        results.push({
          index: {
            _index: indexName,
            _id: doc.id,
            status: 200,
          },
        });
        successCount++;
      } catch (error) {
        results.push({
          index: {
            _index: indexName,
            _id: doc.id,
            status: 500,
            error: error.message,
          },
        });
      }
    }

    return {
      took: Date.now() - startTime,
      errors: results.some(item => item.index.status !== 200),
      items: results,
      successCount,
    };
  }

  async getDocument(indexName: string, id: string): Promise<DocumentResponseDto> {
    this.logger.log(`Getting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Get document from storage
    const document = await this.documentStorageService.getDocument(indexName, id);
    if (!document) {
      throw new NotFoundException(`Document ${id} not found in index ${indexName}`);
    }

    return {
      id: document.documentId,
      index: indexName,
      version: 1,
      found: true,
      source: document.content,
    };
  }

  async updateDocument(
    indexName: string,
    id: string,
    document: Record<string, any>,
  ): Promise<DocumentResponseDto> {
    this.logger.log(`Updating document ${id} in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Check if document exists
    const existingDoc = await this.documentStorageService.getDocument(indexName, id);
    if (!existingDoc) {
      throw new NotFoundException(`Document ${id} not found in index ${indexName}`);
    }

    // Store updated document
    await this.documentStorageService.storeDocument(indexName, {
      documentId: id,
      content: document,
      metadata: document.metadata || {},
    });

    // Re-index the document
    await this.indexingService.indexDocument(indexName, id, document);

    return {
      id,
      index: indexName,
      version: 1,
      found: true,
      source: document,
    };
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    this.logger.log(`Deleting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Delete from storage
    await this.documentStorageService.deleteDocument(indexName, id);

    // Remove from search index
    await this.indexingService.removeDocument(indexName, id);
  }

  async deleteByQuery(
    indexName: string,
    query: DeleteByQueryDto,
  ): Promise<DeleteByQueryResponseDto> {
    this.logger.log(`Deleting documents by query in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Search for documents to delete
    const searchResult = (await this.searchService.search(indexName, {
      query: query.query,
      size: 10000, // Limit for safety
    })) as SearchResponseDto;

    // Extract hits from search result
    const hits = searchResult.data?.hits || [];
    const total = hits.length;

    if (total === 0) {
      return {
        took: searchResult.took || 0,
        deleted: 0,
        failures: [],
      };
    }

    // Delete found documents
    const failures = [];
    let deleted = 0;

    for (const hit of hits) {
      try {
        await this.deleteDocument(indexName, hit.id);
        deleted++;
      } catch (error) {
        failures.push({
          id: hit.id,
          error: error.message,
        });
      }
    }

    return {
      took: searchResult.took || 0,
      deleted,
      failures,
    };
  }

  async listDocuments(
    indexName: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: Record<string, any>;
    } = {},
  ): Promise<ListDocumentsResponseDto> {
    this.logger.log(`Listing documents in ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Get documents from storage
    const result = await this.documentStorageService.getDocuments(indexName, options);
    const startTime = Date.now();

    return {
      total: result.total,
      took: Date.now() - startTime,
      documents: result.documents.map(doc => ({
        id: doc.documentId,
        index: indexName,
        version: 1,
        found: true,
        source: doc.content,
      })),
    };
  }

  private async checkIndexExists(indexName: string): Promise<void> {
    const index = await this.indexService.getIndex(indexName);
    if (!index) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }
  }

  /**
   * 🧠 Smart Auto-Detection System
   *
   * Automatically detects and configures field mappings on first document upload.
   * This eliminates the need for reindexing by ensuring proper mappings are
   * configured before any documents are processed.
   *
   * @param indexName - The index to check/configure
   * @param sampleDocuments - Documents to use for field type detection
   */
  private async ensureFieldMappings(
    indexName: string,
    sampleDocuments: Record<string, any>[],
  ): Promise<void> {
    // Get current index
    const index = await this.indexService.getIndex(indexName);

    // Check if mappings need to be configured
    if (!this.hasMeaningfulMappings(index.mappings)) {
      this.logger.log(`No meaningful mappings found for ${indexName}, auto-detecting...`);

      // Analyze field types from sample documents
      const fieldTypes = new Map<string, string>();
      const fieldExamples = new Map<string, Set<any>>();

      for (const doc of sampleDocuments) {
        this.analyzeDocumentFields(doc, '', fieldTypes, fieldExamples);
      }

      // Create mappings
      const detectedMappings = {
        dynamic: true,
        properties: {} as Record<string, any>,
      };

      for (const [fieldPath, fieldType] of fieldTypes.entries()) {
        detectedMappings.properties[fieldPath] = this.createFieldMapping(
          fieldType,
          fieldExamples.get(fieldPath),
        );
      }

      // Update index with detected mappings
      const updatedSettings = {
        ...index.settings,
        mappings: detectedMappings,
      };
      await this.indexService.updateIndex(indexName, updatedSettings);
      this.logger.log(`Auto-detected and configured mappings for ${fieldTypes.size} fields`);
    }
  }

  /**
   * Check if index has meaningful field mappings (not empty)
   */
  private hasMeaningfulMappings(mappings: any): boolean {
    if (!mappings || !mappings.properties) return false;
    return Object.keys(mappings.properties).length > 0;
  }

  /**
   * Recursively analyze document fields to detect types
   * (Enhanced version of IndexService method with better detection logic)
   */
  private analyzeDocumentFields(
    obj: any,
    prefix: string,
    fieldTypes: Map<string, string>,
    fieldExamples: Map<string, Set<any>>,
  ): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        continue;
      }

      // Initialize examples set if not exists
      if (!fieldExamples.has(fieldPath)) {
        fieldExamples.set(fieldPath, new Set());
      }
      fieldExamples.get(fieldPath)!.add(value);

      if (typeof value === 'string') {
        // Special field type detection
        if (this.isEmailField(key, value)) {
          fieldTypes.set(fieldPath, 'keyword');
        } else if (this.isUrlField(value)) {
          fieldTypes.set(fieldPath, 'keyword');
        } else if (this.isDateField(value)) {
          fieldTypes.set(fieldPath, 'date');
        } else {
          fieldTypes.set(fieldPath, this.determineStringType(value));
        }
      } else if (typeof value === 'number') {
        fieldTypes.set(fieldPath, Number.isInteger(value) ? 'integer' : 'float');
      } else if (typeof value === 'boolean') {
        fieldTypes.set(fieldPath, 'boolean');
      } else if (value instanceof Date) {
        fieldTypes.set(fieldPath, 'date');
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          this.analyzeDocumentFields({ array: value[0] }, fieldPath, fieldTypes, fieldExamples);
        }
      } else if (typeof value === 'object') {
        this.analyzeDocumentFields(value, fieldPath, fieldTypes, fieldExamples);
      }
    }
  }

  /**
   * Determine if a string should be indexed as 'text' or 'keyword'
   */
  private determineStringType(value: string): 'text' | 'keyword' {
    // Use 'keyword' for short strings without spaces
    if (value.length <= 50 && !value.includes(' ')) {
      return 'keyword';
    }
    // Use 'text' for longer strings or those containing spaces
    return 'text';
  }

  /**
   * Check if field/value indicates an email field
   */
  private isEmailField(fieldName: string, value: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (
      (fieldName.toLowerCase().includes('email') || fieldName.toLowerCase().includes('mail')) &&
      emailRegex.test(value)
    );
  }

  /**
   * Check if value is a URL
   */
  private isUrlField(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if value is a date string
   */
  private isDateField(value: string): boolean {
    // Check for ISO date format
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return true;
    }
    // Check for timestamp
    if (/^\d{13}$/.test(value)) {
      return true;
    }
    return false;
  }

  /**
   * Create field mapping configuration based on detected type
   * (Enhanced version with better mapping configurations)
   */
  private createFieldMapping(fieldType: string, examples?: Set<any>): any {
    const mapping: any = { type: fieldType };

    switch (fieldType) {
      case 'text':
        mapping.analyzer = 'standard';
        break;
      case 'keyword':
        mapping.index = true;
        break;
      case 'date':
        mapping.format = 'strict_date_optional_time||epoch_millis';
        break;
      case 'integer':
      case 'float':
        mapping.index = true;
        break;
      case 'boolean':
        mapping.index = true;
        break;
    }

    return mapping;
  }

  async storeDocument(indexName: string, documentId: string, document: any): Promise<void> {
    this.logger.debug(`Storing document ${documentId} in index ${indexName}`);
    await this.documentStorageService.storeDocument(indexName, {
      documentId,
      content: document,
    });
  }

  async updateTermDictionary(indexName: string, terms: Map<string, any>): Promise<void> {
    this.logger.debug(`Updating term dictionary for index ${indexName}`);
    for (const [term, data] of terms.entries()) {
      const indexPrefixedTerm = `${indexName}:${term}`;
      await this.termDictionary.addTerm(indexPrefixedTerm);
      if (data.positions) {
        await this.termDictionary.addPosting(indexPrefixedTerm, data.docId, data.positions);
      }
    }
  }

  async processBatchDirectly(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    isRebuild = false,
  ): Promise<{ successCount: number; failureCount: number; errors: any[] }> {
    const errors: Array<{ documentId: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      // Check if index exists
      await this.checkIndexExists(indexName);

      // Smart Auto-Detection: Check if we need to configure mappings first
      await this.ensureFieldMappings(
        indexName,
        documents.map(doc => doc.document),
      );

      // Process documents in smaller sub-batches for better error handling
      const subBatchSize = 100;
      for (let i = 0; i < documents.length; i += subBatchSize) {
        const subBatch = documents.slice(i, i + subBatchSize);

        try {
          // Store documents in PostgreSQL
          const storageResult = await this.documentStorageService.bulkStoreDocuments(
            indexName,
            subBatch.map(doc => ({
              documentId: doc.id,
              content: doc.document,
              metadata: doc.document.metadata,
            })),
            { skipDuplicates: false },
          );

          // Update success/failure counts
          successCount += subBatch.length - storageResult.errors.length;
          failureCount += storageResult.errors.length;
          errors.push(...storageResult.errors);

          // Process for search indexing
          await this.indexingService.bulkIndexDocuments(indexName, subBatch);
        } catch (error) {
          this.logger.error(`Error processing sub-batch: ${error.message}`);
          failureCount += subBatch.length;
          subBatch.forEach(doc => {
            errors.push({
              documentId: doc.id,
              error: error.message,
            });
          });
        }
      }

      return { successCount, failureCount, errors };
    } catch (error) {
      this.logger.error(`Error in processBatchDirectly: ${error.message}`);
      return {
        successCount: 0,
        failureCount: documents.length,
        errors: documents.map(doc => ({
          documentId: doc.id,
          error: error.message,
        })),
      };
    }
  }
}
