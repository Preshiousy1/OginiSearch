import { Injectable, Logger } from '@nestjs/common';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { SerializationUtils } from '../rocksdb/serialization.utils';
import { ProcessedDocument } from 'src/common/interfaces/document.interface';
import {
  IndexMetadata,
  IndexConfig,
} from 'src/common/interfaces/index.interface';

@Injectable()
export class IndexStorageService {
  private readonly logger = new Logger(IndexStorageService.name);

  constructor(private readonly rocksDBService: RocksDBService) {}

  async storeTermPostings(
    indexName: string,
    term: string,
    postings: Map<string, number[]>,
  ): Promise<void> {
    const key = SerializationUtils.createTermKey(indexName, term);
    const serialized = SerializationUtils.serializePostingList(postings);
    await this.rocksDBService.put(key, serialized);
  }

  async getTermPostings(
    indexName: string,
    term: string,
  ): Promise<Map<string, number[]> | null> {
    const key = SerializationUtils.createTermKey(indexName, term);
    const data = await this.rocksDBService.get<Buffer>(key);
    if (!data) return null;
    return SerializationUtils.deserializePostingList(data);
  }

  async storeProcessedDocument(
    indexName: string,
    document: ProcessedDocument,
  ): Promise<void> {
    const key = SerializationUtils.createDocumentKey(indexName, document.id);
    const serialized = SerializationUtils.serializeDocument(document);
    await this.rocksDBService.put(key, serialized);
  }

  async getProcessedDocument(
    indexName: string,
    documentId: string,
  ): Promise<ProcessedDocument | null> {
    const key = SerializationUtils.createDocumentKey(indexName, documentId);
    const data = await this.rocksDBService.get<Buffer>(key);
    if (!data) return null;
    return SerializationUtils.deserializeDocument(data);
  }

  async storeIndexMetadata(
    indexName: string,
    metadata: IndexMetadata,
  ): Promise<void> {
    const key = SerializationUtils.createIndexMetadataKey(indexName);
    await this.rocksDBService.put(key, metadata);
  }

  async getIndexMetadata(indexName: string): Promise<IndexMetadata | null> {
    const key = SerializationUtils.createIndexMetadataKey(indexName);
    return this.rocksDBService.get<IndexMetadata>(key);
  }

  async storeIndexStats(
    indexName: string,
    statName: string,
    stats: Record<string, any>,
  ): Promise<void> {
    const key = SerializationUtils.createStatsKey(indexName, statName);
    const serialized = SerializationUtils.serializeIndexStats(stats);
    await this.rocksDBService.put(key, serialized);
  }

  async getIndexStats(
    indexName: string,
    statName: string,
  ): Promise<Record<string, any> | null> {
    const key = SerializationUtils.createStatsKey(indexName, statName);
    const data = await this.rocksDBService.get<Buffer>(key);
    if (!data) return null;
    return SerializationUtils.deserializeIndexStats(data);
  }

  async deleteProcessedDocument(
    indexName: string,
    documentId: string,
  ): Promise<void> {
    const key = SerializationUtils.createDocumentKey(indexName, documentId);
    await this.rocksDBService.delete(key);
  }

  async deleteIndex(indexName: string): Promise<void> {
    // Get all keys with this index name prefix
    const indexPrefix = `idx:${indexName}:`;
    const termPrefix = `term:${indexName}:`;
    const docPrefix = `doc:${indexName}:`;
    const statsPrefix = `stats:${indexName}:`;
    const metaKey = SerializationUtils.createIndexMetadataKey(indexName);

    // Delete all matching keys
    // Note: For a production system, we might want to do this in batches
    const indexEntries = await this.rocksDBService.getByPrefix(indexPrefix);
    const termEntries = await this.rocksDBService.getByPrefix(termPrefix);
    const docEntries = await this.rocksDBService.getByPrefix(docPrefix);
    const statsEntries = await this.rocksDBService.getByPrefix(statsPrefix);

    const allKeys = [
      ...indexEntries.map((e) => e.key),
      ...termEntries.map((e) => e.key),
      ...docEntries.map((e) => e.key),
      ...statsEntries.map((e) => e.key),
      metaKey,
    ];

    for (const key of allKeys) {
      await this.rocksDBService.delete(key);
    }

    this.logger.log(`Deleted index ${indexName} with ${allKeys.length} keys`);
  }
}
