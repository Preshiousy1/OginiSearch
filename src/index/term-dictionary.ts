import { PostingEntry, PostingList, TermDictionary } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';

const BATCH_SIZE = 1000;
const TERM_PREFIX = 'term:';
const TERM_LIST_KEY = 'term_list';

export interface TermDictionaryOptions {
  useCompression?: boolean;
  persistToDisk?: boolean;
}

@Injectable()
export class InMemoryTermDictionary implements TermDictionary, OnModuleInit {
  private dictionary: Map<string, PostingList> = new Map();
  private options: TermDictionaryOptions;
  private readonly logger = new Logger(InMemoryTermDictionary.name);
  private rocksDBService?: RocksDBService;
  private initialized = false;
  private termList: Set<string> = new Set();

  constructor(options: TermDictionaryOptions = {}, rocksDBService?: RocksDBService) {
    this.options = {
      useCompression: true,
      persistToDisk: true,
      ...options,
    };
    this.rocksDBService = rocksDBService;
  }

  async onModuleInit() {
    if (this.options.persistToDisk && this.rocksDBService) {
      try {
        await this.loadTermList();
        this.initialized = true;
      } catch (err) {
        this.logger.warn(`Failed to load term list: ${err.message}`);
        this.initialized = true;
      }
    } else {
      this.initialized = true;
    }
  }

  private async loadTermList() {
    if (!this.rocksDBService) return;

    try {
      const data = await this.rocksDBService.get(TERM_LIST_KEY);
      if (data) {
        let terms;

        // Handle data based on its type
        if (data.type === 'Buffer' && Array.isArray(data.data)) {
          // Convert Buffer-like object to actual Buffer
          const buffer = Buffer.from(data.data);
          terms = JSON.parse(buffer.toString());
        } else if (typeof data === 'object' && data !== null && !(data instanceof Buffer)) {
          // If it's already a JavaScript object, use it directly
          terms = data;
        } else {
          // If it's a string or Buffer
          terms = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
        }

        this.termList = new Set(terms);
        this.logger.log(`Loaded ${this.termList.size} terms from term list`);
      }
    } catch (error) {
      if (error.code !== 'NOT_FOUND') {
        this.logger.error(`Failed to load term list: ${error.message}`);
      }
    }
  }

  private async saveTermList() {
    if (!this.rocksDBService) return;

    try {
      const terms = Array.from(this.termList);
      await this.rocksDBService.put(TERM_LIST_KEY, Buffer.from(JSON.stringify(terms)));
    } catch (error) {
      this.logger.error(`Failed to save term list: ${error.message}`);
    }
  }

  private getTermKey(term: string): string {
    return `${TERM_PREFIX}${term}`;
  }

  async addTerm(term: string): Promise<PostingList> {
    this.ensureInitialized();

    if (!this.dictionary.has(term)) {
      const postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();

      // Try to load existing postings if they exist
      if (this.options.persistToDisk && this.rocksDBService) {
        try {
          const data = await this.rocksDBService.get(this.getTermKey(term));
          if (data) {
            postingList.deserialize(data);
          }
        } catch (error) {
          if (error.code !== 'NOT_FOUND') {
            this.logger.warn(`Failed to load postings for term ${term}: ${error.message}`);
          }
        }
      }

      this.dictionary.set(term, postingList);
      this.termList.add(term);

      if (this.options.persistToDisk && this.rocksDBService) {
        await this.saveTermList();
      }
    }

    return this.dictionary.get(term);
  }

  async getPostingList(term: string): Promise<PostingList | undefined> {
    this.ensureInitialized();

    if (!this.dictionary.has(term) && this.termList.has(term)) {
      await this.addTerm(term);
    }

    return this.dictionary.get(term);
  }

  hasTerm(term: string): boolean {
    this.ensureInitialized();
    return this.termList.has(term);
  }

  async removeTerm(term: string): Promise<boolean> {
    this.ensureInitialized();

    const result = this.dictionary.delete(term);
    this.termList.delete(term);

    if (result && this.options.persistToDisk && this.rocksDBService) {
      try {
        await this.rocksDBService.delete(this.getTermKey(term));
        await this.saveTermList();
      } catch (error) {
        this.logger.error(`Failed to remove term ${term} from storage: ${error.message}`);
      }
    }

    return result;
  }

  getTerms(): string[] {
    this.ensureInitialized();
    return Array.from(this.termList);
  }

  size(): number {
    this.ensureInitialized();
    return this.termList.size;
  }

  async addPosting(term: string, entry: PostingEntry): Promise<void> {
    this.ensureInitialized();

    const postingList = await this.addTerm(term);
    postingList.addEntry(entry);

    if (this.options.persistToDisk && this.rocksDBService) {
      try {
        const serialized = postingList.serialize();
        await this.rocksDBService.put(this.getTermKey(term), serialized);
      } catch (error) {
        this.logger.error(`Failed to persist postings for term ${term}: ${error.message}`);
      }
    }
  }

  async removePosting(term: string, docId: number | string): Promise<boolean> {
    const postingList = await this.getPostingList(term);
    if (!postingList) {
      return false;
    }

    const removed = postingList.removeEntry(docId);

    if (removed && this.options.persistToDisk && this.rocksDBService) {
      try {
        if (postingList.size() === 0) {
          await this.removeTerm(term);
        } else {
          const serialized = postingList.serialize();
          await this.rocksDBService.put(this.getTermKey(term), serialized);
        }
      } catch (error) {
        this.logger.error(`Failed to update postings for term ${term}: ${error.message}`);
      }
    }

    return removed;
  }

  private ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Term dictionary not initialized');
    }
  }

  // These methods are now deprecated as we use per-term storage
  serialize(): Buffer {
    throw new Error('Bulk serialization is deprecated');
  }

  deserialize(data: Buffer | Record<string, any>): void {
    throw new Error('Bulk deserialization is deprecated');
  }

  /**
   * Get term statistics including document frequency
   */
  getTermStats(term: string): { term: string; docFreq: number } | undefined {
    const postingList = this.dictionary.get(term);
    if (!postingList) {
      return undefined;
    }

    return {
      term,
      docFreq: postingList.size(),
    };
  }

  /**
   * Get multiple posting lists at once for efficient retrieval
   */
  getPostingLists(terms: string[]): Map<string, PostingList> {
    const result = new Map<string, PostingList>();

    for (const term of terms) {
      const postingList = this.dictionary.get(term);
      if (postingList) {
        result.set(term, postingList);
      }
    }

    return result;
  }

  /**
   * Save the current state to disk
   */
  async saveToDisk(): Promise<void> {
    if (!this.options.persistToDisk || !this.rocksDBService) {
      return;
    }

    try {
      // Save term list
      await this.saveTermList();

      // Save each term's posting list
      await Promise.all(
        Array.from(this.dictionary.entries()).map(async ([term, postingList]) => {
          const key = this.getTermKey(term);
          const serialized = postingList.serialize();
          await this.rocksDBService.put(key, serialized);
        }),
      );

      this.logger.log('Term dictionary saved to disk successfully');
    } catch (error) {
      this.logger.error(`Failed to save term dictionary to disk: ${error.message}`);
      throw error;
    }
  }
}
