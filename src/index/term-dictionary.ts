import { PostingEntry, PostingList, TermDictionary } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';

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
export class InMemoryTermDictionary implements TermDictionary, OnModuleInit {
  private lruCache: MemoryOptimizedLRUCache;
  private options: TermDictionaryOptions;
  private readonly logger = new Logger(InMemoryTermDictionary.name);
  private rocksDBService?: RocksDBService;
  private initialized = false;
  private termList: Set<string> = new Set();
  private operationCount = 0;
  private lastMemoryCheck = Date.now();
  private memoryUsage = {
    currentSize: 0,
    maxSize: 0,
    evictions: 0,
    hits: 0,
    misses: 0,
    memoryPressureEvictions: 0,
  };

  constructor(options: TermDictionaryOptions = {}, rocksDBService?: RocksDBService) {
    this.options = {
      useCompression: true,
      persistToDisk: true,
      maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
      evictionThreshold: DEFAULT_EVICTION_THRESHOLD,
      maxPostingListSize: MAX_POSTING_LIST_SIZE,
      ...options,
    };
    this.rocksDBService = rocksDBService;
    this.lruCache = new MemoryOptimizedLRUCache(this.options.maxCacheSize!);

    // Start aggressive memory monitoring
    this.startMemoryMonitoring();
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
          const buffer = Buffer.from(data.data);
          terms = JSON.parse(buffer.toString());
        } else if (typeof data === 'string') {
          terms = JSON.parse(data);
        } else if (Array.isArray(data)) {
          terms = data;
        } else {
          terms = data;
        }

        if (Array.isArray(terms)) {
          // Limit the number of terms loaded to prevent memory issues
          const maxTermsToLoad = Math.min(terms.length, this.options.maxCacheSize! * 2);
          this.termList = new Set(terms.slice(0, maxTermsToLoad));
          this.logger.log(
            `Loaded ${this.termList.size} terms from term list (limited from ${terms.length})`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error loading term list: ${error.message}`);
    }
  }

  private async saveTermList() {
    if (!this.rocksDBService) return;

    try {
      // Only save a limited number of terms to prevent memory issues
      const termsArray = Array.from(this.termList).slice(0, this.options.maxCacheSize! * 2);
      await this.rocksDBService.put(TERM_LIST_KEY, termsArray);
    } catch (error) {
      this.logger.error(`Error saving term list: ${error.message}`);
    }
  }

  private getTermKey(term: string): string {
    return `${TERM_PREFIX}${term}`;
  }

  private startMemoryMonitoring(): void {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      this.memoryUsage.currentSize = this.lruCache.size();
      this.memoryUsage.maxSize = Math.max(this.memoryUsage.maxSize, this.memoryUsage.currentSize);

      // Log memory stats every 30 seconds
      const now = Date.now();
      if (now - this.lastMemoryCheck > 30000) {
        this.logger.debug(
          `Memory stats - Terms: ${this.memoryUsage.currentSize}, ` +
            `Hits: ${this.memoryUsage.hits}, Misses: ${this.memoryUsage.misses}, ` +
            `Evictions: ${this.memoryUsage.evictions}, Heap: ${heapUsedMB.toFixed(1)}MB`,
        );
        this.lastMemoryCheck = now;
      }
    }, 5000); // Check every 5 seconds
  }

  private async persistTermToDisk(term: string, postingList: PostingList): Promise<void> {
    if (!this.options.persistToDisk || !this.rocksDBService) return;

    try {
      const key = this.getTermKey(term);
      const serialized = postingList.serialize();
      await this.rocksDBService.put(key, serialized);
    } catch (error) {
      this.logger.error(`Failed to persist term ${term}: ${error.message}`);
    }
  }

  private async loadTermFromDisk(term: string): Promise<PostingList | null> {
    if (!this.options.persistToDisk || !this.rocksDBService) return null;

    try {
      const key = this.getTermKey(term);
      const data = await this.rocksDBService.get(key);
      if (!data) return null;

      const postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();

      postingList.deserialize(data);
      return postingList;
    } catch (error) {
      this.logger.error(`Failed to load term ${term} from disk: ${error.message}`);
      return null;
    }
  }

  /**
   * Create an index-aware term key
   */
  private createIndexAwareTerm(indexName: string, term: string): string {
    // If term already includes field (field:term), prepend index
    if (term.includes(':')) {
      return `${indexName}:${term}`;
    }
    // Otherwise create index:field:term format
    return `${indexName}:_all:${term}`;
  }

  /**
   * Parse an index-aware term back to its components
   */
  private parseIndexAwareTerm(indexAwareTerm: string): { indexName: string; fieldTerm: string } {
    const parts = indexAwareTerm.split(':');
    if (parts.length >= 2) {
      const indexName = parts[0];
      const fieldTerm = parts.slice(1).join(':');
      return { indexName, fieldTerm };
    }
    throw new Error(`Invalid index-aware term format: ${indexAwareTerm}`);
  }

  /**
   * Add term with index context
   */
  async addTermForIndex(indexName: string, term: string): Promise<PostingList> {
    this.ensureInitialized();

    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);

    // Add to term list
    this.termList.add(indexAwareTerm);

    // Save term list if persistence is enabled
    if (this.options.persistToDisk && this.rocksDBService) {
      await this.saveTermList();
    }

    // Get or create posting list
    let postingList = this.lruCache.get(indexAwareTerm);
    if (!postingList) {
      postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();
      const evictedKeys = this.lruCache.put(indexAwareTerm, postingList);
      // Handle evicted terms
      for (const key of evictedKeys) {
        if (this.options.persistToDisk && this.rocksDBService) {
          await this.persistTermToDisk(key, postingList);
        }
      }
    }

    return postingList;
  }

  /**
   * Get posting list with index context
   */
  async getPostingListForIndex(indexName: string, term: string): Promise<PostingList | undefined> {
    this.ensureInitialized();

    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
    this.logger.debug(`Getting posting list for index-aware term: ${indexAwareTerm}`);

    // Check cache first
    let postingList = this.lruCache.get(indexAwareTerm);
    if (postingList) {
      this.logger.debug(`Cache hit for index-aware term: ${indexAwareTerm}`);
      this.memoryUsage.hits++;
      return postingList;
    }

    this.memoryUsage.misses++;

    // If not in cache and persistence is enabled, try loading from disk
    if (this.options.persistToDisk && this.rocksDBService) {
      this.logger.debug(`Loading index-aware term from disk: ${indexAwareTerm}`);
      postingList = await this.loadTermFromDisk(indexAwareTerm);
      if (postingList) {
        // Add to cache
        const evictedKeys = this.lruCache.put(indexAwareTerm, postingList);
        // Handle evicted terms
        for (const key of evictedKeys) {
          if (this.options.persistToDisk && this.rocksDBService) {
            await this.persistTermToDisk(key, postingList);
          }
        }
        return postingList;
      }
    }

    // Not found
    return undefined;
  }

  /**
   * Get all terms for a specific index
   */
  getTermsForIndex(indexName: string): string[] {
    const prefix = `${indexName}:`;
    const indexTerms = Array.from(this.termList).filter(term => term.startsWith(prefix));

    // Also check cache for recently accessed terms
    const cacheKeys = this.lruCache.getKeysByIndex(indexName);

    // Combine and deduplicate
    const allTerms = new Set([...indexTerms, ...cacheKeys]);
    return Array.from(allTerms);

    // Return only the field:term part (without index prefix)
    return Array.from(allTerms).map(term => {
      const { fieldTerm } = this.parseIndexAwareTerm(term);
      return fieldTerm;
    });
  }

  /**
   * Check if term exists for a specific index
   */
  hasTermForIndex(indexName: string, term: string): boolean {
    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
    return this.lruCache.has(indexAwareTerm) || this.termList.has(indexAwareTerm);
  }

  /**
   * Add posting with index context
   */
  async addPostingForIndex(indexName: string, term: string, entry: PostingEntry): Promise<void> {
    const postingList = await this.addTermForIndex(indexName, term);

    // Check posting list size limit
    if (postingList.size() >= this.options.maxPostingListSize!) {
      this.logger.debug(
        `Posting list for term '${term}' in index '${indexName}' has reached size limit (${this.options.maxPostingListSize}) - removing oldest entries`,
      );
      // Remove oldest entries to make room
      const entries = postingList.getEntries();
      const toRemove = entries.slice(0, Math.floor(this.options.maxPostingListSize! * 0.1));
      toRemove.forEach(e => postingList.removeEntry(e.docId));
    }

    postingList.addEntry(entry);

    // Persist periodically
    if (this.options.persistToDisk && this.rocksDBService && this.operationCount % 50 === 0) {
      try {
        const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
        const serialized = postingList.serialize();
        await this.rocksDBService.put(this.getTermKey(indexAwareTerm), serialized);
      } catch (error) {
        this.logger.error(
          `Failed to persist postings for term ${term} in index ${indexName}: ${error.message}`,
        );
      }
    }

    this.operationCount++;
  }

  /**
   * Clear all data for a specific index
   */
  async clearIndex(indexName: string): Promise<void> {
    this.logger.log(`Clearing term dictionary for index: ${indexName}`);

    try {
      // Clear from cache
      this.lruCache.clearIndex(indexName);

      // Clear from term list
      const prefix = `${indexName}:`;
      const termsToRemove = Array.from(this.termList).filter(term => term.startsWith(prefix));
      for (const term of termsToRemove) {
        this.termList.delete(term);
      }

      // Clear from disk storage
      if (this.options.persistToDisk && this.rocksDBService) {
        for (const term of termsToRemove) {
          try {
            await this.rocksDBService.delete(this.getTermKey(term));
          } catch (error) {
            this.logger.warn(`Failed to delete term ${term} from disk: ${error.message}`);
          }
        }
        await this.saveTermList();
      }

      this.logger.log(`Cleared ${termsToRemove.length} terms for index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to clear index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  private ensureInitialized() {
    if (!this.initialized) {
      throw new Error('TermDictionary not initialized. Call onModuleInit() first.');
    }
  }

  serialize(): Buffer {
    // Only serialize a limited subset to prevent memory issues
    const limitedTerms = Array.from(this.termList).slice(0, 100);
    const data = {
      terms: limitedTerms,
      cacheSize: this.lruCache.size(),
      memoryUsage: this.memoryUsage,
    };
    return Buffer.from(JSON.stringify(data));
  }

  deserialize(data: Buffer | Record<string, any>): void {
    try {
      let parsed;
      if (Buffer.isBuffer(data)) {
        parsed = JSON.parse(data.toString());
      } else {
        parsed = data;
      }

      if (parsed.terms && Array.isArray(parsed.terms)) {
        this.termList = new Set(parsed.terms);
      }
      if (parsed.memoryUsage) {
        this.memoryUsage = { ...this.memoryUsage, ...parsed.memoryUsage };
      }
    } catch (error) {
      this.logger.error(`Failed to deserialize term dictionary: ${error.message}`);
    }
  }

  getTermStats(term: string): { term: string; docFreq: number } | undefined {
    const postingList = this.lruCache.get(term);
    if (!postingList) return undefined;

    return {
      term,
      docFreq: postingList.size(),
    };
  }

  getPostingLists(terms: string[]): Map<string, PostingList> {
    const result = new Map<string, PostingList>();

    // Limit the number of terms processed to prevent memory issues
    const limitedTerms = terms.slice(0, 100);

    for (const term of limitedTerms) {
      const postingList = this.lruCache.get(term);
      if (postingList) {
        result.set(term, postingList);
      }
    }

    return result;
  }

  async saveToDisk(): Promise<void> {
    if (!this.options.persistToDisk || !this.rocksDBService) {
      return;
    }

    try {
      // Save term list
      await this.saveTermList();

      // Save only the most recently used terms to prevent memory issues
      const entries = this.lruCache.entries().slice(0, 100);
      await Promise.all(
        entries.map(async ([term, postingList]) => {
          const key = this.getTermKey(term);
          const serialized = postingList.serialize();
          await this.rocksDBService.put(key, serialized);
        }),
      );

      this.logger.log(`Term dictionary saved to disk successfully (${entries.length} terms)`);
    } catch (error) {
      this.logger.error(`Failed to save term dictionary to disk: ${error.message}`);
      throw error;
    }
  }

  getMemoryStats() {
    return {
      ...this.memoryUsage,
      termListSize: this.termList.size,
      cacheSize: this.lruCache.size(),
    };
  }

  // Force cleanup method
  async cleanup(): Promise<void> {
    try {
      // Save current state
      await this.saveToDisk();

      // Clear caches
      this.lruCache.clear();
      this.termList.clear();

      // Reset stats
      this.memoryUsage = {
        currentSize: 0,
        maxSize: 0,
        evictions: 0,
        hits: 0,
        misses: 0,
        memoryPressureEvictions: 0,
      };

      // Force garbage collection
      if (global.gc) {
        global.gc();
      }

      this.logger.log('Term dictionary cleanup completed');
    } catch (error) {
      this.logger.error(`Failed to cleanup term dictionary: ${error.message}`);
    }
  }

  // Implement the required clear() method from TermDictionary interface
  async clear(): Promise<void> {
    await this.cleanup();
  }

  // Legacy interface methods (kept for backward compatibility)
  async addTerm(term: string): Promise<PostingList> {
    // Use a default index for backward compatibility
    return this.addTermForIndex('_default', term);
  }

  async getPostingList(term: string): Promise<PostingList | undefined> {
    // Use a default index for backward compatibility
    return this.getPostingListForIndex('_default', term);
  }

  hasTerm(term: string): boolean {
    // Check in default index for backward compatibility
    return this.hasTermForIndex('_default', term);
  }

  async removeTerm(term: string): Promise<boolean> {
    this.ensureInitialized();

    const indexAwareTerm = this.createIndexAwareTerm('_default', term);
    const wasInCache = this.lruCache.delete(indexAwareTerm);
    const wasInTermList = this.termList.delete(indexAwareTerm);

    if (wasInTermList && this.options.persistToDisk && this.rocksDBService) {
      try {
        await this.rocksDBService.delete(this.getTermKey(indexAwareTerm));
        await this.saveTermList();
      } catch (error) {
        this.logger.error(`Failed to remove term ${term} from storage: ${error.message}`);
      }
    }

    return wasInCache || wasInTermList;
  }

  getTerms(): string[] {
    this.ensureInitialized();
    return Array.from(this.termList).map(term => {
      // Ensure all terms have a field prefix
      return term.includes(':') ? term : `_all:${term}`;
    });
  }

  size(): number {
    return Math.min(this.termList.size, this.options.maxCacheSize! * 2);
  }

  async addPosting(term: string, entry: PostingEntry): Promise<void> {
    return this.addPostingForIndex('_default', term, entry);
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
          const indexAwareTerm = this.createIndexAwareTerm('_default', term);
          const serialized = postingList.serialize();
          await this.rocksDBService.put(this.getTermKey(indexAwareTerm), serialized);
        }
      } catch (error) {
        this.logger.error(`Failed to update postings for term ${term}: ${error.message}`);
      }
    }

    return removed;
  }
}

// Re-export types for compatibility
export * from './interfaces/posting.interface';
