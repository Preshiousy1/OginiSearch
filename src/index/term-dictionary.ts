import {
  PostingEntry,
  PostingList,
  TermDictionary as ITermDictionary,
} from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';

const BATCH_SIZE = 100; // Reduced from 1000
const TERM_PREFIX = 'term:';
const TERM_LIST_KEY = 'term_list';
const DEFAULT_MAX_CACHE_SIZE = 1000; // Reduced from 10000
const DEFAULT_EVICTION_THRESHOLD = 0.5; // More aggressive eviction
const MAX_POSTING_LIST_SIZE = 5000; // Increased from 1000 to accommodate larger datasets
const MEMORY_CHECK_INTERVAL = 100; // Check memory every 100 operations

export interface TermDictionaryOptions {
  useCompression?: boolean;
  persistToDisk?: boolean;
  maxCacheSize?: number;
  evictionThreshold?: number;
  maxPostingListSize?: number;
  maxTerms?: number;
  maxPostingsPerTerm?: number;
}

// Memory-optimized LRU Node
class LRUNode {
  constructor(
    public key: string,
    public value: PostingList,
    public prev: LRUNode | null = null,
    public next: LRUNode | null = null,
    public lastAccessed: number = Date.now(),
    public accessCount: number = 0,
  ) {}
}

// Enhanced LRU Cache with memory pressure handling and index awareness
class MemoryOptimizedLRUCache {
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private cache: Map<string, LRUNode> = new Map();
  private maxSize: number;
  private operationCount = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): PostingList | undefined {
    const node = this.cache.get(key);
    if (!node) return undefined;

    // Update access statistics
    node.lastAccessed = Date.now();
    node.accessCount++;

    // Move to front
    this.moveToFront(node);
    return node.value;
  }

  put(key: string, value: PostingList): string[] {
    const evictedKeys: string[] = [];
    const existingNode = this.cache.get(key);

    if (existingNode) {
      existingNode.value = value;
      existingNode.lastAccessed = Date.now();
      existingNode.accessCount++;
      this.moveToFront(existingNode);
      return evictedKeys;
    }

    const newNode = new LRUNode(key, value);
    this.cache.set(key, newNode);
    this.addToFront(newNode);

    // Check for memory pressure and evict aggressively if needed
    this.operationCount++;
    if (this.operationCount % MEMORY_CHECK_INTERVAL === 0) {
      this.checkMemoryPressure(evictedKeys);
    }

    // Normal size-based eviction
    while (this.cache.size > this.maxSize) {
      const evictedKey = this.removeLast();
      if (evictedKey) evictedKeys.push(evictedKey);
    }

    return evictedKeys;
  }

  private checkMemoryPressure(evictedKeys: string[]): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const usagePercent = heapUsedMB / heapTotalMB;

    // If memory usage is high, evict more aggressively
    if (usagePercent > 0.8) {
      const targetSize = Math.floor(this.maxSize * 0.5); // Evict to 50% capacity
      while (this.cache.size > targetSize) {
        const evictedKey = this.removeLast();
        if (evictedKey) evictedKeys.push(evictedKey);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }
  }

  private moveToFront(node: LRUNode): void {
    if (node === this.head) return;

    // Remove from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    // Add to front
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private addToFront(node: LRUNode): void {
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeLast(): string | null {
    if (!this.tail) return null;

    const key = this.tail.key;
    this.cache.delete(key);

    if (this.tail.prev) {
      this.tail.prev.next = null;
      this.tail = this.tail.prev;
    } else {
      this.head = null;
      this.tail = null;
    }

    return key;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    // Remove from linked list
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;

    // Clear references
    node.prev = null;
    node.next = null;
    node.value = null as any;

    return this.cache.delete(key);
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    // Clear references to help GC
    for (const node of this.cache.values()) {
      node.prev = null;
      node.next = null;
      node.value = null as any;
    }
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  entries(): [string, PostingList][] {
    const result: [string, PostingList][] = [];
    for (const [key, node] of this.cache) {
      result.push([key, node.value]);
    }
    return result;
  }

  /**
   * Get all keys that match a specific index prefix
   */
  getKeysByIndex(indexName: string): string[] {
    const prefix = `${indexName}:`;
    return Array.from(this.cache.keys()).filter(key => key.startsWith(prefix));
  }

  /**
   * Clear all entries for a specific index
   */
  clearIndex(indexName: string): void {
    const keysToDelete = this.getKeysByIndex(indexName);
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }
}

@Injectable()
export class TermDictionary implements ITermDictionary {
  private readonly logger = new Logger(TermDictionary.name);
  private readonly terms = new Set<string>();
  private readonly postings = new Map<string, Map<string, number[]>>();
  private readonly options: TermDictionaryOptions;
  private operationCount = 0;
  private readonly postgresqlService?: PostgreSQLService;

  constructor(options: TermDictionaryOptions = {}, postgresqlService?: PostgreSQLService) {
    this.options = {
      persistToDisk: false,
      maxTerms: 1000000,
      maxPostingsPerTerm: 100000,
      ...options,
    };
    this.postgresqlService = postgresqlService;
  }

  async initialize(): Promise<void> {
    if (this.options.persistToDisk && this.postgresqlService) {
      await this.loadTermsFromStorage();
    }
  }

  private async loadTermsFromStorage(): Promise<void> {
    if (!this.postgresqlService) return;

    try {
      const result = await this.postgresqlService.query(
        'SELECT term FROM term_dictionary WHERE term = ANY($1::text[])',
        [Array.from(this.terms)],
      );

      for (const row of result.rows) {
        this.terms.add(row.term);
      }
    } catch (error) {
      this.logger.error(`Failed to load terms from storage: ${error.message}`);
    }
  }

  private async saveTermsToStorage(): Promise<void> {
    if (!this.postgresqlService) return;

    try {
      const termsArray = Array.from(this.terms);
      await this.postgresqlService.query(
        'INSERT INTO term_dictionary (term) VALUES (unnest($1::text[])) ON CONFLICT DO NOTHING',
        [termsArray],
      );
    } catch (error) {
      this.logger.error(`Failed to save terms to storage: ${error.message}`);
    }
  }

  async addTerm(term: string): Promise<void> {
    if (this.terms.size >= this.options.maxTerms!) {
      this.logger.warn(`Term dictionary full (${this.terms.size} terms)`);
      return;
    }

    this.terms.add(term);
    this.operationCount++;

    if (this.options.persistToDisk && this.postgresqlService && this.operationCount % 50 === 0) {
      await this.saveTermsToStorage();
    }
  }

  async removeTerm(term: string): Promise<void> {
    const wasInTermList = this.terms.delete(term);
    this.postings.delete(term);

    if (wasInTermList && this.options.persistToDisk && this.postgresqlService) {
      await this.postgresqlService.query('DELETE FROM term_dictionary WHERE term = $1', [term]);
    }
  }

  async addPosting(term: string, documentId: string, positions: number[]): Promise<void> {
    if (!this.terms.has(term)) {
      await this.addTerm(term);
    }

    let termPostings = this.postings.get(term);
    if (!termPostings) {
      termPostings = new Map();
      this.postings.set(term, termPostings);
    }

    if (termPostings.size >= this.options.maxPostingsPerTerm!) {
      this.logger.warn(`Postings list full for term "${term}" (${termPostings.size} postings)`);
      return;
    }

    termPostings.set(documentId, positions);

    if (this.options.persistToDisk && this.postgresqlService) {
      await this.postgresqlService.query(
        `INSERT INTO term_postings (term, document_id, positions)
         VALUES ($1, $2, $3)
         ON CONFLICT (term, document_id) DO UPDATE SET positions = $3`,
        [term, documentId, positions],
      );
    }
  }

  async removePosting(term: string, documentId: string): Promise<void> {
    const termPostings = this.postings.get(term);
    if (!termPostings) return;

    const removed = termPostings.delete(documentId);

    if (removed && this.options.persistToDisk && this.postgresqlService) {
      await this.postgresqlService.query(
        'DELETE FROM term_postings WHERE term = $1 AND document_id = $2',
        [term, documentId],
      );
    }

    if (termPostings.size === 0) {
      await this.removeTerm(term);
    }
  }

  getTerms(): string[] {
    return Array.from(this.terms);
  }

  getPostings(term: string): Map<string, number[]> | undefined {
    return this.postings.get(term);
  }

  hasPosting(term: string, documentId: string): boolean {
    return this.postings.get(term)?.has(documentId) ?? false;
  }

  clear(): void {
    this.terms.clear();
    this.postings.clear();
  }

  size(): number {
    return this.terms.size;
  }
}

// Re-export types for compatibility
export * from './interfaces/posting.interface';
