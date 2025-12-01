import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SearchQueryDto } from '../../api/dtos/search.dto';

export interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    // Create Redis connection using the same pattern as Bull module
    this.redis = new Redis({
      username: this.configService.get<string>('REDIS_USERNAME'),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      host: this.configService.get<string>('REDIS_HOST'),
      port: Number(this.configService.get<string>('REDIS_PORT')),
      family: 0, // Important for Railway compatibility
    });

    this.redis.on('error', error => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis cache service connected successfully');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis cache service ready');
    });
  }

  /**
   * Generate cache key for search query
   */
  generateKey(indexName: string, searchQuery: SearchQueryDto): string {
    const queryStr =
      typeof searchQuery.query === 'string' ? searchQuery.query : JSON.stringify(searchQuery.query);

    const size = searchQuery.size || 10;
    const from = searchQuery.from || 0;

    return `search:${indexName}:${this.hashQuery(queryStr)}:${size}:${from}`;
  }

  /**
   * Get cached search results
   */
  async get(key: string): Promise<any | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);

      // Check if expired
      if (Date.now() > entry.timestamp + entry.ttl * 1000) {
        await this.redis.del(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      this.logger.warn(`Cache get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Set cache entry with TTL
   */
  async set(key: string, data: any, ttlSeconds = 300): Promise<void> {
    try {
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        ttl: ttlSeconds,
      };

      const serialized = JSON.stringify(entry);
      const result = await this.redis.setex(key, ttlSeconds, serialized);
      // Verify the key was actually stored
      const verify = await this.redis.exists(key);
      if (verify === 0) {
        this.logger.warn(`⚠️ Cache key ${key} was not stored`);
      }
    } catch (error) {
      this.logger.error(`❌ Cache set error for key ${key}: ${error.message}`, error.stack);
      // Don't throw - let the caller handle it gracefully
    }
  }

  /**
   * Delete cache entry
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete error: ${error.message}`);
    }
  }

  /**
   * Clear all search cache
   */
  async clearSearchCache(): Promise<void> {
    try {
      const keys = await this.redis.keys('search:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} search cache entries`);
      }
    } catch (error) {
      this.logger.warn(`Cache clear error: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<any> {
    try {
      const keys = await this.redis.keys('search:*');
      const totalKeys = keys.length;

      // Sample some keys to get TTL info
      const sampleKeys = keys.slice(0, 10);
      const ttls = await Promise.all(sampleKeys.map(key => this.redis.ttl(key)));

      return {
        totalKeys,
        sampleTtls: ttls,
        memoryUsage: await this.redis.memory('USAGE', 'search:*'),
      };
    } catch (error) {
      this.logger.warn(`Cache stats error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Simple hash function for query string
   */
  private hashQuery(query: string): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Close Redis connection
   */
  async onModuleDestroy() {
    await this.redis.quit();
  }
}
