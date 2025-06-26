import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { SerializationUtils } from '../rocksdb/serialization.utils';
import {
  Index,
  IndexMappings,
  IndexSettings,
  IndexStatus,
} from '../../index/interfaces/index.interface';
import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';
import { IndexRepository } from '../mongodb/repositories/index.repository';
import { IndexStorage } from '../../index/interfaces/index-storage.interface';

@Injectable()
export class IndexStorageService implements IndexStorage {
  private readonly logger = new Logger(IndexStorageService.name);

  constructor(
    private readonly rocksDBService: RocksDBService,
    private readonly indexRepository: IndexRepository,
  ) {}

  async getDocumentCount(indexName: string): Promise<number> {
    const index = await this.getIndex(indexName);
    return index?.documentCount || 0;
  }

  async getFields(indexName: string): Promise<string[]> {
    const index = await this.getIndex(indexName);
    if (!index?.mappings) return [];
    return Object.keys(index.mappings);
  }

  async getFieldStats(field: string): Promise<{ totalLength: number; docCount: number } | null> {
    const key = SerializationUtils.createStatsKey(field, 'field_stats');
    const data = await this.rocksDBService.get(key);
    if (!data) return null;

    const stats = SerializationUtils.deserializeIndexStats(data as Buffer);
    if (!stats || typeof stats.totalLength !== 'number' || typeof stats.docCount !== 'number') {
      return null;
    }

    return {
      totalLength: stats.totalLength,
      docCount: stats.docCount,
    };
  }

  async updateFieldStats(
    field: string,
    stats: { totalLength: number; docCount: number },
  ): Promise<void> {
    const key = SerializationUtils.createStatsKey(field, 'field_stats');
    const serialized = SerializationUtils.serializeIndexStats(stats);
    await this.rocksDBService.put(key, serialized);
  }

  async getIndex(name: string): Promise<Index | null> {
    try {
      // Try RocksDB first for performance
      const key = SerializationUtils.createIndexMetadataKey(name);
      const data: { type: 'Buffer'; data: Buffer } | any = await this.rocksDBService.get(key);

      if (data) {
        // Handle Buffer-like object
        if (data.type === 'Buffer' && Array.isArray(data.data)) {
          const buffer = Buffer.from(data.data);
          return JSON.parse(buffer.toString());
        }

        // If it's already a JavaScript object (not Buffer or string), return it directly
        if (typeof data === 'object' && data !== null && !(data instanceof Buffer)) {
          return data;
        }

        // If it's a string or Buffer
        return typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
      }

      // Fallback to MongoDB if not in RocksDB (data recovery)
      this.logger.warn(`Index ${name} not found in RocksDB, checking MongoDB for recovery`);
      const mongoIndex = await this.indexRepository.findByName(name);

      if (mongoIndex) {
        // Restore to RocksDB for future performance
        const indexData = mongoIndex.toObject();
        await this.rocksDBService.put(key, indexData);
        this.logger.log(`Restored index ${name} from MongoDB to RocksDB`);
        return indexData;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error getting index ${name}: ${error.message}`);
      // Fallback to MongoDB on RocksDB error
      try {
        const mongoIndex = await this.indexRepository.findByName(name);
        return mongoIndex ? mongoIndex.toObject() : null;
      } catch (mongoError) {
        this.logger.error(`Error getting index from MongoDB: ${mongoError.message}`);
        throw error;
      }
    }
  }

  async createIndex(
    index: Partial<Index> & { name: string; settings: IndexSettings; mappings: IndexMappings },
  ): Promise<Index> {
    this.logger.log(`Starting index creation for: ${index.name}`);

    const existingIndex = await this.getIndex(index.name);
    if (existingIndex) {
      throw new ConflictException(`Index with name ${index.name} already exists`);
    }

    const indexedIndex = {
      ...index,
      createdAt: new Date().toISOString(),
      status: 'open' as IndexStatus,
      documentCount: 0,
    };

    try {
      // Store in both RocksDB and MongoDB
      const key = SerializationUtils.createIndexMetadataKey(index.name);

      // Store in RocksDB for performance
      await this.rocksDBService.put(key, indexedIndex);

      // Store in MongoDB for persistence
      await this.indexRepository.create(indexedIndex);

      this.logger.log(`Created index ${index.name} in both RocksDB and MongoDB`);
      return indexedIndex;
    } catch (error) {
      this.logger.error(`Error creating index ${index.name}: ${error.message}`, error.stack);

      // Cleanup on failure
      try {
        const key = SerializationUtils.createIndexMetadataKey(index.name);
        await this.rocksDBService.delete(key);
        await this.indexRepository.delete(index.name);
      } catch (cleanupError) {
        this.logger.error(`Error during cleanup: ${cleanupError.message}`);
      }

      throw error;
    }
  }

  async updateIndex(name: string, updates: Partial<Index>, fromBulk = false): Promise<Index> {
    const index = await this.getIndex(name);
    if (!index) {
      throw new Error(`Index ${name} not found`);
    }

    const updatedIndex = {
      ...index,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    try {
      // Update in both RocksDB and MongoDB
      const key = SerializationUtils.createIndexMetadataKey(name);
      await this.rocksDBService.put(key, updatedIndex);
      await this.indexRepository.update(name, updatedIndex);

      if (!fromBulk) {
        this.logger.debug(`Updated index ${name} in both RocksDB and MongoDB`);
      }
      return updatedIndex;
    } catch (error) {
      this.logger.error(`Error updating index ${name}: ${error.message}`);
      throw error;
    }
  }

  async listIndices(status?: string): Promise<Index[]> {
    try {
      // Try MongoDB first for most up-to-date data
      const mongoIndices = await this.indexRepository.findAll(status);

      if (mongoIndices.length > 0) {
        // Convert to plain objects and sync to RocksDB for performance
        const indices = mongoIndices.map(doc => doc.toObject());

        // Async sync to RocksDB (don't wait for it)
        this.syncIndicesToRocksDB(indices).catch(error =>
          this.logger.warn(`Failed to sync indices to RocksDB: ${error.message}`),
        );

        return indices;
      }

      // Fallback to RocksDB if MongoDB is empty (shouldn't happen after migration)
      this.logger.warn('No indices found in MongoDB, falling back to RocksDB');
      const keys = await this.rocksDBService.getKeysWithPrefix('index:');
      const indices: Index[] = [];

      for (const key of keys) {
        const data = await this.rocksDBService.get(key);
        if (!data) continue;

        try {
          const indexData = data as Index;
          if (!this.isValidIndex(indexData)) {
            this.logger.warn(`Skipping invalid index data for key ${key}`);
            continue;
          }

          // If status is provided, filter by status
          if (status && indexData.status !== status) {
            continue;
          }

          indices.push(indexData);
        } catch (error) {
          this.logger.warn(`Failed to parse index data for key ${key}: ${error.message}`);
          continue;
        }
      }

      return indices;
    } catch (error) {
      this.logger.error(`Error listing indices: ${error.message}`);
      throw error;
    }
  }

  private async syncIndicesToRocksDB(indices: Index[]): Promise<void> {
    for (const index of indices) {
      try {
        const key = SerializationUtils.createIndexMetadataKey(index.name);
        await this.rocksDBService.put(key, index);
      } catch (error) {
        this.logger.warn(`Failed to sync index ${index.name} to RocksDB: ${error.message}`);
      }
    }
  }

  private isValidIndex(data: unknown): data is Index {
    if (typeof data !== 'object' || data === null) return false;
    const index = data as Partial<Index>;
    return (
      typeof index.name === 'string' &&
      typeof index.createdAt === 'string' &&
      typeof index.settings === 'object' &&
      typeof index.mappings === 'object' &&
      typeof index.status === 'string'
    );
  }

  async storeTermPostings(
    indexName: string,
    term: string,
    postings: Map<string, number[]>,
  ): Promise<void> {
    try {
      const key = SerializationUtils.createTermKey(indexName, term);
      const serialized = SerializationUtils.serializePostingList(postings);
      await this.rocksDBService.put(key, serialized);
    } catch (error) {
      this.logger.error(`Failed to store term postings: ${error.message}`);
      throw error;
    }
  }

  async deleteTermPostings(indexName: string, term: string): Promise<void> {
    const key = SerializationUtils.createTermKey(indexName, term);
    await this.rocksDBService.delete(key);
  }

  async getTermPostings(indexName: string, term: string): Promise<Map<string, number[]> | null> {
    try {
      const key = SerializationUtils.createTermKey(indexName, term);
      const data = await this.rocksDBService.get(key);
      if (!data) return null;
      return SerializationUtils.deserializePostingList(data as Buffer | object);
    } catch (error) {
      this.logger.error(`Failed to get term postings: ${error.message}`);
      throw error;
    }
  }

  async storeProcessedDocument(indexName: string, document: ProcessedDocument): Promise<void> {
    const key = SerializationUtils.createDocumentKey(indexName, document.id);
    const serialized = SerializationUtils.serializeDocument(document);
    await this.rocksDBService.put(key, serialized);
  }

  async getProcessedDocument(
    indexName: string,
    documentId: string,
  ): Promise<ProcessedDocument | null> {
    const key = SerializationUtils.createDocumentKey(indexName, documentId);
    const data = await this.rocksDBService.get(key);
    if (!data) return null;
    return SerializationUtils.deserializeDocument(data as Buffer);
  }

  async deleteProcessedDocument(indexName: string, documentId: string): Promise<void> {
    const key = SerializationUtils.createDocumentKey(indexName, documentId);
    await this.rocksDBService.delete(key);
  }

  async storeIndexStats(indexName: string, stats: Record<string, any>): Promise<void> {
    const key = SerializationUtils.createStatsKey(indexName, 'general');
    const serialized = SerializationUtils.serializeIndexStats(stats);
    await this.rocksDBService.put(key, serialized);
  }

  async getIndexStats(indexName: string): Promise<Record<string, any> | null> {
    const key = SerializationUtils.createStatsKey(indexName, 'general');
    const data = await this.rocksDBService.get(key);
    if (!data) return null;
    return SerializationUtils.deserializeIndexStats(data as Buffer);
  }

  /**
   * Delete an index and all its data
   */
  async deleteIndex(indexName: string): Promise<void> {
    this.logger.log(`Starting deletion of index: ${indexName}`);

    try {
      // 1. Delete the index metadata from both RocksDB and MongoDB

      const metadataKey = SerializationUtils.createIndexMetadataKey(indexName);
      await this.rocksDBService.delete(metadataKey);
      this.logger.debug(`Deleted index metadata from RocksDB: ${indexName}`);

      const mongoDeleted = await this.indexRepository.delete(indexName);
      this.logger.debug(`MongoDB deletion result for ${indexName}: ${mongoDeleted}`);

      if (!mongoDeleted) {
        this.logger.warn(`Index ${indexName} was not found in MongoDB or deletion failed`);
      }

      // Clean up all related data
      const prefixes = [
        `idx:${indexName}:`,
        `term:${indexName}:`,
        `doc:${indexName}:`,
        `stats:${indexName}:`,
        `mapping:${indexName}:`,
        `settings:${indexName}:`,
      ];

      let totalKeysDeleted = 0;
      // Delete all keys with these prefixes
      for (const prefix of prefixes) {
        const entries = await this.rocksDBService.getByPrefix(prefix);

        for (const { key } of entries) {
          await this.rocksDBService.delete(key);
          totalKeysDeleted++;
        }
      }

      this.logger.log(
        `Successfully deleted index ${indexName}: MongoDB=${mongoDeleted}, RocksDB keys=${totalKeysDeleted}`,
      );
    } catch (error) {
      this.logger.error(`Error deleting index ${indexName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all documents from an index
   */
  async getAllDocuments(indexName: string): Promise<Array<{ id: string; source: any }>> {
    const prefix = `${indexName}:document:`;
    const documents = [];

    const entries = await this.rocksDBService.getByPrefix(prefix);
    for (const { key, value } of entries) {
      const docId = key.substring(prefix.length);
      const doc = JSON.parse(value.toString());
      documents.push({
        id: docId,
        source: doc.source,
      });
    }

    return documents;
  }

  /**
   * Clear all data for an index
   */
  async clearIndex(indexName: string): Promise<void> {
    // Delete documents
    const docPrefix = `${indexName}:document:`;
    const docEntries = await this.rocksDBService.getByPrefix(docPrefix);
    for (const { key } of docEntries) {
      await this.rocksDBService.delete(key);
    }

    // Delete term postings
    const termPrefix = `${indexName}:term:`;
    const termEntries = await this.rocksDBService.getByPrefix(termPrefix);
    for (const { key } of termEntries) {
      await this.rocksDBService.delete(key);
    }
  }
}
