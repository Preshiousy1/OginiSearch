import { PostingEntry, PostingList, TermDictionary } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';

export interface TermDictionaryOptions {
  useCompression?: boolean;
  persistToDisk?: boolean;
}

export class InMemoryTermDictionary implements TermDictionary {
  private dictionary: Map<string, PostingList> = new Map();
  private options: TermDictionaryOptions;
  private readonly logger = new Logger(InMemoryTermDictionary.name);
  private rocksDBService?: RocksDBService;

  constructor(options: TermDictionaryOptions = {}, rocksDBService?: RocksDBService) {
    this.options = {
      useCompression: true,
      persistToDisk: true,
      ...options,
    };
    this.rocksDBService = rocksDBService;

    // Attempt to load dictionary from persistent storage on startup
    if (this.options.persistToDisk && this.rocksDBService) {
      this.loadFromDisk().catch(err => {
        this.logger.warn(`Failed to load term dictionary from disk: ${err.message}`);
      });
    }
  }

  addTerm(term: string): PostingList {
    if (!this.dictionary.has(term)) {
      const postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();
      this.dictionary.set(term, postingList);

      // Persist the updated dictionary if enabled
      if (this.options.persistToDisk && this.rocksDBService) {
        this.saveToDisk().catch(err => {
          this.logger.warn(`Failed to persist term dictionary: ${err.message}`);
        });
      }
    }
    return this.dictionary.get(term);
  }

  getPostingList(term: string): PostingList | undefined {
    return this.dictionary.get(term);
  }

  hasTerm(term: string): boolean {
    return this.dictionary.has(term);
  }

  removeTerm(term: string): boolean {
    const result = this.dictionary.delete(term);

    // Persist the updated dictionary if enabled
    if (result && this.options.persistToDisk && this.rocksDBService) {
      this.saveToDisk().catch(err => {
        this.logger.warn(`Failed to persist term dictionary after term removal: ${err.message}`);
      });
    }

    return result;
  }

  getTerms(): string[] {
    return Array.from(this.dictionary.keys());
  }

  size(): number {
    return this.dictionary.size;
  }

  addPosting(term: string, entry: PostingEntry): void {
    const postingList = this.addTerm(term);
    postingList.addEntry(entry);

    // Persist the updated dictionary if enabled
    if (this.options.persistToDisk && this.rocksDBService) {
      this.saveToDisk().catch(err => {
        this.logger.warn(
          `Failed to persist term dictionary after posting addition: ${err.message}`,
        );
      });
    }
  }

  removePosting(term: string, docId: number | string): boolean {
    const postingList = this.dictionary.get(term);
    if (!postingList) {
      return false;
    }

    const removed = postingList.removeEntry(docId);

    // If posting list is empty, remove the term
    if (postingList.size() === 0) {
      this.dictionary.delete(term);
    }

    // Persist the updated dictionary if enabled
    if (removed && this.options.persistToDisk && this.rocksDBService) {
      this.saveToDisk().catch(err => {
        this.logger.warn(`Failed to persist term dictionary after posting removal: ${err.message}`);
      });
    }

    return removed;
  }

  serialize(): Buffer {
    // Serialize each term and its posting list
    const serialized = {};

    for (const [term, postingList] of this.dictionary.entries()) {
      serialized[term] = postingList.serialize();
    }

    return Buffer.from(JSON.stringify(serialized));
  }

  deserialize(data: Buffer): void {
    this.dictionary.clear();

    const serialized = JSON.parse(data.toString());

    for (const term in serialized) {
      if (Object.prototype.hasOwnProperty.call(serialized, term)) {
        const postingList = this.options.useCompression
          ? new CompressedPostingList()
          : new SimplePostingList();

        // Convert string back to Buffer before deserializing
        const buffer = Buffer.from(serialized[term]);
        postingList.deserialize(buffer);

        this.dictionary.set(term, postingList);
      }
    }
  }

  /**
   * Save term dictionary to disk using RocksDB
   */
  async saveToDisk(): Promise<void> {
    if (!this.rocksDBService) {
      throw new Error('RocksDBService not available for persisting term dictionary');
    }

    const serialized = this.serialize();
    await this.rocksDBService.put('term_dictionary', serialized);
    this.logger.debug(`Term dictionary saved to disk (${this.dictionary.size} terms)`);
  }

  /**
   * Load term dictionary from disk using RocksDB
   */
  async loadFromDisk(): Promise<void> {
    if (!this.rocksDBService) {
      throw new Error('RocksDBService not available for loading term dictionary');
    }

    try {
      const data = await this.rocksDBService.get('term_dictionary');
      if (data) {
        this.deserialize(data as Buffer);
        this.logger.log(`Term dictionary loaded from disk (${this.dictionary.size} terms)`);
      } else {
        this.logger.log('No term dictionary found in storage');
      }
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        this.logger.log('No term dictionary found in storage');
      } else {
        throw error;
      }
    }
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
}
