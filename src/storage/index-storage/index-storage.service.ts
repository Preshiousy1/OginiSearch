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

@Injectable()
export class IndexStorageService {
  private readonly logger = new Logger(IndexStorageService.name);

  constructor(private readonly rocksDBService: RocksDBService) {}

  async getIndex(name: string): Promise<Index | null> {
    const key = SerializationUtils.createIndexMetadataKey(name);
    const data: { type: 'Buffer'; data: Buffer } | any = await this.rocksDBService.get(key);
    if (!data) return null;

    // Handle Buffer-like object
    if (data.type === 'Buffer' && Array.isArray(data.data)) {
      // Convert Buffer-like object to actual Buffer
      const buffer = Buffer.from(data.data);
      return JSON.parse(buffer.toString());
    }

    // If it's already a string or Buffer
    return typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
  }

  async createIndex(
    index: Partial<Index> & { name: string; settings: IndexSettings; mappings: IndexMappings },
  ): Promise<Index> {
    const existingIndex = await this.getIndex(index.name);
    if (existingIndex) {
      throw new ConflictException(`Index with name ${index.name} already exists`);
    }
    const indexedIndex = {
      ...index,
      createdAt: new Date(),
      status: 'open' as IndexStatus,
      documentCount: 0,
    };
    const key = SerializationUtils.createIndexMetadataKey(index.name);
    const serialized = Buffer.from(JSON.stringify(indexedIndex));
    await this.rocksDBService.put(key, serialized);
    return indexedIndex;
  }

  async updateIndex(name: string, updates: Partial<Index>): Promise<Index> {
    const index = await this.getIndex(name);
    if (!index) {
      throw new Error(`Index ${name} not found`);
    }

    const updatedIndex = { ...index, ...updates };
    const key = SerializationUtils.createIndexMetadataKey(name);
    const serialized = Buffer.from(JSON.stringify(updatedIndex));
    await this.rocksDBService.put(key, serialized);
    return updatedIndex;
  }

  async listIndices(status?: string): Promise<Index[]> {
    try {
      const keys = await this.rocksDBService.getKeysWithPrefix('index:');
      const indices: Index[] = [];

      for (const key of keys) {
        const data: { type: 'Buffer'; data: Buffer } | any = await this.rocksDBService.get(key);

        let indexData: Index;
        if (data.type === 'Buffer' && Array.isArray(data.data)) {
          // Convert Buffer-like object to actual Buffer
          const buffer = Buffer.from(data.data);
          indexData = JSON.parse(buffer.toString());
        } else if (typeof data === 'string') {
          indexData = JSON.parse(data);
        } else {
          indexData = JSON.parse(data.toString());
        }

        // If status is provided, filter by status
        if (status && indexData.status !== status) {
          continue;
        }

        indices.push(indexData);
      }

      return indices;
    } catch (error) {
      this.logger.error(`Error listing indices: ${error.message}`);
      throw error;
    }
  }

  async storeTermPostings(
    indexName: string,
    term: string,
    postings: Map<string, number[]>,
  ): Promise<void> {
    const key = SerializationUtils.createTermKey(indexName, term);
    const serialized = SerializationUtils.serializePostingList(postings);
    await this.rocksDBService.put(key, serialized);
  }

  async deleteTermPostings(indexName: string, term: string): Promise<void> {
    const key = SerializationUtils.createTermKey(indexName, term);
    await this.rocksDBService.delete(key);
  }

  async getTermPostings(indexName: string, term: string): Promise<Map<string, number[]> | null> {
    const key = SerializationUtils.createTermKey(indexName, term);
    const data = await this.rocksDBService.get(key);
    if (!data) return null;
    return SerializationUtils.deserializePostingList(data as Buffer);
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
    // 1. Delete the index metadata
    const metadataKey = SerializationUtils.createIndexMetadataKey(indexName);
    await this.rocksDBService.delete(metadataKey);

    // 2. Delete all data with this index's prefix
    const prefixes = [
      `idx:${indexName}:`,
      `term:${indexName}:`,
      `doc:${indexName}:`,
      `stats:${indexName}:`,
      `mapping:${indexName}:`,
      `settings:${indexName}:`,
    ];

    // Delete all keys with these prefixes
    for (const prefix of prefixes) {
      const entries = await this.rocksDBService.getByPrefix(prefix);
      for (const { key } of entries) {
        await this.rocksDBService.delete(key);
      }
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
