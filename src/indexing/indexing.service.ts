import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { ProcessedDocument } from '../document/interfaces/document-processor.interface';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { PersistentTermDictionaryService } from '../storage/index-storage/persistent-term-dictionary.service';
import { DocumentMapping } from '../document/interfaces/document-processor.interface';
import { IndexMappings } from '../index/interfaces/index.interface';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { PostingEntry } from '../index/interfaces/posting.interface';

/** Safely coerce terms to string[] (array, Set, or object from serialization). */
function toTermArray(terms: any): string[] {
  if (Array.isArray(terms)) return terms;
  if (terms && typeof terms[Symbol.iterator] === 'function') return Array.from(terms);
  if (terms && typeof terms === 'object') return Object.keys(terms);
  return [];
}

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly indexStats: IndexStatsService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
    @Inject(forwardRef(() => DocumentStorageService))
    private readonly documentStorage: DocumentStorageService,
  ) {}

  async indexDocument(
    indexName: string,
    documentId: string,
    document: any,
    fromBulk = false,
    persistToMongoDB = false,
    isNewDocument?: boolean, // Optional flag: true if new, false if update, undefined to auto-detect
    batchDirtyTerms?: Set<string>, // Optional batch-local dirty tracking (no race conditions!)
    batchTermPostings?: Map<string, PostingEntry[]>, // Optional: capture postings added this batch (for persist without reading cache)
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

    // 1.5. Determine if this is a new document (for accurate count)
    // If flag not provided, check if document exists in storage
    // Note: Source documents are stored in documentStorage by DocumentService before calling indexDocument
    // So we check BEFORE processing to see if it's truly new
    let isNewDoc = isNewDocument;
    if (isNewDoc === undefined) {
      // Auto-detect: check if document exists in source storage
      // This check happens after DocumentService stores it, so we need to be careful
      // Actually, DocumentService stores it BEFORE calling indexDocument, so it will always exist
      // The proper fix is to pass the flag from DocumentService
      const existingDoc = await this.documentStorage.getDocument(indexName, documentId);
      isNewDoc = !existingDoc;
    }

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

        // Use index-aware term dictionary (add to memory + track in global dirty set)
        await this.termDictionary.addPostingForIndex(indexName, fieldTerm, termEntry);

        // Track in batch-local dirty set for RocksDB + MongoDB persistence
        const indexAwareFieldTerm = `${indexName}:${fieldTerm}`;
        if (batchDirtyTerms) {
          batchDirtyTerms.add(indexAwareFieldTerm);
        }
        if (batchTermPostings) {
          const list = batchTermPostings.get(indexAwareFieldTerm) ?? [];
          list.push(termEntry);
          batchTermPostings.set(indexAwareFieldTerm, list);
        }

        // Legacy: Only persist to MongoDB immediately if explicitly requested (backward compatibility)
        if (persistToMongoDB) {
          const fieldPostingList = await this.termDictionary.getPostingListForIndex(
            indexName,
            fieldTerm,
          );
          if (fieldPostingList) {
            await this.persistentTermDictionary.saveTermPostings(
              indexAwareFieldTerm,
              fieldPostingList,
            );
          }
        }

        // Also add to _all field for cross-field search using index-aware approach
        const allFieldTerm = `_all:${term}`;
        const allTermEntry = {
          docId: documentId.toString(),
          frequency: 1,
          positions: [],
          metadata: { field },
        };

        await this.termDictionary.addPostingForIndex(indexName, allFieldTerm, allTermEntry);

        // Track _all field in batch-local dirty set for RocksDB + MongoDB persistence
        const indexAwareAllFieldTerm = `${indexName}:${allFieldTerm}`;
        if (batchDirtyTerms) {
          batchDirtyTerms.add(indexAwareAllFieldTerm);
        }
        if (batchTermPostings) {
          const list = batchTermPostings.get(indexAwareAllFieldTerm) ?? [];
          list.push(allTermEntry);
          batchTermPostings.set(indexAwareAllFieldTerm, list);
        }

        // Legacy: Only persist _all to MongoDB immediately if explicitly requested
        if (persistToMongoDB) {
          const allPostingList = await this.termDictionary.getPostingListForIndex(
            indexName,
            allFieldTerm,
          );
          if (allPostingList) {
            await this.persistentTermDictionary.saveTermPostings(
              indexAwareAllFieldTerm,
              allPostingList,
            );
          }
        }
      }
    }

    // 4. Update index statistics
    await this.updateIndexStats(indexName, processedDoc);

    // 5. Update index metadata document count
    // Only increment if this is a new document (not an update)
    // Use atomic increment to avoid race conditions with concurrent indexing
    if (isNewDoc) {
      await this.indexStorage.incrementDocumentCount(indexName, 1);
    }
    // If document exists, it's an update - don't increment count (already counted when first indexed)
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

    // 2. Remove document from all term posting lists (index-aware: indexName:field:term)
    if (processedDoc.fields) {
      for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
        if (!fieldData) continue;
        const terms = toTermArray(fieldData.terms);
        for (const term of terms) {
          const fieldTerm = `${field}:${term}`;
          const indexAwareFieldTerm = `${indexName}:${fieldTerm}`;
          try {
            // Use index-aware lookup so we hit the correct index's posting list
            const postingList = await this.termDictionary.getPostingListForIndex(
              indexName,
              fieldTerm,
            );
            if (postingList) {
              const removed = postingList.removeEntry(documentId);
              if (removed) {
                if (postingList.size() === 0) {
                  await this.persistentTermDictionary.deleteTermPostings(indexAwareFieldTerm);
                  await this.termDictionary.removeTermForIndex(indexName, fieldTerm);
                } else {
                  await this.persistentTermDictionary.saveTermPostings(
                    indexAwareFieldTerm,
                    postingList,
                  );
                  await this.termDictionary.persistPostingListForIndex(
                    indexName,
                    fieldTerm,
                    postingList,
                  );
                }
              }
            }

            // Also remove from _all field posting list (index-aware)
            const allFieldTerm = `_all:${term}`;
            const indexAwareAllFieldTerm = `${indexName}:${allFieldTerm}`;
            const allPostingList = await this.termDictionary.getPostingListForIndex(
              indexName,
              allFieldTerm,
            );
            if (allPostingList) {
              const removed = allPostingList.removeEntry(documentId);
              if (removed) {
                if (allPostingList.size() === 0) {
                  await this.persistentTermDictionary.deleteTermPostings(indexAwareAllFieldTerm);
                  await this.termDictionary.removeTermForIndex(indexName, allFieldTerm);
                } else {
                  await this.persistentTermDictionary.saveTermPostings(
                    indexAwareAllFieldTerm,
                    allPostingList,
                  );
                  await this.termDictionary.persistPostingListForIndex(
                    indexName,
                    allFieldTerm,
                    allPostingList,
                  );
                }
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

  /**
   * Persist only dirty (modified) term postings for an index to MongoDB.
   * This is the recommended method for bulk indexing operations as it only persists
   * terms that have been modified since the last persistence, avoiding expensive re-writes.
   *
   * @param indexName The name of the index
   * @returns Number of terms persisted
   */
  async persistDirtyTermPostingsToMongoDB(indexName: string): Promise<number> {
    const dirtyTerms = this.termDictionary.getDirtyTermsForIndex(indexName);

    if (dirtyTerms.length === 0) {
      this.logger.debug(`No dirty terms to persist for index: ${indexName}`);
      return 0;
    }

    this.logger.log(
      `Persisting ${dirtyTerms.length} modified term postings to MongoDB for index: ${indexName}`,
    );

    const startTime = Date.now();
    let persistedCount = 0;
    let failedCount = 0;
    const batchSize = 100; // Process in batches to avoid memory issues

    try {
      for (let i = 0; i < dirtyTerms.length; i += batchSize) {
        const termBatch = dirtyTerms.slice(i, i + batchSize);

        await Promise.all(
          termBatch.map(async indexAwareTerm => {
            try {
              // Get posting list using the index-aware term directly
              const postingList = await this.termDictionary.getPostingListForIndex(
                indexName,
                indexAwareTerm,
                true, // isIndexAware = true
              );

              if (postingList && postingList.size() > 0) {
                // saveTermPostings calls TermPostingsRepository.update()
                // which automatically handles chunking (5000 docs per chunk)
                await this.persistentTermDictionary.saveTermPostings(indexAwareTerm, postingList);
                persistedCount++;

                if (persistedCount <= 5) {
                  this.logger.debug(
                    `Persisted dirty term ${indexAwareTerm} with ${postingList.size()} documents`,
                  );
                }
              } else {
                if (persistedCount <= 5) {
                  this.logger.debug(`No posting list found for dirty term: ${indexAwareTerm}`);
                }
              }
            } catch (error) {
              failedCount++;
              this.logger.warn(`Failed to persist dirty term ${indexAwareTerm}: ${error.message}`);
            }
          }),
        );

        // Log progress for large batches
        if (dirtyTerms.length > 1000) {
          const progress = Math.min(i + batchSize, dirtyTerms.length);
          this.logger.debug(`Persisted ${progress}/${dirtyTerms.length} dirty terms to MongoDB`);
        }
      }

      // DO NOT clear dirty terms here - causes race conditions with concurrent batches!
      // Dirty terms will be cleared after ALL batches complete via cleanup method.
      // This means some terms may be persisted multiple times, but that's OK (idempotent).
      // Better to have duplicate writes than data loss from race conditions.

      const duration = Date.now() - startTime;
      this.logger.log(
        `Successfully persisted ${persistedCount} dirty term postings to MongoDB for index: ${indexName} ` +
          `in ${duration}ms (${failedCount} failed) - dirty set retained for other concurrent batches`,
      );

      return persistedCount;
    } catch (error) {
      this.logger.error(
        `Failed to persist dirty term postings for index ${indexName}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Clear dirty terms for an index after bulk indexing completes.
   * Should only be called after ALL concurrent batches have finished processing.
   * This prevents race conditions where one batch clears terms while others are still indexing.
   *
   * @param indexName The name of the index
   */
  cleanupDirtyTermsAfterBulkIndexing(indexName: string): void {
    const dirtyCount = this.termDictionary.getDirtyTermCount(indexName);
    if (dirtyCount > 0) {
      this.logger.log(
        `Cleaning up ${dirtyCount} dirty terms for index: ${indexName} after bulk indexing completion`,
      );
      this.termDictionary.clearDirtyTermsForIndex(indexName);
    } else {
      this.logger.debug(`No dirty terms to clean up for index: ${indexName}`);
    }
  }

  /**
   * Persist ALL term postings for an index to MongoDB (full sync).
   * Use this for index rebuilds, migrations, or manual full synchronization.
   * For normal bulk indexing operations, use persistDirtyTermPostingsToMongoDB() instead.
   *
   * @param indexName The name of the index
   */
  async persistAllTermPostingsToMongoDB(indexName: string): Promise<void> {
    this.logger.log(`Persisting term postings to MongoDB for index: ${indexName}`);

    try {
      // Get all index-aware terms for this index from the term dictionary
      const indexAwareTerms = this.termDictionary.getTermsForIndex(indexName);
      this.logger.debug(`Found ${indexAwareTerms.length} index-aware terms for index ${indexName}`);

      if (indexAwareTerms.length === 0) {
        this.logger.debug(`No terms found for index: ${indexName}`);
        return;
      }

      // Log first few terms for debugging
      if (indexAwareTerms.length > 0) {
        const sampleTerms = indexAwareTerms.slice(0, 5);
        this.logger.debug(`Sample index-aware terms: ${sampleTerms.join(', ')}`);
      }

      let persistedCount = 0;
      const batchSize = 100; // Process in batches to avoid memory issues

      for (let i = 0; i < indexAwareTerms.length; i += batchSize) {
        const termBatch = indexAwareTerms.slice(i, i + batchSize);

        await Promise.all(
          termBatch.map(async indexAwareTerm => {
            try {
              // Get posting list using the index-aware term directly
              const postingList = await this.termDictionary.getPostingListForIndex(
                indexName,
                indexAwareTerm,
                true, // isIndexAware = true
              );

              if (postingList && postingList.size() > 0) {
                // Use the index-aware term directly for MongoDB storage
                await this.persistentTermDictionary.saveTermPostings(
                  indexAwareTerm, // Use full index-aware term
                  postingList,
                );
                persistedCount++;
                if (persistedCount <= 5) {
                  this.logger.debug(
                    `Persisted term ${indexAwareTerm} with ${postingList.size()} documents`,
                  );
                }
              } else {
                if (persistedCount <= 5) {
                  this.logger.debug(
                    `No posting list found for index-aware term: ${indexAwareTerm}`,
                  );
                }
              }
            } catch (error) {
              this.logger.warn(`Failed to persist term ${indexAwareTerm}: ${error.message}`);
            }
          }),
        );

        // Log progress for large batches
        if (indexAwareTerms.length > 1000) {
          const progress = Math.min(i + batchSize, indexAwareTerms.length);
          this.logger.debug(`Persisted ${progress}/${indexAwareTerms.length} terms to MongoDB`);
        }
      }

      this.logger.log(
        `Successfully persisted ${persistedCount} term postings to MongoDB for index: ${indexName}`,
      );
    } catch (error) {
      this.logger.error(`Failed to persist term postings for index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  private parseIndexAwareTerm(indexAwareTerm: string): { fieldTerm: string } {
    // Parse indexName:field:term format and return field:term
    const parts = indexAwareTerm.split(':');
    if (parts.length >= 3) {
      // Skip the first part (indexName) and rejoin the rest as field:term
      const fieldTerm = parts.slice(1).join(':');
      return { fieldTerm };
    }
    // Fallback if format is unexpected
    return { fieldTerm: indexAwareTerm };
  }
}
