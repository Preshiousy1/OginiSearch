import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PostgreSQLCacheService {
  private readonly logger = new Logger(PostgreSQLCacheService.name);
  private readonly redis: Redis;
  private readonly TTL = 300; // 5 minutes in seconds

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      retryStrategy: times => Math.min(times * 50, 2000),
    });

    this.redis.on('error', err => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.warn(`Cache get error: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.TTL);
    } catch (error) {
      this.logger.warn(`Cache set error: ${error.message}`);
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.warn(`Cache invalidation error: ${error.message}`);
    }
  }

  generateKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(':');
    return `ogini:${prefix}:${sortedParams}`;
  }
}
