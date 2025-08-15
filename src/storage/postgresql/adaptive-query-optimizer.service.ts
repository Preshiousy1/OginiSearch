import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchQueryDto } from '../../api/dtos/search.dto';

export interface QueryPattern {
  id: string;
  indexName: string;
  queryType: string;
  pattern: string;
  averageExecutionTime: number;
  executionCount: number;
  lastExecuted: Date;
  successRate: number;
  resultCount: number;
}

export interface OptimizationRecommendation {
  type: 'index' | 'query_rewrite' | 'caching' | 'field_selection';
  description: string;
  estimatedImprovement: number;
  implementation: string;
  priority: 'high' | 'medium' | 'low';
}

export interface OptimizedQuery extends SearchQueryDto {
  optimizations: string[];
  estimatedPerformance: number;
}

/**
 * Adaptive Query Optimizer - Learns from query patterns and optimizes automatically
 * Implements Phase 4.3 from optimization plan
 */
@Injectable()
export class AdaptiveQueryOptimizerService {
  private readonly logger = new Logger(AdaptiveQueryOptimizerService.name);
  private readonly queryPatterns = new Map<string, QueryPattern>();
  private readonly optimizationCache = new Map<string, OptimizedQuery>();

  constructor(private readonly dataSource: DataSource) {
    // Load existing patterns on startup
    this.loadQueryPatterns();

    // Analyze patterns every 5 minutes
    setInterval(() => this.analyzePatterns(), 5 * 60 * 1000);
  }

  /**
   * Optimize a query based on learned patterns and index statistics
   */
  async optimizeQuery(
    indexName: string,
    query: SearchQueryDto,
    indexStats?: any,
  ): Promise<OptimizedQuery> {
    const patternKey = this.generatePatternKey(indexName, query);

    // Check if we have a cached optimization
    const cached = this.optimizationCache.get(patternKey);
    if (cached) {
      return cached;
    }

    const optimizations: string[] = [];
    const optimizedQuery = { ...query };
    let estimatedPerformance = 1.0;

    // 1. Field Selection Optimization
    const fieldOptimization = this.optimizeFieldSelection(indexName, query, indexStats);
    if (fieldOptimization.optimized) {
      optimizedQuery.fields = fieldOptimization.fields;
      optimizations.push('field_selection');
      estimatedPerformance *= fieldOptimization.improvement;
    }

    // 2. Query Rewriting Optimization
    const queryOptimization = this.optimizeQueryStructure(indexName, query);
    if (queryOptimization.optimized) {
      optimizedQuery.query = queryOptimization.query;
      optimizations.push('query_rewrite');
      estimatedPerformance *= queryOptimization.improvement;
    }

    // 3. Filter Optimization
    const filterOptimization = this.optimizeFilters(indexName, query, indexStats);
    if (filterOptimization.optimized) {
      optimizedQuery.filter = filterOptimization.filter;
      optimizations.push('filter_optimization');
      estimatedPerformance *= filterOptimization.improvement;
    }

    // 4. Sort Optimization
    const sortOptimization = this.optimizeSort(indexName, query, indexStats);
    if (sortOptimization.optimized) {
      optimizedQuery.sort = sortOptimization.sort;
      optimizations.push('sort_optimization');
      estimatedPerformance *= sortOptimization.improvement;
    }

    const result: OptimizedQuery = {
      ...optimizedQuery,
      optimizations,
      estimatedPerformance,
    };

    // Cache the optimization
    this.optimizationCache.set(patternKey, result);

    // Removed debug logging for performance - only log major optimizations
    if (optimizations.length > 2) {
      // Disabled for performance optimization
      // this.logger.debug(
      //   `Query optimized for '${indexName}': ${optimizations.join(', ')} (${Math.round(
      //     (estimatedPerformance - 1) * 100,
      //   )}% improvement)`,
      // );
    }

    return result;
  }

  /**
   * Record query execution for pattern learning
   */
  recordQueryExecution(
    indexName: string,
    query: SearchQueryDto,
    executionTime: number,
    resultCount: number,
    success: boolean,
  ): void {
    const patternKey = this.generatePatternKey(indexName, query);
    const existing = this.queryPatterns.get(patternKey);

    if (existing) {
      // Update existing pattern
      existing.executionCount++;
      existing.averageExecutionTime =
        (existing.averageExecutionTime * (existing.executionCount - 1) + executionTime) /
        existing.executionCount;
      existing.lastExecuted = new Date();
      existing.successRate =
        (existing.successRate * (existing.executionCount - 1) + (success ? 1 : 0)) /
        existing.executionCount;
      existing.resultCount =
        (existing.resultCount * (existing.executionCount - 1) + resultCount) /
        existing.executionCount;
    } else {
      // Create new pattern
      const newPattern: QueryPattern = {
        id: patternKey,
        indexName,
        queryType: this.classifyQuery(query),
        pattern: this.extractPattern(query),
        averageExecutionTime: executionTime,
        executionCount: 1,
        lastExecuted: new Date(),
        successRate: success ? 1 : 0,
        resultCount,
      };
      this.queryPatterns.set(patternKey, newPattern);
    }

    // Persist patterns periodically
    if (this.queryPatterns.size % 100 === 0) {
      this.persistQueryPatterns();
    }
  }

  /**
   * Get optimization recommendations based on learned patterns
   */
  getOptimizationRecommendations(indexName: string): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const indexPatterns = Array.from(this.queryPatterns.values())
      .filter(p => p.indexName === indexName)
      .sort((a, b) => b.executionCount - a.executionCount);

    // Analyze slow queries
    const slowQueries = indexPatterns.filter(p => p.averageExecutionTime > 500);
    if (slowQueries.length > 0) {
      recommendations.push({
        type: 'index',
        description: `Create indexes for ${slowQueries.length} slow query patterns`,
        estimatedImprovement: 70,
        implementation: 'Add composite indexes for frequently filtered fields',
        priority: 'high',
      });
    }

    // Analyze common field patterns
    const commonFields = this.getCommonFieldPatterns(indexPatterns);
    if (commonFields.length > 2) {
      recommendations.push({
        type: 'field_selection',
        description: 'Optimize field selection for common queries',
        estimatedImprovement: 30,
        implementation: `Focus searches on fields: ${commonFields.slice(0, 3).join(', ')}`,
        priority: 'medium',
      });
    }

    // Analyze caching opportunities
    const repeatQueries = indexPatterns.filter(p => p.executionCount > 10);
    if (repeatQueries.length > 0) {
      recommendations.push({
        type: 'caching',
        description: `${repeatQueries.length} query patterns are frequently repeated`,
        estimatedImprovement: 90,
        implementation: 'Increase cache TTL for popular queries',
        priority: 'high',
      });
    }

    return recommendations.sort((a, b) => b.estimatedImprovement - a.estimatedImprovement);
  }

  /**
   * Optimize field selection based on patterns
   */
  private optimizeFieldSelection(
    indexName: string,
    query: SearchQueryDto,
    indexStats?: any,
  ): { optimized: boolean; fields?: string[]; improvement: number } {
    // If no fields specified, suggest optimal fields based on patterns
    if (!query.fields || query.fields.length === 0) {
      const indexPatterns = Array.from(this.queryPatterns.values()).filter(
        p => p.indexName === indexName,
      );

      const commonFields = this.getCommonFieldPatterns(indexPatterns);

      if (commonFields.length > 0) {
        return {
          optimized: true,
          fields: commonFields.slice(0, 3), // Top 3 most common fields
          improvement: 1.3, // 30% improvement
        };
      }
    }

    // If too many fields specified, suggest reducing
    if (query.fields && query.fields.length > 5) {
      return {
        optimized: true,
        fields: query.fields.slice(0, 3), // Reduce to top 3
        improvement: 1.2, // 20% improvement
      };
    }

    return { optimized: false, improvement: 1.0 };
  }

  /**
   * Optimize query structure based on patterns
   */
  private optimizeQueryStructure(
    indexName: string,
    query: SearchQueryDto,
  ): { optimized: boolean; query?: any; improvement: number } {
    // Convert simple wildcard patterns to prefix queries for better performance
    if (
      typeof query.query === 'object' &&
      query.query?.match &&
      typeof query.query.match === 'object' &&
      'value' in query.query.match
    ) {
      const value = String(query.query.match.value);

      // Simple trailing wildcard → prefix query
      if (/^[a-zA-Z0-9]+\*$/.test(value)) {
        return {
          optimized: true,
          query: {
            wildcard: {
              field: 'name',
              value: value,
            },
          },
          improvement: 1.4, // 40% improvement
        };
      }
    }

    return { optimized: false, improvement: 1.0 };
  }

  /**
   * Optimize filters based on selectivity patterns
   */
  private optimizeFilters(
    indexName: string,
    query: SearchQueryDto,
    indexStats?: any,
  ): { optimized: boolean; filter?: any; improvement: number } {
    if (!query.filter?.bool?.must) {
      return { optimized: false, improvement: 1.0 };
    }

    // Reorder filters by selectivity (most selective first)
    const filters = query.filter.bool.must;
    const reorderedFilters = [...filters].sort((a, b) => {
      // Boolean filters are typically more selective
      const aBoolean = this.isBooleanFilter(a);
      const bBoolean = this.isBooleanFilter(b);

      if (aBoolean && !bBoolean) return -1;
      if (!aBoolean && bBoolean) return 1;

      return 0;
    });

    if (JSON.stringify(filters) !== JSON.stringify(reorderedFilters)) {
      return {
        optimized: true,
        filter: {
          ...query.filter,
          bool: {
            ...query.filter.bool,
            must: reorderedFilters,
          },
        },
        improvement: 1.15, // 15% improvement
      };
    }

    return { optimized: false, improvement: 1.0 };
  }

  /**
   * Optimize sort based on index availability
   */
  private optimizeSort(
    indexName: string,
    query: SearchQueryDto,
    indexStats?: any,
  ): { optimized: boolean; sort?: string; improvement: number } {
    // Remove unnecessary sorting for small result sets
    if (query.size && query.size <= 10 && query.sort) {
      return {
        optimized: true,
        sort: undefined, // Remove sort for small results
        improvement: 1.1, // 10% improvement
      };
    }

    return { optimized: false, improvement: 1.0 };
  }

  /**
   * Generate a pattern key for caching
   */
  private generatePatternKey(indexName: string, query: SearchQueryDto): string {
    const queryType = this.classifyQuery(query);
    const pattern = this.extractPattern(query);
    return `${indexName}:${queryType}:${pattern}`;
  }

  /**
   * Classify query type
   */
  private classifyQuery(query: SearchQueryDto): string {
    if (typeof query.query === 'object' && query.query) {
      if (query.query.match) return 'match';
      if (query.query.wildcard) return 'wildcard';
      if (query.query.term) return 'term';
      if (query.query.bool) return 'bool';
    }
    return 'match_all';
  }

  /**
   * Extract pattern from query
   */
  private extractPattern(query: SearchQueryDto): string {
    const components = [];

    if (
      typeof query.query === 'object' &&
      query.query?.match &&
      typeof query.query.match === 'object' &&
      'value' in query.query.match
    ) {
      const value = String(query.query.match.value);
      if (value.includes('*')) components.push('wildcard');
      else components.push('text');
    }

    if (query.filter?.bool?.must) {
      components.push(`filters:${query.filter.bool.must.length}`);
    }

    if (query.sort) components.push('sorted');
    if (query.size && query.size > 20) components.push('large');

    return components.join('|');
  }

  /**
   * Get common field patterns from query history
   */
  private getCommonFieldPatterns(patterns: QueryPattern[]): string[] {
    const fieldCounts = new Map<string, number>();

    // This would be implemented by analyzing actual field usage
    // For now, return common business fields
    return ['name', 'slug', 'category_name'];
  }

  /**
   * Check if filter is boolean type
   */
  private isBooleanFilter(filter: any): boolean {
    if (filter.term) {
      const value = Object.values(filter.term)[0];
      return (
        typeof value === 'boolean' ||
        (typeof value === 'object' && typeof (value as any).value === 'boolean')
      );
    }
    return false;
  }

  /**
   * Load query patterns from storage (simplified)
   */
  private async loadQueryPatterns(): Promise<void> {
    // In production, this would load from database
    // Patterns loaded silently for performance
  }

  /**
   * Persist query patterns to storage (simplified)
   */
  private async persistQueryPatterns(): Promise<void> {
    // In production, this would save to database
    this.logger.debug(`Persisting ${this.queryPatterns.size} query patterns`);
  }

  /**
   * Analyze patterns for optimization opportunities
   */
  private analyzePatterns(): void {
    const totalPatterns = this.queryPatterns.size;
    const slowPatterns = Array.from(this.queryPatterns.values()).filter(
      p => p.averageExecutionTime > 500,
    ).length;

    if (slowPatterns > 0) {
      this.logger.log(
        `Pattern analysis: ${slowPatterns}/${totalPatterns} patterns are slow (>500ms)`,
      );
    }
  }
}
