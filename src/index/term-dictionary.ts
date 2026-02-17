import { PostingEntry, PostingList, TermDictionary } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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

  put(key: string, value: PostingList): Array<{ key: string; value: PostingList }> {
    const evictedEntries: Array<{ key: string; value: PostingList }> = [];
    const existingNode = this.cache.get(key);

    if (existingNode) {
      existingNode.value = value;
      existingNode.lastAccessed = Date.now();
      existingNode.accessCount++;
      this.moveToFront(existingNode);
      return evictedEntries;
    }

    const newNode = new LRUNode(key, value);
    this.cache.set(key, newNode);
    this.addToFront(newNode);

    // Check for memory pressure and evict aggressively if needed
    this.operationCount++;
    if (this.operationCount % MEMORY_CHECK_INTERVAL === 0) {
      this.checkMemoryPressure(evictedEntries);
    }

    // Normal size-based eviction
    while (this.cache.size > this.maxSize) {
      const evictedNode = this.removeLastNode();
      if (evictedNode) {
        evictedEntries.push({ key: evictedNode.key, value: evictedNode.value });
      }
    }

    return evictedEntries;
  }

  private checkMemoryPressure(evictedEntries: Array<{ key: string; value: PostingList }>): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const usagePercent = heapUsedMB / heapTotalMB;

    // If memory usage is high, evict more aggressively
    if (usagePercent > 0.8) {
      const targetSize = Math.floor(this.maxSize * 0.5); // Evict to 50% capacity
      while (this.cache.size > targetSize) {
        const evictedNode = this.removeLastNode();
        if (evictedNode) {
          evictedEntries.push({ key: evictedNode.key, value: evictedNode.value });
        }
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

  private removeLastNode(): LRUNode | null {
    if (!this.tail) return null;

    const node = this.tail;
    this.cache.delete(node.key);

    if (this.tail.prev) {
      this.tail.prev.next = null;
      this.tail = this.tail.prev;
    } else {
      this.head = null;
      this.tail = null;
    }

    return node;
  }

  private removeLast(): string | null {
    const node = this.removeLastNode();
    return node ? node.key : null;
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
export class InMemoryTermDictionary implements TermDictionary, OnModuleInit, OnModuleDestroy {
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

  /**
   * Tracks terms that have been modified since last MongoDB persistence.
   * Key: indexName, Value: Set of index-aware terms (indexName:field:term) that are dirty
   * This enables incremental persistence - only persist what changed, not everything.
   */
  private dirtyTerms: Map<string, Set<string>> = new Map();

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
        this.startPeriodicTermListSave();
      } catch (err) {
        this.logger.warn(`Failed to load term list: ${err.message}`);
        this.initialized = true;
      }
    } else {
      this.initialized = true;
    }
  }

  async onModuleDestroy() {
    if (this.options.persistToDisk && this.rocksDBService) {
      this.stopPeriodicTermListSave();
      await this.saveTermList();
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

  private termListSaveIntervalId: NodeJS.Timeout | null = null;

  private startPeriodicTermListSave(): void {
    if (!this.options.persistToDisk || !this.rocksDBService) return;
    // Save term list every 60s so we don't lose it if process crashes (replacement for per-term save)
    this.termListSaveIntervalId = setInterval(() => {
      this.saveTermList().catch(err =>
        this.logger.warn(`Periodic term list save failed: ${err.message}`),
      );
    }, 60000);
  }

  private stopPeriodicTermListSave(): void {
    if (this.termListSaveIntervalId) {
      clearInterval(this.termListSaveIntervalId);
      this.termListSaveIntervalId = null;
    }
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

    // Add to term list with cap to prevent unbounded memory growth (OOM during bulk indexing)
    const maxTermListSize = this.options.maxCacheSize! * 2;
    if (this.termList.size >= maxTermListSize) {
      // Evict one arbitrary term to make room (Set iteration order is insertion order in JS)
      const first = this.termList.values().next().value;
      if (first !== undefined) this.termList.delete(first);
    }
    this.termList.add(indexAwareTerm);

    // Term list is saved periodically (every 60s) and on shutdown - not per term (was too slow)

    // Get or create posting list
    let postingList = this.lruCache.get(indexAwareTerm);
    if (!postingList) {
      postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();

      const evictedEntries = this.lruCache.put(indexAwareTerm, postingList);
      // Handle evicted terms - persist with their POPULATED posting lists to RocksDB
      // This ensures evicted data is not lost
      for (const entry of evictedEntries) {
        if (this.options.persistToDisk && this.rocksDBService) {
          await this.persistTermToDisk(entry.key, entry.value);
        }
      }
    }

    return postingList;
  }

  /**
   * Get posting list for a specific index and term
   * @param indexName - The name of the index
   * @param term - The term to search for
   * @param isIndexAware - Whether the term parameter is already index-aware (indexName:field:term format)
   */
  async getPostingListForIndex(
    indexName: string,
    term: string,
    isIndexAware = false,
  ): Promise<PostingList | undefined> {
    this.ensureInitialized();

    // Use the term as-is if it's already index-aware, otherwise make it index-aware
    const indexAwareTerm = isIndexAware ? term : this.createIndexAwareTerm(indexName, term);

    // Check cache first
    let postingList = this.lruCache.get(indexAwareTerm);
    if (postingList) {
      this.memoryUsage.hits++;
      return postingList;
    }

    this.memoryUsage.misses++;

    // If not in cache and persistence is enabled, try loading from disk
    if (this.options.persistToDisk && this.rocksDBService) {
      postingList = await this.loadTermFromDisk(indexAwareTerm);
      if (postingList) {
        // Add to cache
        const evictedEntries = this.lruCache.put(indexAwareTerm, postingList);
        // Handle evicted terms - persist with their correct posting lists
        for (const entry of evictedEntries) {
          if (this.options.persistToDisk && this.rocksDBService) {
            await this.persistTermToDisk(entry.key, entry.value);
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

    // Return the full index-aware terms (indexName:field:term format)
    return Array.from(allTerms);
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

    // Do NOT evict when list reaches maxPostingListSize - that was dropping document IDs
    // and causing search to return fewer results than indexed (e.g. 5220 instead of 20000).
    // Persistence (persistDirtyTermPostingsToMongoDB) saves to MongoDB and the repository
    // chunks into 5000-entry documents; all document IDs are preserved.

    postingList.addEntry(entry);

    // Mark term as dirty for incremental MongoDB persistence
    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
    if (!this.dirtyTerms.has(indexName)) {
      this.dirtyTerms.set(indexName, new Set());
    }
    this.dirtyTerms.get(indexName)!.add(indexAwareTerm);

    // Persist to RocksDB periodically for fast recovery
    if (this.options.persistToDisk && this.rocksDBService && this.operationCount % 50 === 0) {
      try {
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

      // Clear dirty terms for this index
      this.dirtyTerms.delete(indexName);

      this.logger.log(`Cleared ${termsToRemove.length} terms for index ${indexName}`);
    } catch (error) {
      this.logger.error(`Failed to clear index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all dirty (modified) terms for an index.
   * These are terms that have had new posting entries added since the last MongoDB persistence.
   * Used for incremental persistence to avoid re-persisting unchanged terms.
   */
  getDirtyTermsForIndex(indexName: string): string[] {
    const dirtySet = this.dirtyTerms.get(indexName);
    return dirtySet ? Array.from(dirtySet) : [];
  }

  /**
   * Clear dirty terms for an index after successful persistence to MongoDB.
   * Should be called after all dirty terms have been successfully persisted.
   */
  clearDirtyTermsForIndex(indexName: string): void {
    this.dirtyTerms.delete(indexName);
  }

  /**
   * Get count of dirty terms for monitoring and metrics.
   * @param indexName Optional - if provided, returns count for that index. Otherwise returns total across all indices.
   */
  getDirtyTermCount(indexName?: string): number {
    if (indexName) {
      return this.dirtyTerms.get(indexName)?.size || 0;
    }
    // Total across all indices
    let total = 0;
    for (const set of this.dirtyTerms.values()) {
      total += set.size;
    }
    return total;
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

  /**
   * Persist posting list for an index-aware term to RocksDB (in-memory list already updated).
   * Used when removing a document from a term so RocksDB stays in sync with MongoDB.
   */
  async persistPostingListForIndex(
    indexName: string,
    term: string,
    postingList: PostingList,
  ): Promise<void> {
    this.ensureInitialized();
    if (!this.options.persistToDisk || !this.rocksDBService) return;

    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
    const serialized = postingList.serialize();
    await this.rocksDBService.put(this.getTermKey(indexAwareTerm), serialized);
  }

  /**
   * Remove a term completely for a specific index (index-aware).
   * Keys are stored as indexName:field:term; this removes that key.
   */
  async removeTermForIndex(indexName: string, term: string): Promise<boolean> {
    this.ensureInitialized();

    const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
    const wasInCache = this.lruCache.delete(indexAwareTerm);
    const wasInTermList = this.termList.delete(indexAwareTerm);

    if (wasInTermList && this.options.persistToDisk && this.rocksDBService) {
      try {
        await this.rocksDBService.delete(this.getTermKey(indexAwareTerm));
        await this.saveTermList();
      } catch (error) {
        this.logger.error(
          `Failed to remove term ${term} for index ${indexName} from storage: ${error.message}`,
        );
      }
    }

    return wasInCache || wasInTermList;
  }

  /**
   * Remove a document from a term's posting list for a specific index (index-aware).
   * Term key format is indexName:field:term so searches are distinguishable between indexes.
   */
  async removePostingForIndex(
    indexName: string,
    term: string,
    docId: number | string,
  ): Promise<boolean> {
    const postingList = await this.getPostingListForIndex(indexName, term);
    if (!postingList) {
      return false;
    }

    const removed = postingList.removeEntry(docId);

    if (removed && this.options.persistToDisk && this.rocksDBService) {
      try {
        if (postingList.size() === 0) {
          await this.removeTermForIndex(indexName, term);
        } else {
          const indexAwareTerm = this.createIndexAwareTerm(indexName, term);
          const serialized = postingList.serialize();
          await this.rocksDBService.put(this.getTermKey(indexAwareTerm), serialized);
        }
      } catch (error) {
        this.logger.error(
          `Failed to update postings for term ${term} in index ${indexName}: ${error.message}`,
        );
      }
    }

    return removed;
  }
}

// Re-export types for compatibility
export * from './interfaces/posting.interface';
