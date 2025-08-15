import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface QueryPerformanceMetrics {
  duration: number;
  resultCount: number;
  queryType: string;
  isSlowQuery: boolean;
  needsAnalysis: boolean;
}

export interface QueryPlanAnalysis {
  executionTime: number;
  planningTime: number;
  totalTime: number;
  nodeType: string;
  actualRows: number;
  actualLoops: number;
}

/**
 * PostgreSQL Performance Monitor Service
 * Handles query timing, slow query detection, and EXPLAIN plan analysis
 */
@Injectable()
export class PostgreSQLPerformanceMonitorService {
  private readonly logger = new Logger(PostgreSQLPerformanceMonitorService.name);

  // Performance thresholds
  private readonly SLOW_QUERY_THRESHOLD_MS = 100;
  private readonly ANALYSIS_THRESHOLD_MS = 500;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Execute query with performance monitoring
   */
  async executeWithMonitoring(
    sql: string,
    params: any[],
    queryType: string,
    searchTerm?: string,
    indexName?: string,
  ): Promise<{ result: any[]; metrics: QueryPerformanceMetrics }> {
    const start = performance.now();

    try {
      const result = await this.dataSource.query(sql, params);
      const duration = performance.now() - start;

      const metrics = this.analyzeQueryPerformance(duration, result.length, queryType);

      // Log performance warnings if needed
      this.logPerformanceWarnings(metrics, searchTerm, indexName);

      // Trigger detailed analysis for very slow queries
      if (metrics.needsAnalysis) {
        this.analyzeSlowQuery(sql, params, queryType).catch(error => {
          this.logger.debug(`Query plan analysis failed: ${error.message}`);
        });
      }

      return { result, metrics };
    } catch (error) {
      const duration = performance.now() - start;
      this.logger.error(`Query failed after ${duration.toFixed(2)}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze query performance metrics
   */
  private analyzeQueryPerformance(
    duration: number,
    resultCount: number,
    queryType: string,
  ): QueryPerformanceMetrics {
    return {
      duration,
      resultCount,
      queryType,
      isSlowQuery: duration > this.SLOW_QUERY_THRESHOLD_MS,
      needsAnalysis: duration > this.ANALYSIS_THRESHOLD_MS,
    };
  }

  /**
   * Log performance warnings for slow queries
   */
  private logPerformanceWarnings(
    metrics: QueryPerformanceMetrics,
    searchTerm?: string,
    indexName?: string,
  ): void {
    if (metrics.isSlowQuery) {
      const context =
        searchTerm && indexName ? ` for term '${searchTerm}' in index '${indexName}'` : '';

      this.logger.warn(
        `Slow ${metrics.queryType} query detected: ${metrics.duration.toFixed(2)}ms${context}`,
      );
    }
  }

  /**
   * Perform detailed analysis of slow queries using EXPLAIN
   */
  private async analyzeSlowQuery(
    sql: string,
    params: any[],
    queryType: string,
  ): Promise<QueryPlanAnalysis | null> {
    try {
      const explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`;
      const planResult = await this.dataSource.query(explainQuery, params);

      if (planResult && planResult[0] && planResult[0]['QUERY PLAN']) {
        const plan = planResult[0]['QUERY PLAN'][0];

        const analysis: QueryPlanAnalysis = {
          executionTime: plan['Execution Time'],
          planningTime: plan['Planning Time'],
          totalTime: plan['Execution Time'] + plan['Planning Time'],
          nodeType: plan.Plan['Node Type'],
          actualRows: plan.Plan['Actual Rows'],
          actualLoops: plan.Plan['Actual Loops'],
        };

        this.logger.warn(`Query Plan Analysis (${queryType}):`, {
          executionTime: `${analysis.executionTime}ms`,
          planningTime: `${analysis.planningTime}ms`,
          totalTime: `${analysis.totalTime}ms`,
          nodeType: analysis.nodeType,
          actualRows: analysis.actualRows,
          actualLoops: analysis.actualLoops,
        });

        return analysis;
      }
    } catch (error) {
      this.logger.debug(`Failed to analyze query plan: ${error.message}`);
    }

    return null;
  }

  /**
   * Simple timing wrapper for operations that don't need full monitoring
   */
  async timeOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;

    if (duration > this.SLOW_QUERY_THRESHOLD_MS) {
      this.logger.warn(`Slow ${operationName}: ${duration.toFixed(2)}ms`);
    }

    return { result, duration };
  }

  /**
   * Log query execution summary
   */
  logQuerySummary(
    queryType: string,
    searchTerm: string,
    indexName: string,
    resultCount: number,
    totalDuration: number,
  ): void {
    this.logger.log(
      `${queryType} query completed for '${searchTerm}' in '${indexName}': ` +
        `${resultCount} results in ${totalDuration.toFixed(2)}ms`,
    );
  }

  /**
   * Create performance report for debugging
   */
  createPerformanceReport(metrics: QueryPerformanceMetrics[]): any {
    const totalQueries = metrics.length;
    const slowQueries = metrics.filter(m => m.isSlowQuery).length;
    const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / totalQueries;

    const byQueryType = metrics.reduce((acc, m) => {
      if (!acc[m.queryType]) {
        acc[m.queryType] = { count: 0, totalDuration: 0, slowCount: 0 };
      }
      acc[m.queryType].count++;
      acc[m.queryType].totalDuration += m.duration;
      if (m.isSlowQuery) acc[m.queryType].slowCount++;
      return acc;
    }, {} as Record<string, any>);

    return {
      summary: {
        totalQueries,
        slowQueries,
        slowQueryPercentage: ((slowQueries / totalQueries) * 100).toFixed(1),
        avgDuration: avgDuration.toFixed(2),
      },
      byQueryType: Object.entries(byQueryType).map(([type, stats]) => ({
        queryType: type,
        count: stats.count,
        avgDuration: (stats.totalDuration / stats.count).toFixed(2),
        slowCount: stats.slowCount,
      })),
    };
  }

  /**
   * Set custom performance thresholds
   */
  setPerformanceThresholds(slowQueryMs: number, analysisMs: number): void {
    (this as any).SLOW_QUERY_THRESHOLD_MS = slowQueryMs;
    (this as any).ANALYSIS_THRESHOLD_MS = analysisMs;
    this.logger.log(
      `Performance thresholds updated: slow=${slowQueryMs}ms, analysis=${analysisMs}ms`,
    );
  }
}
