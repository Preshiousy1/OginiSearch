import { Injectable, Logger } from '@nestjs/common';

export interface SearchMetricsData {
  totalQueries: number;
  averageLatency: number;
  cacheHitRate: number;
  slowQueries: number;
  indexBreakdown: Record<string, IndexMetrics>;
  queryTypeBreakdown: Record<string, number>;
}

export interface IndexMetrics {
  totalQueries: number;
  averageLatency: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface QueryMetric {
  indexName: string;
  queryType: string;
  duration: number;
  cacheHit: boolean;
  timestamp: number;
}

/**
 * Ultra-Lightweight Search Metrics Service
 * Collects performance data with minimal overhead
 * Uses simple counters and sliding window approach
 */
@Injectable()
export class SearchMetricsService {
  private readonly logger = new Logger(SearchMetricsService.name);

  // Lightweight counters (no heavy data structures)
  private totalQueries = 0;
  private totalLatency = 0;
  private slowQueryCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  // Index-specific metrics (simple map)
  private indexMetrics = new Map<string, IndexMetrics>();

  // Query type counters
  private queryTypes = new Map<string, number>();

  // Recent queries for sliding window (limited size for memory efficiency)
  private recentQueries: QueryMetric[] = [];
  private readonly MAX_RECENT_QUERIES = 1000; // Keep only last 1000 queries
  private readonly SLOW_QUERY_THRESHOLD = 500; // ms

  /**
   * Record a search query with minimal overhead
   */
  recordQuery(indexName: string, queryType: string, duration: number, cacheHit = false): void {
    // Simple counter updates (O(1) operations only)
    this.totalQueries++;
    this.totalLatency += duration;

    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    if (duration > this.SLOW_QUERY_THRESHOLD) {
      this.slowQueryCount++;
    }

    // Update query type counter
    this.queryTypes.set(queryType, (this.queryTypes.get(queryType) || 0) + 1);

    // Update index metrics
    this.updateIndexMetrics(indexName, duration, cacheHit);

    // Add to recent queries (with size limit for memory efficiency)
    if (this.recentQueries.length >= this.MAX_RECENT_QUERIES) {
      this.recentQueries.shift(); // Remove oldest
    }

    this.recentQueries.push({
      indexName,
      queryType,
      duration,
      cacheHit,
      timestamp: Date.now(),
    });
  }

  /**
   * Update index-specific metrics efficiently
   */
  private updateIndexMetrics(indexName: string, duration: number, cacheHit: boolean): void {
    let metrics = this.indexMetrics.get(indexName);

    if (!metrics) {
      metrics = {
        totalQueries: 0,
        averageLatency: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };
      this.indexMetrics.set(indexName, metrics);
    }

    // Update counters
    metrics.totalQueries++;

    // Update average latency using running average (efficient calculation)
    metrics.averageLatency =
      (metrics.averageLatency * (metrics.totalQueries - 1) + duration) / metrics.totalQueries;

    if (cacheHit) {
      metrics.cacheHits++;
    } else {
      metrics.cacheMisses++;
    }
  }

  /**
   * Get current metrics (fast read operations)
   */
  getMetrics(): SearchMetricsData {
    const averageLatency = this.totalQueries > 0 ? this.totalLatency / this.totalQueries : 0;
    const totalCacheOperations = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheOperations > 0 ? this.cacheHits / totalCacheOperations : 0;

    // Convert map to record for response
    const indexBreakdown: Record<string, IndexMetrics> = {};
    this.indexMetrics.forEach((metrics, indexName) => {
      indexBreakdown[indexName] = { ...metrics };
    });

    const queryTypeBreakdown: Record<string, number> = {};
    this.queryTypes.forEach((count, queryType) => {
      queryTypeBreakdown[queryType] = count;
    });

    return {
      totalQueries: this.totalQueries,
      averageLatency: Math.round(averageLatency * 100) / 100, // Round to 2 decimal places
      cacheHitRate: Math.round(cacheHitRate * 10000) / 100, // Percentage with 2 decimal places
      slowQueries: this.slowQueryCount,
      indexBreakdown,
      queryTypeBreakdown,
    };
  }

  /**
   * Get recent slow queries for debugging (limited to recent window)
   */
  getRecentSlowQueries(limit = 10): QueryMetric[] {
    return this.recentQueries
      .filter(q => q.duration > this.SLOW_QUERY_THRESHOLD)
      .slice(-limit) // Get most recent
      .reverse(); // Most recent first
  }

  /**
   * Get performance trends over time (lightweight aggregation)
   */
  getPerformanceTrends(): {
    last5min: { avgLatency: number; queryCount: number };
    last15min: { avgLatency: number; queryCount: number };
    last60min: { avgLatency: number; queryCount: number };
  } {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const fifteenMinAgo = now - 15 * 60 * 1000;
    const sixtyMinAgo = now - 60 * 60 * 1000;

    const calculate = (cutoff: number) => {
      const queries = this.recentQueries.filter(q => q.timestamp > cutoff);
      const avgLatency =
        queries.length > 0 ? queries.reduce((sum, q) => sum + q.duration, 0) / queries.length : 0;
      return {
        avgLatency: Math.round(avgLatency * 100) / 100,
        queryCount: queries.length,
      };
    };

    return {
      last5min: calculate(fiveMinAgo),
      last15min: calculate(fifteenMinAgo),
      last60min: calculate(sixtyMinAgo),
    };
  }

  /**
   * Reset all metrics (useful for testing or period resets)
   */
  reset(): void {
    this.totalQueries = 0;
    this.totalLatency = 0;
    this.slowQueryCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.indexMetrics.clear();
    this.queryTypes.clear();
    this.recentQueries = [];

    this.logger.debug('Search metrics reset');
  }

  /**
   * Get memory usage of metrics service (for monitoring)
   */
  getMemoryUsage(): { recentQueries: number; indexMetrics: number; queryTypes: number } {
    return {
      recentQueries: this.recentQueries.length,
      indexMetrics: this.indexMetrics.size,
      queryTypes: this.queryTypes.size,
    };
  }
}
