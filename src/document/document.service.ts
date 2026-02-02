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
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { SearchQueryDto } from '../api/dtos/search.dto';
import {
  BulkIndexingService,
  BulkIndexingOptions,
} from '../indexing/services/bulk-indexing.service';

/** Safely coerce terms to string[] (array, Set, or object from serialization). */
function toTermArray(terms: any): string[] {
  if (Array.isArray(terms)) return terms;
  if (terms && typeof terms[Symbol.iterator] === 'function') return Array.from(terms);
  if (terms && typeof terms === 'object') return Object.keys(terms);
  return [];
}

@Injectable()
export class DocumentService implements OnModuleInit {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly documentStorageService: DocumentStorageService,
    private readonly indexService: IndexService,
    private readonly indexingService: IndexingService,
    private readonly searchService: SearchService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
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
      this.logger.log('SKIPPING auto-rebuild to prevent 1+ hour reindexing on container restart.');
      // DO NOT trigger full rebuild on container restart
      // The PersistentTermDictionaryService will restore what's needed
      // Use manual rebuild endpoint if explicit rebuild is needed
      // await this.rebuildIndex()
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
      enableTermPostingsPersistence?: boolean;
    } = {},
  ): Promise<{
    batchId: string;
    totalBatches: number;
    totalDocuments: number;
    status: string;
  }> {
    const {
      batchSize = 1000,
      concurrency = parseInt(process.env.INDEXING_CONCURRENCY) || 8,
      enableTermPostingsPersistence = true,
    } = options;

    try {
      this.logger.log(`Starting concurrent rebuild for index: ${indexName}`);
      this.logger.log(`Configuration: batchSize=${batchSize}, concurrency=${concurrency}`);

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
          batchSize,
          skipDuplicates: false, // For rebuild, we want to reprocess everything
          enableProgress: true,
          priority: 10, // High priority for rebuild operations
          retryAttempts: 2, // Fewer retries for rebuild to fail fast
        },
        { source: 'rebuild' }, // Add rebuild metadata
      );

      this.logger.log(
        `✅ Concurrent rebuild queued for index: ${indexName} - ${queueResult.totalBatches} batches, ${queueResult.totalDocuments} documents`,
      );

      // If term postings persistence is enabled, add a note
      if (enableTermPostingsPersistence) {
        this.logger.log(`📝 Term postings will be persisted to MongoDB after each batch`);
      }

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

    // 🧠 Smart Auto-Detection: Check if we need to configure mappings first
    await this.ensureFieldMappings(indexName, [documentDto.document]);

    // Generate ID if not provided
    const documentId = documentDto.id || uuidv4();

    // Store document in storage
    const storedDocument = await this.documentStorageService.storeDocument(indexName, {
      documentId,
      content: documentDto.document, // Store document directly as content
      metadata: documentDto.document.metadata || {}, // Extract metadata if present
    });

    // Index the document for search
    await this.indexingService.indexDocument(indexName, documentId, documentDto.document);

    return {
      id: documentId,
      index: indexName,
      version: 1, // Simple versioning for now
      found: true,
      source: documentDto.document,
    };
  }

  async bulkIndexDocuments(
    indexName: string,
    documents: IndexDocumentDto[],
  ): Promise<BulkResponseDto> {
    this.logger.log(`Bulk indexing ${documents.length} documents in ${indexName}`);
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

      // 🧠 Smart Auto-Detection: Use entire batch as sample for better detection
      await this.ensureFieldMappings(
        indexName,
        documents.map(doc => doc.document),
      );

      // Generate IDs for documents that don't have them
      const documentsWithIds = documents.map(doc => ({
        id: doc.id || uuidv4(),
        document: doc.document,
      }));

      // 🎯 Delegate All Batch Processing to BulkIndexingService
      // This eliminates duplication and uses the optimized queue-based system

      // For very small batches (< 5 documents), process synchronously for immediate response
      if (documents.length < 5) {
        this.logger.debug(`Processing ${documents.length} documents synchronously (small batch)`);
        return await this.processBatchSynchronously(indexName, documentsWithIds, startTime);
      }

      // For all other batches, delegate to BulkIndexingService with smart options
      const isRealTimeRequest = documents.length <= 20; // Threshold for real-time vs background

      const options: BulkIndexingOptions = {
        batchSize: isRealTimeRequest ? Math.min(documents.length, 10) : 100,
        skipDuplicates: true,
        enableProgress: !isRealTimeRequest,
        priority: isRealTimeRequest ? 8 : 5, // Higher priority for real-time
        retryAttempts: isRealTimeRequest ? 2 : 3,
      };

      this.logger.debug(
        `Delegating ${documents.length} documents to BulkIndexingService (${
          isRealTimeRequest ? 'real-time' : 'background'
        } mode)`,
      );

      const { batchId, status } = await this.bulkIndexingService.queueBulkIndexing(
        indexName,
        documentsWithIds,
        options,
      );

      if (!batchId) {
        // All documents were duplicates
        return {
          took: Date.now() - startTime,
          errors: false,
          items: documentsWithIds.map(doc => ({
            id: doc.id,
            index: indexName,
            success: true,
            status: 200, // OK - duplicate
          })),
          successCount: 0,
        };
      }

      // Return appropriate status based on processing mode
      const statusCode = isRealTimeRequest ? 202 : 202; // Accepted for processing
      const message = isRealTimeRequest
        ? 'Documents queued for high-priority processing'
        : 'Documents queued for background processing';

      this.logger.log(`${message}: batch ${batchId} with ${documents.length} documents`);

      return {
        took: Date.now() - startTime,
        errors: false,
        items: documentsWithIds.map(doc => ({
          id: doc.id,
          index: indexName,
          success: true,
          status: statusCode,
          batchId, // Include batch ID for tracking
        })),
        successCount: documents.length,
      };
    } catch (error) {
      this.logger.error(`Bulk indexing failed: ${error.message}`);

      // Rethrow so controller returns 404 for missing index
      if (error instanceof NotFoundException) throw error;

      // Return error response in expected format for other errors
      return {
        took: Date.now() - startTime,
        errors: true,
        items: documents.map(doc => ({
          id: doc.id || 'unknown',
          index: indexName,
          success: false,
          status: 500,
          error: error.message,
        })),
        successCount: 0,
      };
    }
  }

  /**
   * Process small batches synchronously for immediate response
   */
  private async processBatchSynchronously(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    startTime: number,
    isRebuild = false,
  ): Promise<BulkResponseDto> {
    const results = [];
    let hasErrors = false;
    let successCount = 0;

    // Process each document
    for (const doc of documents) {
      try {
        const documentId = doc.id;

        if (isRebuild) {
          // For rebuild operations, use upsert (update or insert) to avoid expensive existence checks
          await this.documentStorageService.upsertDocument(indexName, {
            documentId,
            content: doc.document, // Store document directly as content
            metadata: doc.document.metadata || {}, // Extract metadata if present
          });
        } else {
          // For normal operations, check if document exists and handle accordingly
          const existingDoc = await this.documentStorageService.getDocument(indexName, documentId);

          if (existingDoc) {
            // Document exists, update it
            await this.documentStorageService.updateDocument(
              indexName,
              documentId,
              doc.document, // Store document directly as content
              doc.document.metadata || {}, // Extract metadata if present
            );
          } else {
            // Document doesn't exist, create it
            await this.documentStorageService.storeDocument(indexName, {
              documentId,
              content: doc.document, // Store document directly as content
              metadata: doc.document.metadata || {}, // Extract metadata if present
            });
          }
        }

        // Index document (this will re-index regardless of whether it's new or updated)
        await this.indexingService.indexDocument(indexName, documentId, doc.document, true);

        results.push({
          id: documentId,
          index: indexName,
          success: true,
          status: isRebuild ? 200 : 201, // 200 for rebuild/upsert, 201 for create
        });

        successCount++;
      } catch (error) {
        hasErrors = true;
        results.push({
          id: doc.id || 'unknown',
          index: indexName,
          success: false,
          status: 400,
          error: error.message,
        });
      }
    }

    this.logger.log(`Successfully bulk indexed ${successCount} documents in ${indexName}`);

    // Persist term postings to MongoDB after bulk indexing
    try {
      await this.indexingService.persistTermPostingsToMongoDB(indexName);
      this.logger.debug(`Term postings persisted to MongoDB for index: ${indexName}`);
    } catch (error) {
      this.logger.warn(`Failed to persist term postings to MongoDB: ${error.message}`);
      // Don't fail the entire operation if MongoDB persistence fails
    }

    return {
      items: results,
      took: Date.now() - startTime,
      successCount,
      errors: hasErrors,
    };
  }

  async getDocument(indexName: string, id: string): Promise<DocumentResponseDto> {
    this.logger.log(`Getting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Retrieve document
    const document = await this.documentStorageService.getDocument(indexName, id);

    if (!document) {
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    return {
      id: id,
      index: indexName,
      version: 1,
      found: true,
      source: document.content, // Return content directly as source
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
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    // Update document
    const updatedDoc = await this.documentStorageService.updateDocument(indexName, id, document, {
      metadata: existingDoc.metadata,
    });

    // Reindex document - this will handle all tokenization and term dictionary updates
    await this.indexingService.indexDocument(indexName, id, document);

    return {
      id,
      index: indexName,
      version: 2, // Increment version on update
      found: true,
      source: document,
    };
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    this.logger.log(`Deleting document ${id} from ${indexName}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    // Get document terms before deletion
    // Term keys are index-aware (indexName:field:term) so we use removePostingForIndex
    const processedDoc = await this.indexingService.getProcessedDocument(indexName, id);
    if (processedDoc) {
      // Remove document from all term posting lists (terms may be array, Set, or object from serialization)
      for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
        const terms = toTermArray(fieldData?.terms);
        for (const term of terms) {
          const fieldTerm = `${field}:${term}`;
          await this.termDictionary.removePostingForIndex(indexName, fieldTerm, id);
        }
      }
    }

    // Delete from storage
    const deleted = await this.documentStorageService.deleteDocument(indexName, id);

    if (!deleted) {
      throw new NotFoundException(`Document with id ${id} not found in index ${indexName}`);
    }

    // Remove document from any remaining posting lists for this index (index-aware terms)
    const allTerms = this.termDictionary.getTerms();
    const indexPrefix = `${indexName}:`;
    await Promise.all(
      allTerms
        .filter(term => term.startsWith(indexPrefix))
        .map(async indexAwareTerm => {
          const fieldTerm = indexAwareTerm.slice(indexPrefix.length);
          const postingList = await this.termDictionary.getPostingListForIndex(
            indexName,
            fieldTerm,
          );
          if (postingList?.getEntry(id)) {
            await this.termDictionary.removePostingForIndex(indexName, fieldTerm, id);
          }
        }),
    );

    // Remove from index
    try {
      await this.indexingService.removeDocument(indexName, id);
    } catch (error) {
      this.logger.error(`Error removing document from index: ${error.message}`);
      // We've already deleted from storage, so we should continue and not throw
    }

    // Save term dictionary changes to disk
    await this.termDictionary.saveToDisk();
  }

  async deleteByQuery(
    indexName: string,
    query: DeleteByQueryDto,
  ): Promise<DeleteByQueryResponseDto> {
    this.logger.log(`Deleting documents by query in ${indexName}: ${JSON.stringify(query.query)}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    const startTime = Date.now();

    try {
      if (query.query.term) {
        // Extract the field and value to search for
        const field = query.query.term.field;
        const value = query.query.term.value;

        this.logger.log(`Looking for documents with ${field} containing "${value}"`);

        // Get documentIds that match the filter from document storage
        const result = await this.documentStorageService.getDocuments(indexName, {
          filter: { [field]: value },
        });

        this.logger.log(`Found ${result.documents.length} documents matching the query`);
        if (result.documents.length === 0) {
          return {
            deleted: 0,
            took: Date.now() - startTime,
            failures: [],
          };
        }

        const documentIds = result.documents.map(doc => doc.documentId);

        // Delete documents from storage
        const deleted = await this.documentStorageService.bulkDeleteDocuments(
          indexName,
          documentIds,
        );

        // Remove documents from index
        for (const id of documentIds) {
          await this.indexingService.removeDocument(indexName, id);
        }

        return {
          deleted,
          took: Date.now() - startTime,
          failures: [],
        };
      }

      // Return empty result for other query types
      return {
        deleted: 0,
        took: Date.now() - startTime,
        failures: [],
      };
    } catch (error) {
      this.logger.error(`Error deleting by query: ${error.message}`);
      throw new BadRequestException(`Invalid query: ${error.message}`);
    }
  }

  async listDocuments(
    indexName: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: Record<string, any>;
    } = {},
  ): Promise<ListDocumentsResponseDto> {
    this.logger.log(`Listing documents from ${indexName} with options: ${JSON.stringify(options)}`);

    // Check if index exists
    await this.checkIndexExists(indexName);

    const startTime = Date.now();

    // Get documents with pagination
    const { documents, total } = await this.documentStorageService.getDocuments(indexName, options);

    // Convert to response format
    const response: ListDocumentsResponseDto = {
      total,
      documents: documents.map(doc => ({
        id: doc.documentId,
        index: indexName,
        version: 1,
        found: true,
        source: doc.content,
      })),
      took: Date.now() - startTime,
    };

    return response;
  }

  private async checkIndexExists(indexName: string): Promise<void> {
    try {
      await this.indexService.getIndex(indexName);
    } catch (error) {
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
    try {
      // Get current index info
      const index = await this.indexService.getIndex(indexName);

      // Check if mappings are empty or only have default structure
      if (this.hasMeaningfulMappings(index.mappings)) {
        // Mappings already configured, no need to auto-detect
        return;
      }

      this.logger.log(
        `🧠 Auto-detecting field mappings for index ${indexName} from ${sampleDocuments.length} sample documents`,
      );

      // Analyze sample documents to detect field types
      const fieldTypes = new Map<string, string>();
      const fieldExamples = new Map<string, Set<any>>();

      for (const doc of sampleDocuments) {
        this.analyzeDocumentFields(doc, '', fieldTypes, fieldExamples);
      }

      if (fieldTypes.size === 0) {
        this.logger.warn(`No fields detected in sample documents for index ${indexName}`);
        return;
      }

      // Create intelligent mappings based on detected field types
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
      await this.indexService.updateMappings(indexName, detectedMappings);

      this.logger.log(
        `✅ Auto-configured mappings for ${fieldTypes.size} fields in index ${indexName}:`,
      );
      for (const [field, type] of fieldTypes.entries()) {
        this.logger.log(`  • ${field}: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to ensure field mappings for index ${indexName}: ${error.message}`);
      // Don't throw - continue with document processing even if auto-detection fails
    }
  }

  /**
   * Check if index has meaningful field mappings (not empty)
   */
  private hasMeaningfulMappings(mappings: any): boolean {
    if (!mappings || !mappings.properties) {
      return false;
    }

    // Check if properties object is empty or only has metadata fields
    const properties = mappings.properties;
    const meaningfulFields = Object.keys(properties).filter(
      key => !key.startsWith('_') && !key.startsWith('@'),
    );

    return meaningfulFields.length > 0;
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
        // Enhanced string type detection
        const currentType = fieldTypes.get(fieldPath);

        // Check for special string patterns
        if (this.isEmailField(key, value)) {
          fieldTypes.set(fieldPath, 'keyword');
        } else if (this.isUrlField(value)) {
          fieldTypes.set(fieldPath, 'keyword');
        } else if (this.isDateField(value)) {
          fieldTypes.set(fieldPath, 'date');
        } else if (!currentType) {
          // Determine text vs keyword based on content analysis
          fieldTypes.set(fieldPath, this.determineStringType(value));
        } else if (currentType === 'keyword' && this.determineStringType(value) === 'text') {
          fieldTypes.set(fieldPath, 'text'); // Upgrade to text if we find long strings
        }
      } else if (typeof value === 'number') {
        fieldTypes.set(fieldPath, Number.isInteger(value) ? 'integer' : 'float');
      } else if (typeof value === 'boolean') {
        fieldTypes.set(fieldPath, 'boolean');
      } else if (Array.isArray(value)) {
        // Analyze array elements
        if (value.length > 0) {
          const firstElement = value[0];
          if (typeof firstElement === 'string') {
            fieldTypes.set(fieldPath, 'keyword'); // Array of strings as keywords
          } else if (typeof firstElement === 'object') {
            fieldTypes.set(fieldPath, 'nested');
            // Also analyze nested objects in array
            value.forEach(item => {
              if (typeof item === 'object') {
                this.analyzeDocumentFields(item, fieldPath, fieldTypes, fieldExamples);
              }
            });
          }
        }
      } else if (typeof value === 'object') {
        // Recursively analyze nested objects
        fieldTypes.set(fieldPath, 'object');
        this.analyzeDocumentFields(value, fieldPath, fieldTypes, fieldExamples);
      }
    }
  }

  /**
   * Determine if a string should be indexed as 'text' or 'keyword'
   */
  private determineStringType(value: string): 'text' | 'keyword' {
    // Keyword criteria: short, no spaces, likely identifiers/tags
    if (value.length <= 50 && !value.includes(' ') && !value.includes('\n')) {
      return 'keyword';
    }

    // Text criteria: longer strings, contains spaces, sentences/paragraphs
    return 'text';
  }

  /**
   * Check if field/value indicates an email field
   */
  private isEmailField(fieldName: string, value: string): boolean {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailFieldNames = ['email', 'email_address', 'contact_email', 'user_email'];

    return emailFieldNames.includes(fieldName.toLowerCase()) || emailPattern.test(value);
  }

  /**
   * Check if value is a URL
   */
  private isUrlField(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return value.startsWith('http://') || value.startsWith('https://');
    }
  }

  /**
   * Check if value is a date string
   */
  private isDateField(value: string): boolean {
    // ISO date patterns
    const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
    if (isoPattern.test(value)) {
      return !isNaN(Date.parse(value));
    }
    return false;
  }

  /**
   * Create field mapping configuration based on detected type
   * (Enhanced version with better mapping configurations)
   */
  private createFieldMapping(fieldType: string, examples?: Set<any>): any {
    const baseMapping = {
      type: fieldType,
      store: true,
      index: true,
    };

    switch (fieldType) {
      case 'text':
        return {
          ...baseMapping,
          analyzer: 'standard',
          fields: {
            keyword: {
              type: 'keyword',
              ignore_above: 256,
            },
          },
        };
      case 'keyword':
        return {
          ...baseMapping,
          ignore_above: 256,
        };
      case 'integer':
      case 'float':
        return baseMapping;
      case 'boolean':
        return baseMapping;
      case 'date':
        return {
          ...baseMapping,
          format: 'strict_date_optional_time||epoch_millis',
        };
      case 'object':
        return {
          type: 'object',
        };
      case 'nested':
        return {
          type: 'nested',
        };
      default:
        return {
          type: 'text',
          analyzer: 'standard',
        };
    }
  }

  /**
   * Process documents directly without queue delegation
   * This method is used by the queue processor to avoid infinite loops
   */
  async processBatchDirectly(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    isRebuild = false,
  ): Promise<BulkResponseDto> {
    this.logger.log(`Processing ${documents.length} documents directly in ${indexName}`);
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

      // Ensure field mappings
      await this.ensureFieldMappings(
        indexName,
        documents.map(doc => doc.document),
      );

      // Process documents directly using the synchronous method
      return await this.processBatchSynchronously(indexName, documents, startTime, isRebuild);
    } catch (error) {
      this.logger.error(`Direct batch processing failed: ${error.message}`);

      // Return error response in expected format
      return {
        took: Date.now() - startTime,
        errors: true,
        items: documents.map(doc => ({
          id: doc.id || 'unknown',
          index: indexName,
          success: false,
          status: 500,
          error: error.message,
        })),
        successCount: 0,
      };
    }
  }

  async storeDocument(indexName: string, documentId: string, document: any): Promise<void> {
    try {
      await this.documentStorageService.storeDocument(indexName, {
        documentId,
        content: document,
        metadata: {},
      });
    } catch (error) {
      this.logger.error(`Error storing document ${documentId}: ${error.message}`);
      throw error;
    }
  }

  async updateTermDictionary(
    indexName: string,
    terms: Array<{ term: string; positions: number[] }>,
  ): Promise<void> {
    try {
      for (const { term, positions } of terms) {
        await this.termDictionary.addPosting(term, {
          docId: indexName,
          frequency: positions.length,
          positions,
        });
      }
    } catch (error) {
      this.logger.error(`Error updating term dictionary: ${error.message}`);
      throw error;
    }
  }

  async deleteAllDocuments(): Promise<void> {
    this.logger.warn('Deleting ALL documents from ALL indices');
    await this.documentStorageService.deleteAllDocuments();
  }
}
