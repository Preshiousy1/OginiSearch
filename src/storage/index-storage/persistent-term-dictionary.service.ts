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
   * Load term postings from RocksDB
   * Returns null if term not found
   */
  async getTermPostings(indexAwareTerm: string): Promise<PostingList | null> {
    try {
      const rocksDBKey = this.getTermKey(indexAwareTerm);
      const data = await this.rocksDBService.get(rocksDBKey);

      if (!data) {
        return null;
      }

      const postingList = new SimplePostingList();
      postingList.deserialize(data);
      return postingList;
    } catch (error) {
      this.logger.error(
        `Failed to load term postings from RocksDB for ${indexAwareTerm}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Restore term postings from MongoDB to RocksDB for an index.
   * Chunked model: groups chunks by term, merges postings, then writes one PostingList per term.
   */
  async restoreTermPostings(indexName: string): Promise<number> {
    try {
      if (!this.rocksDBService.getAvailability()) {
        this.logger.warn(
          `RocksDB is not available, skipping term postings restoration for index: ${indexName}`,
        );
        return 0;
      }

      this.logger.log(`Restoring term postings for index: ${indexName}`);

      const chunks = await this.termPostingsRepository.findByIndex(indexName);
      if (chunks.length === 0) {
        this.logger.debug(`No term postings found in MongoDB for index: ${indexName}`);
        return 0;
      }

      // Group chunks by term and merge postings
      const byTerm = new Map<string, Record<string, PostingEntry>>();
      for (const ch of chunks) {
        const term = ch.term;
        let merged = byTerm.get(term);
        if (!merged) {
          merged = {};
          byTerm.set(term, merged);
        }
        for (const [docId, entry] of Object.entries(ch.postings || {})) {
          merged[docId] = entry;
        }
      }

      let restoredCount = 0;
      for (const [term, postings] of byTerm) {
        try {
          const rocksDBKey = this.getTermKey(term);
          const existingData = await this.rocksDBService.get(rocksDBKey);
          if (existingData) continue;

          const postingList = new SimplePostingList();
          for (const [docId, posting] of Object.entries(postings)) {
            postingList.addEntry({
              docId,
              frequency: posting.frequency,
              positions: posting.positions || [],
              metadata: posting.metadata || {},
            });
          }
          await this.rocksDBService.put(rocksDBKey, postingList.serialize());
          restoredCount++;
          this.logger.debug(`Restored term postings for: ${term}`);
        } catch (error) {
          this.logger.warn(`Failed to restore term postings for ${term}: ${error.message}`);
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

      const termPostingsData: Array<{
        indexAwareTerm: string;
        postings: Record<string, PostingEntry>;
      }> = [];

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

          termPostingsData.push({ indexAwareTerm: `${indexName}:${term}`, postings });
        } catch (error) {
          this.logger.warn(`Failed to migrate term postings for key ${key}: ${error.message}`);
        }
      }

      if (termPostingsData.length > 0) {
        await this.termPostingsRepository.bulkUpsert(termPostingsData);
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
   * Uses index-aware terms (index:field:term format)
   */
  /**
   * Save term postings to RocksDB only (immediate, fast)
   * Use this during indexing for durability without blocking on MongoDB writes
   */
  async saveTermPostingsToRocksDB(indexAwareTerm: string, postingList: PostingList): Promise<void> {
    try {
      const rocksDBKey = this.getTermKey(indexAwareTerm);
      const serialized = postingList.serialize();
      await this.rocksDBService.put(rocksDBKey, serialized);
    } catch (error) {
      this.logger.error(
        `Failed to save term postings to RocksDB for ${indexAwareTerm}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Save term postings to both RocksDB and MongoDB (full persistence)
   * Use this during async persistence jobs
   */
  async saveTermPostings(indexAwareTerm: string, postingList: PostingList): Promise<void> {
    try {
      // Save to RocksDB for performance using index-aware term
      const rocksDBKey = this.getTermKey(indexAwareTerm);
      const serialized = postingList.serialize();
      await this.rocksDBService.put(rocksDBKey, serialized);

      // Save to MongoDB for persistence using index-aware term
      const postings: Record<string, PostingEntry> = {};
      for (const entry of postingList.getEntries()) {
        postings[entry.docId.toString()] = {
          docId: entry.docId.toString(),
          frequency: entry.frequency,
          positions: entry.positions || [],
          metadata: entry.metadata || {},
        };
      }

      // Use atomic merge to safely add/update entries without overwriting existing data
      await this.termPostingsRepository.atomicMerge(indexAwareTerm, postings);
    } catch (error) {
      this.logger.error(`Failed to save term postings for ${indexAwareTerm}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load term postings from MongoDB as a PostingList.
   * IMPORTANT: Errors are NOT swallowed — they propagate to the caller.
   * Returning null on error was the root cause of data destruction: callers would
   * interpret null as "no existing data" and overwrite the entire posting list.
   */
  async getTermPostingsFromMongoDB(indexAwareTerm: string): Promise<PostingList | null> {
    const doc = await this.termPostingsRepository.findByIndexAwareTerm(indexAwareTerm);
    if (!doc || !doc.postings || Object.keys(doc.postings).length === 0) return null;
    const list = new SimplePostingList();
    for (const [docId, entry] of Object.entries(doc.postings)) {
      list.addEntry({
        docId,
        frequency: entry.frequency,
        positions: entry.positions || [],
        metadata: entry.metadata || {},
      });
    }
    return list;
  }

  /**
   * Merge multiple posting lists by docId (later entry wins for same docId).
   */
  mergePostingLists(lists: (PostingList | null | undefined)[]): PostingList {
    const merged = new SimplePostingList();
    for (const list of lists) {
      if (!list) continue;
      for (const entry of list.getEntries()) {
        merged.addEntry({ ...entry });
      }
    }
    return merged;
  }

  /**
   * Save term postings to MongoDB only.
   * Uses atomic $set merge (no read-modify-write) so a MongoDB read failure can NEVER
   * cause the existing posting list to be overwritten with a partial set.
   * This was the root cause of data loss: the old read-merge-write swallowed read errors,
   * resulting in the write replacing 46,000+ entries with just ~200 from the current batch.
   */
  async saveTermPostingsToMongoDB(indexAwareTerm: string, postingList: PostingList): Promise<void> {
    try {
      const postings: Record<string, PostingEntry> = {};
      for (const entry of postingList.getEntries()) {
        postings[entry.docId.toString()] = {
          docId: entry.docId.toString(),
          frequency: entry.frequency,
          positions: entry.positions || [],
          metadata: entry.metadata || {},
        };
      }

      // Atomic merge: uses $set with dot notation to add/update individual entries
      // in the appropriate chunk. Never reads first, so read failures cannot destroy data.
      await this.termPostingsRepository.atomicMerge(indexAwareTerm, postings);
    } catch (error) {
      this.logger.error(
        `Failed to save term postings to MongoDB for ${indexAwareTerm}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Delete term postings from both RocksDB and MongoDB
   * Uses index-aware terms (index:field:term format)
   */
  async deleteTermPostings(indexAwareTerm: string): Promise<void> {
    try {
      // Delete from RocksDB using index-aware term
      const rocksDBKey = this.getTermKey(indexAwareTerm);
      await this.rocksDBService.delete(rocksDBKey);

      // Delete from MongoDB using index-aware term
      await this.termPostingsRepository.deleteByIndexAwareTerm(indexAwareTerm);
    } catch (error) {
      this.logger.error(`Failed to delete term postings for ${indexAwareTerm}: ${error.message}`);
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
