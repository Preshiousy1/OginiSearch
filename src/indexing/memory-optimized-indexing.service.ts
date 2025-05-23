import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import { ProcessedDocument } from '../document/interfaces/document-processor.interface';
import { MemoryManager, MemoryManagerOptions, MemoryUtils } from '../index/memory-manager';

@Injectable()
export class MemoryOptimizedIndexingService implements OnModuleDestroy {
  private readonly logger = new Logger(MemoryOptimizedIndexingService.name);
  private memoryManager: MemoryManager;
  private documentCache = new Map<string, ProcessedDocument>();
  private pendingOperations = new Map<string, Promise<void>>();

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly indexStats: IndexStatsService,
  ) {
    const memoryOptions: MemoryManagerOptions = {
      maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE || '5000', 10),
      evictionThreshold: parseFloat(process.env.EVICTION_THRESHOLD || '0.8'),
      gcInterval: parseInt(process.env.GC_INTERVAL || '60000', 10), // 60 seconds
      memoryMonitoringInterval: parseInt(process.env.MEMORY_MONITOR_INTERVAL || '30000', 10), // 30 seconds
    };

    this.memoryManager = new MemoryManager(memoryOptions);
  }

  onModuleDestroy() {
    this.memoryManager.cleanup();
    this.documentCache.clear();
    this.pendingOperations.clear();
  }

  async indexDocument(indexName: string, documentId: string, document: any): Promise<void> {
    const operationKey = `${indexName}:${documentId}:index`;

    // Prevent concurrent operations on the same document
    if (this.pendingOperations.has(operationKey)) {
      await this.pendingOperations.get(operationKey);
      return;
    }

    const operation = this.performIndexOperation(indexName, documentId, document);
    this.pendingOperations.set(operationKey, operation);

    try {
      await operation;
    } finally {
      this.pendingOperations.delete(operationKey);
    }
  }

  private async performIndexOperation(
    indexName: string,
    documentId: string,
    document: any,
  ): Promise<void> {
    this.logger.debug(`Processing and indexing document ${documentId} in index ${indexName}`);

    try {
      // Clear any circular references before processing
      const cleanDocument = this.sanitizeDocument(document);

      // 1. Process the document with memory optimization
      const processedDoc = await this.processDocumentSafely({
        id: documentId,
        source: cleanDocument,
      });

      // 2. Store the processed document with chunked processing
      await this.storeProcessedDocumentSafely(indexName, processedDoc);

      // 3. Update inverted index with memory management
      await this.updateInvertedIndexSafely(indexName, processedDoc);

      // 4. Update statistics
      await this.updateIndexStatsSafely(indexName, processedDoc);

      // 5. Update index metadata
      await this.updateIndexMetadataSafely(indexName, 1);

      // 6. Cache management
      this.manageCacheSize(indexName, documentId, processedDoc);

      this.logger.debug(`Successfully indexed document ${documentId} in index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to index document ${documentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async removeDocument(indexName: string, documentId: string): Promise<void> {
    const operationKey = `${indexName}:${documentId}:remove`;

    if (this.pendingOperations.has(operationKey)) {
      await this.pendingOperations.get(operationKey);
      return;
    }

    const operation = this.performRemoveOperation(indexName, documentId);
    this.pendingOperations.set(operationKey, operation);

    try {
      await operation;
    } finally {
      this.pendingOperations.delete(operationKey);
    }
  }

  private async performRemoveOperation(indexName: string, documentId: string): Promise<void> {
    this.logger.debug(`Removing document ${documentId} from index ${indexName}`);

    try {
      // 1. Get processed document
      const processedDoc = await this.indexStorage.getProcessedDocument(indexName, documentId);

      if (!processedDoc) {
        this.logger.warn(`Document ${documentId} not found in index ${indexName}`);
        return;
      }

      // 2. Remove from inverted index with memory management
      await this.removeFromInvertedIndexSafely(indexName, documentId, processedDoc);

      // 3. Remove processed document
      await this.indexStorage.deleteProcessedDocument(indexName, documentId);

      // 4. Update statistics
      await this.indexStats.updateDocumentStats(documentId, {}, true);

      // 5. Update index metadata
      await this.updateIndexMetadataSafely(indexName, -1);

      // 6. Clean up cache
      this.documentCache.delete(`${indexName}:${documentId}`);

      this.logger.debug(`Successfully removed document ${documentId} from index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to remove document ${documentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private sanitizeDocument(document: any): any {
    try {
      // Create a deep copy to avoid modifying original
      const copy = JSON.parse(JSON.stringify(document));

      // Clear circular references
      MemoryUtils.clearCircularReferences(copy);

      return copy;
    } catch (error) {
      this.logger.warn(`Failed to sanitize document: ${error.message}`);
      return document;
    }
  }

  private async processDocumentSafely(doc: {
    id: string;
    source: any;
  }): Promise<ProcessedDocument> {
    try {
      return this.documentProcessor.processDocument(doc);
    } catch (error) {
      this.logger.error(`Document processing failed for ${doc.id}: ${error.message}`);
      throw error;
    }
  }

  private async storeProcessedDocumentSafely(
    indexName: string,
    document: ProcessedDocument,
  ): Promise<void> {
    try {
      await this.indexStorage.storeProcessedDocument(indexName, document);
    } catch (error) {
      this.logger.error(`Failed to store processed document: ${error.message}`);
      throw error;
    }
  }

  private async updateInvertedIndexSafely(
    indexName: string,
    processedDoc: ProcessedDocument,
  ): Promise<void> {
    const fields = Object.entries(processedDoc.fields || {});

    // Process fields in chunks to avoid memory spikes
    await MemoryUtils.chunkedProcessing(
      fields,
      async ([field, fieldData]) => {
        if (!fieldData || !fieldData.terms) return;

        // Process terms in smaller chunks
        const terms = Array.from(fieldData.terms);
        await MemoryUtils.chunkedProcessing(
          terms,
          async term => {
            await this.indexTermSafely(indexName, field, term, processedDoc.id, fieldData);
          },
          50, // Smaller chunk size for terms
        );
      },
      10, // Process 10 fields at a time
    );
  }

  private async indexTermSafely(
    indexName: string,
    field: string,
    term: string,
    documentId: string,
    fieldData: any,
  ): Promise<void> {
    try {
      const fieldTerm = `${field}:${term}`;
      const positions = fieldData.positions?.[term] || [];

      // Handle field-specific posting list
      await this.updateTermPostingList(indexName, fieldTerm, documentId, positions);

      // Handle _all field posting list
      const allFieldTerm = `_all:${term}`;
      await this.updateTermPostingList(indexName, allFieldTerm, documentId, positions);
    } catch (error) {
      this.logger.warn(`Failed to index term ${field}:${term}: ${error.message}`);
      // Continue with other terms rather than failing the entire operation
    }
  }

  private async updateTermPostingList(
    indexName: string,
    fieldTerm: string,
    documentId: string,
    positions: number[],
  ): Promise<void> {
    try {
      const postings = (await this.indexStorage.getTermPostings(indexName, fieldTerm)) || new Map();
      postings.set(documentId, positions);
      await this.indexStorage.storeTermPostings(indexName, fieldTerm, postings);
    } catch (error) {
      this.logger.warn(`Failed to update posting list for ${fieldTerm}: ${error.message}`);
    }
  }

  private async removeFromInvertedIndexSafely(
    indexName: string,
    documentId: string,
    processedDoc: ProcessedDocument,
  ): Promise<void> {
    if (!processedDoc.fields) return;

    const fields = Object.entries(processedDoc.fields);

    // Process removal in chunks
    await MemoryUtils.chunkedProcessing(
      fields,
      async ([field, fieldData]) => {
        if (!fieldData || !fieldData.terms) return;

        const terms = Array.from(fieldData.terms);
        await MemoryUtils.chunkedProcessing(
          terms,
          async term => {
            await this.removeTermSafely(indexName, field, term, documentId);
          },
          50,
        );
      },
      10,
    );
  }

  private async removeTermSafely(
    indexName: string,
    field: string,
    term: string,
    documentId: string,
  ): Promise<void> {
    try {
      const fieldTerm = `${field}:${term}`;
      await this.removeFromTermPostingList(indexName, fieldTerm, documentId);

      const allFieldTerm = `_all:${term}`;
      await this.removeFromTermPostingList(indexName, allFieldTerm, documentId);
    } catch (error) {
      this.logger.warn(`Failed to remove term ${field}:${term}: ${error.message}`);
    }
  }

  private async removeFromTermPostingList(
    indexName: string,
    fieldTerm: string,
    documentId: string,
  ): Promise<void> {
    try {
      const postings = await this.indexStorage.getTermPostings(indexName, fieldTerm);

      if (postings && postings.has(documentId)) {
        postings.delete(documentId);

        if (postings.size === 0) {
          await this.indexStorage.deleteTermPostings(indexName, fieldTerm);
        } else {
          await this.indexStorage.storeTermPostings(indexName, fieldTerm, postings);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to remove from posting list ${fieldTerm}: ${error.message}`);
    }
  }

  private async updateIndexStatsSafely(
    indexName: string,
    processedDoc: ProcessedDocument,
  ): Promise<void> {
    try {
      await this.indexStats.updateDocumentStats(processedDoc.id, processedDoc.fieldLengths || {});

      // Update term statistics
      for (const [field, fieldData] of Object.entries(processedDoc.fields || {})) {
        for (const [term, frequency] of Object.entries(fieldData.termFrequencies || {})) {
          const fieldTerm = `${field}:${term}`;
          await this.indexStats.updateTermStats(fieldTerm, processedDoc.id);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to update index stats: ${error.message}`);
    }
  }

  private async updateIndexMetadataSafely(indexName: string, countChange: number): Promise<void> {
    try {
      const index = await this.indexStorage.getIndex(indexName);
      if (index) {
        index.documentCount = Math.max(0, (index.documentCount || 0) + countChange);
        await this.indexStorage.updateIndex(indexName, index);
      }
    } catch (error) {
      this.logger.warn(`Failed to update index metadata: ${error.message}`);
    }
  }

  private manageCacheSize(
    indexName: string,
    documentId: string,
    processedDoc: ProcessedDocument,
  ): void {
    const cacheKey = `${indexName}:${documentId}`;

    // Add to cache
    this.documentCache.set(cacheKey, processedDoc);

    // Check if cache needs cleaning
    if (this.memoryManager.shouldEvict()) {
      this.evictOldestCacheEntries();
    }

    // Update memory manager stats
    this.memoryManager.updateStats(
      this.documentCache.size,
      0, // These would be tracked separately in a real implementation
      0,
      0,
    );
  }

  private evictOldestCacheEntries(): void {
    const entries = Array.from(this.documentCache.entries());
    const toEvict = Math.floor(entries.length * 0.2); // Evict 20% of entries

    for (let i = 0; i < toEvict; i++) {
      const [key] = entries[i];
      this.documentCache.delete(key);
    }

    this.logger.debug(`Evicted ${toEvict} entries from document cache`);
  }

  getMemoryStats() {
    return {
      ...this.memoryManager.getMemoryStats(),
      documentCacheSize: this.documentCache.size,
      pendingOperations: this.pendingOperations.size,
    };
  }
}
