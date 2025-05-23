import { Injectable, Logger } from '@nestjs/common';

export interface MemoryStats {
  cacheSize: number;
  maxCacheSize: number;
  evictions: number;
  hits: number;
  misses: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export interface MemoryManagerOptions {
  maxCacheSize: number;
  evictionThreshold: number;
  gcInterval: number;
  memoryMonitoringInterval: number;
}

@Injectable()
export class MemoryManager {
  private readonly logger = new Logger(MemoryManager.name);
  private options: MemoryManagerOptions;
  private stats: MemoryStats;
  private gcTimer: NodeJS.Timeout | null = null;
  private monitoringTimer: NodeJS.Timeout | null = null;

  constructor(options: MemoryManagerOptions) {
    this.options = options;
    this.stats = {
      cacheSize: 0,
      maxCacheSize: options.maxCacheSize,
      evictions: 0,
      hits: 0,
      misses: 0,
      memoryUsage: process.memoryUsage(),
    };

    this.startMemoryMonitoring();
    this.startGarbageCollection();
  }

  private startMemoryMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      this.stats.memoryUsage = process.memoryUsage();

      const heapUsedMB = Math.round(this.stats.memoryUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(this.stats.memoryUsage.heapTotal / 1024 / 1024);

      this.logger.debug(
        `Memory: ${heapUsedMB}MB/${heapTotalMB}MB, ` +
          `Cache: ${this.stats.cacheSize}/${this.stats.maxCacheSize}, ` +
          `Hit Rate: ${this.getHitRate()}%`,
      );

      // Alert if memory usage is high
      const memoryUsagePercent =
        (this.stats.memoryUsage.heapUsed / this.stats.memoryUsage.heapTotal) * 100;
      if (memoryUsagePercent > 80) {
        this.logger.warn(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
        this.forceGarbageCollection();
      }
    }, this.options.memoryMonitoringInterval);
  }

  private startGarbageCollection(): void {
    this.gcTimer = setInterval(() => {
      if (global.gc) {
        global.gc();
        this.logger.debug('Forced garbage collection completed');
      }
    }, this.options.gcInterval);
  }

  forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
      this.logger.debug('Emergency garbage collection triggered');
    }
  }

  updateStats(cacheSize: number, hits: number, misses: number, evictions: number): void {
    this.stats.cacheSize = cacheSize;
    this.stats.hits = hits;
    this.stats.misses = misses;
    this.stats.evictions = evictions;
  }

  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
  }

  getMemoryStats(): MemoryStats {
    return { ...this.stats };
  }

  shouldEvict(): boolean {
    return this.stats.cacheSize > this.options.maxCacheSize * this.options.evictionThreshold;
  }

  cleanup(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
  }
}

// Utility functions for memory optimization
export class MemoryUtils {
  static deepFreeze<T>(obj: T): T {
    Object.getOwnPropertyNames(obj).forEach(prop => {
      if (
        obj[prop] !== null &&
        (typeof obj[prop] === 'object' || typeof obj[prop] === 'function')
      ) {
        MemoryUtils.deepFreeze(obj[prop]);
      }
    });
    return Object.freeze(obj);
  }

  static clearCircularReferences(obj: any, seen = new WeakSet()): void {
    if (obj && typeof obj === 'object') {
      if (seen.has(obj)) {
        return;
      }
      seen.add(obj);

      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            if (seen.has(obj[key])) {
              delete obj[key]; // Remove circular reference
            } else {
              MemoryUtils.clearCircularReferences(obj[key], seen);
            }
          }
        }
      }
    }
  }

  static getObjectSize(obj: any): number {
    const jsonString = JSON.stringify(obj);
    return new Blob([jsonString]).size;
  }

  static chunkedProcessing<T, R>(items: T[], processor: (item: T) => R, chunkSize = 100): R[] {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      for (const item of chunk) {
        results.push(processor(item));
      }
      // Allow garbage collection between chunks
      if (global.gc && i % (chunkSize * 10) === 0) {
        global.gc();
      }
    }
    return results;
  }
}
