import { Injectable, Logger } from '@nestjs/common';
import { TermPostingsRepository } from '../mongodb/repositories/term-postings.repository';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { PostingEntry } from '../mongodb/schemas/term-postings.schema';
import { PostingList } from '../../index/interfaces/posting.interface';
import { SimplePostingList } from '../../index/posting-list';

@Injectable()
export class PersistentTermDictionaryService {
  private readonly logger = new Logger(PersistentTermDictionaryService.name);

  constructor(
    private readonly termPostingsRepository: TermPostingsRepository,
    private readonly rocksDBService: RocksDBService,
  ) {}

  /**
   * Restore term postings from MongoDB to RocksDB for an index
   */
  async restoreTermPostings(indexName: string): Promise<number> {
    try {
      this.logger.log(`Restoring term postings for index: ${indexName}`);

      const mongoTermPostings = await this.termPostingsRepository.findByIndex(indexName);

      if (mongoTermPostings.length === 0) {
        this.logger.debug(`No term postings found in MongoDB for index: ${indexName}`);
        return 0;
      }

      let restoredCount = 0;

      for (const termPosting of mongoTermPostings) {
        try {
          const rocksDBKey = this.getTermKey(termPosting.term);

          // Check if already exists in RocksDB
          const existingData = await this.rocksDBService.get(rocksDBKey);
          if (existingData) {
            continue; // Skip if already exists
          }

          // Convert MongoDB postings to PostingList format
          const postingList = new SimplePostingList();
          for (const [docId, posting] of Object.entries(termPosting.postings)) {
            postingList.addEntry({
              docId,
              frequency: posting.frequency,
              positions: posting.positions || [],
              metadata: posting.metadata || {},
            });
          }

          // Store in RocksDB
          const serialized = postingList.serialize();
          await this.rocksDBService.put(rocksDBKey, serialized);

          restoredCount++;
          this.logger.debug(`Restored term postings for: ${termPosting.term}`);
        } catch (error) {
          this.logger.warn(
            `Failed to restore term postings for ${termPosting.term}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Restored ${restoredCount} term postings from MongoDB to RocksDB for index: ${indexName}`,
      );
      return restoredCount;
    } catch (error) {
      this.logger.error(`Error restoring term postings for index ${indexName}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Migrate term postings from RocksDB to MongoDB for an index
   */
  async migrateTermPostings(indexName: string): Promise<number> {
    try {
      this.logger.log(`Migrating term postings for index: ${indexName}`);

      const rocksDBKeys = await this.rocksDBService.getKeysWithPrefix('term:');

      if (rocksDBKeys.length === 0) {
        this.logger.debug(`No term postings found in RocksDB for index: ${indexName}`);
        return 0;
      }

      const termPostingsData: Array<{ term: string; postings: Record<string, PostingEntry> }> = [];

      for (const key of rocksDBKeys) {
        try {
          const data = await this.rocksDBService.get(key);
          if (!data) continue;

          const term = this.extractTermFromKey(key);
          if (!term) continue;

          // Check if already exists in MongoDB
          const existingPosting = await this.termPostingsRepository.findByIndexAndTerm(
            indexName,
            term,
          );
          if (existingPosting) {
            continue; // Skip if already exists
          }

          // Convert RocksDB data to MongoDB format
          const postingList = new SimplePostingList();
          postingList.deserialize(data);

          const postings: Record<string, PostingEntry> = {};
          for (const entry of postingList.getEntries()) {
            postings[entry.docId.toString()] = {
              docId: entry.docId.toString(),
              frequency: entry.frequency,
              positions: entry.positions || [],
              metadata: entry.metadata || {},
            };
          }

          termPostingsData.push({ term, postings });
        } catch (error) {
          this.logger.warn(`Failed to migrate term postings for key ${key}: ${error.message}`);
        }
      }

      if (termPostingsData.length > 0) {
        await this.termPostingsRepository.bulkUpsert(indexName, termPostingsData);
        this.logger.log(
          `Migrated ${termPostingsData.length} term postings from RocksDB to MongoDB for index: ${indexName}`,
        );
      }

      return termPostingsData.length;
    } catch (error) {
      this.logger.error(`Error migrating term postings for index ${indexName}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Save term postings to both RocksDB and MongoDB
   */
  async saveTermPostings(indexName: string, term: string, postingList: PostingList): Promise<void> {
    try {
      // Save to RocksDB for performance
      const rocksDBKey = this.getTermKey(term);
      const serialized = postingList.serialize();
      await this.rocksDBService.put(rocksDBKey, serialized);

      // Save to MongoDB for persistence
      const postings: Record<string, PostingEntry> = {};
      for (const entry of postingList.getEntries()) {
        postings[entry.docId.toString()] = {
          docId: entry.docId.toString(),
          frequency: entry.frequency,
          positions: entry.positions || [],
          metadata: entry.metadata || {},
        };
      }

      await this.termPostingsRepository.update(indexName, term, postings);
    } catch (error) {
      this.logger.error(`Failed to save term postings for ${term}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete term postings from both RocksDB and MongoDB
   */
  async deleteTermPostings(indexName: string, term: string): Promise<void> {
    try {
      // Delete from RocksDB
      const rocksDBKey = this.getTermKey(term);
      await this.rocksDBService.delete(rocksDBKey);

      // Delete from MongoDB
      await this.termPostingsRepository.deleteByIndexAndTerm(indexName, term);
    } catch (error) {
      this.logger.error(`Failed to delete term postings for ${term}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all term postings for an index
   */
  async deleteIndexTermPostings(indexName: string): Promise<void> {
    try {
      // Delete from MongoDB
      const deletedCount = await this.termPostingsRepository.deleteByIndex(indexName);
      this.logger.log(`Deleted ${deletedCount} term postings from MongoDB for index: ${indexName}`);

      // Note: RocksDB term postings will be cleaned up when the container restarts
      // or can be cleaned up manually if needed
    } catch (error) {
      this.logger.error(`Failed to delete term postings for index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  private getTermKey(term: string): string {
    return `term:${term}`;
  }

  private extractTermFromKey(key: string): string | null {
    if (key.startsWith('term:')) {
      return key.substring(5);
    }
    return null;
  }
}
