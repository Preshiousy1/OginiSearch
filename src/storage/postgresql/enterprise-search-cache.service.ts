import { Injectable, Logger } from '@nestjs/common';
import { SearchQueryDto, SearchResponseDto } from '../../api/dtos/search.dto';

interface CacheEntry {
  result: SearchResponseDto;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

@Injectable()
export class EnterpriseSearchCache {
  private readonly logger = new Logger(EnterpriseSearchCache.name);

  // L1 Cache: In-memory hot cache (1000 entries)
  private readonly l1Cache = new Map<string, CacheEntry>();
  private readonly l1MaxSize = 1000;
  private readonly l1Ttl = 60000; // 1 minute

  constructor() {
    // Start cache cleanup interval
    setInterval(() => this.cleanupExpiredEntries(), 30000); // Every 30 seconds
  }

  /**
   * Get search result from cache
   */
  async get(key: string): Promise<SearchResponseDto | null> {
    const now = Date.now();

    // Simple L1 cache check (fast path)
    const entry = this.l1Cache.get(key);
    if (entry && !this.isExpired(entry, this.l1Ttl)) {
      entry.accessCount++;
      entry.lastAccessed = now;
      this.logger.debug(`L1 cache hit for key: ${key}`);
      return entry.result;
    }

    this.logger.debug(`Cache miss for key: ${key}`);
    return null;
  }

  /**
   * Set search result in cache
   */
  async set(key: string, result: SearchResponseDto): Promise<void> {
    const now = Date.now();
    const entry: CacheEntry = {
      result,
      timestamp: now,
      accessCount: 1,
      lastAccessed: now,
    };

    // Simple L1 cache set (fast path)
    this.setInL1(key, entry);
    this.logger.debug(`Cached result for key: ${key} in L1`);
  }

  /**
   * Generate semantic cache key based on query patterns
   */
  generateSemanticKey(
    indexName: string,
    query: SearchQueryDto,
    size: number,
    from: number,
  ): string {
    const normalized = this.normalizeQuery(query);
    const key = `${indexName}:${this.fastHash(normalized)}:${size}:${from}`;
    return key;
  }

  /**
   * Normalize query for consistent caching
   */
  private normalizeQuery(query: SearchQueryDto): string {
    if (typeof query.query === 'object' && 'match' in query.query && query.query.match?.value) {
      return `match:${query.query.match.value.toLowerCase().trim()}`;
    }
    if (typeof query.query === 'object' && 'term' in query.query && query.query.term?.value) {
      return `term:${query.query.term.value.toLowerCase().trim()}`;
    }
    if (
      typeof query.query === 'object' &&
      'wildcard' in query.query &&
      typeof query.query.wildcard === 'object' &&
      'value' in query.query.wildcard
    ) {
      return `wildcard:${(query.query.wildcard as { value: string }).value.toLowerCase().trim()}`;
    }
    if (typeof query.query === 'object' && 'bool' in query.query) {
      return `bool:${JSON.stringify(query.query.bool)}`;
    }
    return 'default';
  }

  /**
   * Fast hash function for cache keys
   */
  private fastHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Set entry in L1 cache with eviction
   */
  private setInL1(key: string, entry: CacheEntry): void {
    if (this.l1Cache.size >= this.l1MaxSize) {
      this.evictFromL1();
    }
    this.l1Cache.set(key, entry);
  }

  /**
   * Evict least recently used entry from L1 cache
   */
  private evictFromL1(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const evictedEntry = this.l1Cache.get(oldestKey);
      this.l1Cache.delete(oldestKey);

      // Demote to L2 cache
      if (evictedEntry) {
        // This logic is removed as per the simplified cache
      }
    }
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry, ttl: number): boolean {
    return Date.now() - entry.timestamp > ttl;
  }

  /**
   * Cleanup expired entries from all cache levels
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();

    // Clean L1 cache
    for (const [key, entry] of this.l1Cache.entries()) {
      if (this.isExpired(entry, this.l1Ttl)) {
        this.l1Cache.delete(key);
      }
    }

    // Clean L2 cache
    // This logic is removed as per the simplified cache

    // Clean L3 cache
    // This logic is removed as per the simplified cache
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): any {
    return {
      l1: {
        size: this.l1Cache.size,
        maxSize: this.l1MaxSize,
        hitRate: this.calculateHitRate(this.l1Cache),
      },
      l2: {
        size: 0, // L2 cache removed
        maxSize: 0, // L2 cache removed
        hitRate: 0, // L2 cache removed
      },
      l3: {
        size: 0, // L3 cache removed
        maxSize: 0, // L3 cache removed
        hitRate: 0, // L3 cache removed
      },
    };
  }

  /**
   * Calculate hit rate for cache level
   */
  private calculateHitRate(cache: Map<string, CacheEntry>): number {
    if (cache.size === 0) return 0;

    let totalAccesses = 0;
    for (const entry of cache.values()) {
      totalAccesses += entry.accessCount;
    }

    return totalAccesses / cache.size;
  }

  /**
   * Clear all cache levels
   */
  clear(): void {
    this.l1Cache.clear();
    this.logger.log('All cache levels cleared');
  }
}
