import { Injectable, Logger, Inject } from '@nestjs/common';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { ProcessedDocument } from '../document/interfaces/document-processor.interface';
import { TermDictionary } from '../index/term-dictionary';
import { DocumentMapping } from '../document/interfaces/document-processor.interface';
import { IndexMappings } from '../index/interfaces/index.interface';
import { IndexStorage } from '../index/interfaces/index-storage.interface';
import { SimplePostingList } from '../index/posting-list';
import { BulkIndexingService } from './services/bulk-indexing.service';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly documentProcessor: DocumentProcessorService,
    private readonly indexStats: IndexStatsService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: TermDictionary,
    @Inject('IndexStorage') private readonly indexStorage: IndexStorage,
    private readonly bulkIndexingService: BulkIndexingService,
  ) {}

  async indexDocument(
    indexName: string,
    documentId: string,
    document: any,
    fromBulk = false,
  ): Promise<void> {
    if (!fromBulk) {
      this.logger.debug(`Processing and indexing document ${documentId} in index ${indexName}`);
    }

    // 0. Get index configuration and set up document processor mapping
    const indexConfig = await this.indexStorage.getIndex(indexName);
    if (indexConfig && indexConfig.mappings && indexConfig.mappings.properties) {
      // Convert index mappings to document processor mapping format
      const documentMapping = this.convertIndexMappingsToDocumentMapping(indexConfig.mappings);
      this.documentProcessor.setMapping(documentMapping);
    } else {
      // Use automatic field detection if no mappings are configured
      this.documentProcessor.initializeDefaultMapping();
      // Also detect fields from the current document and add them to mapping
      const detectedMapping = this.detectFieldsFromDocument(document);
      this.documentProcessor.setMapping(detectedMapping);
    }

    // 1. Process the document (tokenization, normalization)
    const processedDoc = this.documentProcessor.processDocument({
      id: documentId,
      source: document,
    });

    // 2. Store the processed document
    await this.indexStorage.storeProcessedDocument(indexName, processedDoc);

    // 3. Update inverted index for each field and term
    for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
      for (const term of fieldData.terms) {
        const fieldTerm = `${field}:${term}`;
        const positions = fieldData.positions?.[term] || [];
        const frequency = fieldData.termFrequencies[term] || 1;

        // Create term entry
        const termEntry = {
          docId: documentId.toString(),
          frequency: 1,
          positions: [],
          metadata: {},
        };

        // Use index-aware term dictionary
        const indexPrefixedTerm = `${indexName}:${fieldTerm}`;
        await this.termDictionary.addPosting(indexPrefixedTerm, documentId.toString(), positions);

        // Also add to _all field for cross-field search using index-aware approach
        const allFieldTerm = `_all:${term}`;
        const indexPrefixedAllTerm = `${indexName}:${allFieldTerm}`;
        await this.termDictionary.addPosting(indexPrefixedAllTerm, documentId.toString(), []);
      }
    }

    // 4. Update index statistics
    await this.updateIndexStats(indexName, processedDoc);

    // 5. Update index metadata document count
    const indexMetadata = await this.indexStorage.getIndex(indexName);
    if (indexMetadata) {
      indexMetadata.documentCount = (indexMetadata.documentCount || 0) + 1;
      await this.indexStorage.updateIndex(indexName, indexMetadata, fromBulk);
    }
  }

  async removeDocument(indexName: string, documentId: string): Promise<void> {
    this.logger.debug(`Removing document ${documentId} from index ${indexName}`);

    // 1. Get the processed document to find its terms
    const processedDoc = await this.indexStorage.getProcessedDocument(indexName, documentId);

    if (!processedDoc) {
      this.logger.warn(
        `Document ${documentId} not found in processed document store for index ${indexName}`,
      );
      return;
    }

    // 2. Remove document from all term posting lists
    if (processedDoc.fields) {
      for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
        if (!fieldData || !fieldData.terms) continue;

        for (const term of fieldData.terms) {
          // Remove from field-specific posting list
          const fieldTerm = `${field}:${term}`;
          try {
            const postings = this.termDictionary.getPostings(fieldTerm);
            let postingList: SimplePostingList | undefined;
            if (postings) {
              postingList = new SimplePostingList();
              for (const [docId, positions] of postings.entries()) {
                postingList.addEntry({ docId, positions, frequency: positions.length });
              }
            }
            if (postingList) {
              const removed = postingList.removeEntry(documentId);
              if (removed && postingList.size() === 0) {
                await this.termDictionary.removeTerm(fieldTerm);
              }
            }

            // Also remove from _all field posting list
            const allFieldTerm = `_all:${term}`;
            const allPostings = this.termDictionary.getPostings(allFieldTerm);
            let allPostingList: SimplePostingList | undefined;
            if (allPostings) {
              allPostingList = new SimplePostingList();
              for (const [docId, positions] of allPostings.entries()) {
                allPostingList.addEntry({ docId, positions, frequency: positions.length });
              }
            }
            if (allPostingList) {
              const removed = allPostingList.removeEntry(documentId);
              if (removed && allPostingList.size() === 0) {
                await this.termDictionary.removeTerm(allFieldTerm);
              }
            }
          } catch (error) {
            this.logger.warn(
              `Error removing term ${fieldTerm} for document ${documentId}: ${error.message}`,
            );
            // Continue with next term
          }
        }
      }
    }

    try {
      // 3. Remove processed document from storage
      await this.indexStorage.deleteProcessedDocument(indexName, documentId);
    } catch (error) {
      this.logger.warn(`Error removing processed document ${documentId}: ${error.message}`);
    }

    try {
      // 4. Update index statistics (remove document stats)
      await this.indexStats.updateDocumentStats(documentId, {}, true);
    } catch (error) {
      this.logger.warn(`Error updating stats for document ${documentId}: ${error.message}`);
    }

    try {
      // 5. Update index metadata document count
      const index = await this.indexStorage.getIndex(indexName);
      if (index) {
        index.documentCount = Math.max(0, (index.documentCount || 0) - 1);
        await this.indexStorage.updateIndex(indexName, index);
      }
    } catch (error) {
      this.logger.warn(`Error updating index metadata for ${indexName}: ${error.message}`);
    }
  }

  async getProcessedDocument(
    indexName: string,
    documentId: string,
  ): Promise<ProcessedDocument | null> {
    return this.indexStorage.getProcessedDocument(indexName, documentId);
  }

  async updateAll(indexName: string): Promise<void> {
    this.logger.log(`Rebuilding entire index for ${indexName}`);

    // 1. Get all documents from storage
    const documents = await this.indexStorage.getAllDocuments(indexName);

    // 2. Clear existing index data
    await this.indexStorage.clearIndex(indexName);

    // 3. Reindex all documents
    for (const doc of documents) {
      await this.indexDocument(indexName, doc.id, doc.source);
    }

    this.logger.log(`Completed rebuilding index ${indexName}`);
  }

  private async updateIndexStats(
    indexName: string,
    processedDoc: ProcessedDocument,
  ): Promise<void> {
    // 1. Update document count
    await this.indexStats.updateDocumentStats(processedDoc.id, processedDoc.fieldLengths);

    // 3. Update term statistics for each field and term
    for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
      for (const [term, frequency] of Object.entries(fieldData.termFrequencies)) {
        const fieldTerm = `${field}:${term}`;
        await this.indexStats.updateTermStats(fieldTerm, processedDoc.id);
      }
    }
  }

  /**
   * Convert index mappings to document processor mapping format
   */
  private convertIndexMappingsToDocumentMapping(indexMappings: IndexMappings): DocumentMapping {
    const documentMapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {},
    };

    for (const [fieldName, fieldMapping] of Object.entries(indexMappings.properties)) {
      documentMapping.fields[fieldName] = {
        analyzer: fieldMapping.analyzer || 'standard',
        indexed: fieldMapping.index !== false,
        stored: fieldMapping.store !== false,
        weight: fieldMapping.boost || 1.0,
      };
    }

    return documentMapping;
  }

  /**
   * Detect fields from a document and create automatic mapping
   */
  private detectFieldsFromDocument(document: any): DocumentMapping {
    const documentMapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {},
    };

    // Recursively detect fields
    this.detectFieldsRecursive(document, '', documentMapping.fields);

    return documentMapping;
  }

  /**
   * Recursively detect fields in nested objects
   */
  private detectFieldsRecursive(obj: any, prefix: string, fields: Record<string, any>): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === 'string') {
        fields[fieldPath] = {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 1.0,
        };
      } else if (typeof value === 'number') {
        fields[fieldPath] = {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 1.0,
        };
      } else if (typeof value === 'boolean') {
        fields[fieldPath] = {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 1.0,
        };
      } else if (Array.isArray(value)) {
        // Handle arrays of strings/numbers
        if (value.length > 0 && typeof value[0] === 'string') {
          fields[fieldPath] = {
            analyzer: 'keyword',
            indexed: true,
            stored: true,
            weight: 1.0,
          };
        }
      } else if (typeof value === 'object') {
        // Recursively handle nested objects
        this.detectFieldsRecursive(value, fieldPath, fields);
      }
    }
  }

  async bulkIndexDocuments(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
  ): Promise<void> {
    this.logger.debug(
      `Queueing ${documents.length} documents for bulk indexing in index ${indexName}`,
    );

    await this.bulkIndexingService.queueBulkIndexing(indexName, documents, {
      batchSize: 1000,
      skipDuplicates: true,
      enableProgress: true,
      priority: 5,
    });
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
