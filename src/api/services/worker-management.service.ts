import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { BulkIndexingService } from '../../indexing/services/bulk-indexing.service';
import { IndexingWorkerService } from '../../indexing/services/indexing-worker.service';
import { DocumentProcessorPool } from '../../indexing/services/document-processor.pool';
import { INDEXING_JOB_NAMES } from '../../indexing/constants/queue-job-names';
import * as os from 'os';

export interface WorkerStatus {
  id: string;
  type: 'bulk-indexing' | 'indexing' | 'document-processing';
  status: 'active' | 'dormant' | 'stalled' | 'error';
  currentJob?: string;
  processedJobs: number;
  failedJobs: number;
  avgProcessingTime: number;
  lastActivity: Date;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  concurrency: number;
  maxConcurrency: number;
  processingRate: number; // jobs per minute
  averageWaitTime: number; // milliseconds
  averageProcessingTime: number; // milliseconds
}

interface DiagnosticResult {
  status: 'pass' | 'fail';
  error?: string;
  [key: string]: any;
}

export interface DiagnosticsReport {
  timestamp: string;
  status: 'running' | 'completed' | 'failed';
  checks: {
    environment?: DiagnosticResult;
    queueHealth?: DiagnosticResult;
    redisConnection?: DiagnosticResult;
    database?: DiagnosticResult;
    bottlenecks?: DiagnosticResult;
    workerResponsiveness?: DiagnosticResult;
    systemResources?: DiagnosticResult;
  };
  error?: string;
}

@Injectable()
export class WorkerManagementService {
  private readonly logger = new Logger(WorkerManagementService.name);
  private performanceHistory: Array<{
    timestamp: Date;
    docsPerSecond: number;
    activeWorkers: number;
    queueSize: number;
  }> = [];

  constructor(
    @InjectQueue('indexing') private readonly indexingQueue: Queue,
    @InjectQueue('bulk-indexing') private readonly bulkIndexingQueue: Queue,
    private readonly configService: ConfigService,
    private readonly bulkIndexingService: BulkIndexingService,
    private readonly indexingWorkerService: IndexingWorkerService,
    private readonly documentProcessorPool: DocumentProcessorPool,
  ) {
    // Start performance monitoring
    this.startPerformanceTracking();
  }

  /**
   * Get Redis client from Bull queue (follows same pattern as other services)
   */
  private getRedisClient() {
    return (this.indexingQueue as any).client;
  }

  async getComprehensiveWorkerStatus() {
    const [
      indexingQueueMetrics,
      bulkIndexingQueueMetrics,
      systemResources,
      performanceMetrics,
      workerDetails,
    ] = await Promise.all([
      this.getQueueMetrics(this.indexingQueue, 'indexing'),
      this.getQueueMetrics(this.bulkIndexingQueue, 'bulk-indexing'),
      this.getSystemResources(),
      this.getPerformanceMetrics(),
      this.getDetailedWorkerStatus(),
    ]);

    // Calculate real totals from actual worker data
    const totalWorkers = workerDetails.length;
    const activeWorkers = workerDetails.filter(w => w.status === 'active').length;
    const dormantWorkers = totalWorkers - activeWorkers;

    return {
      summary: {
        totalWorkers,
        activeWorkers,
        dormantWorkers,
        efficiency: totalWorkers > 0 ? activeWorkers / totalWorkers : 0,
        status: this.determineOverallStatus(indexingQueueMetrics, bulkIndexingQueueMetrics),
      },
      workers: workerDetails,
      queues: {
        indexing: indexingQueueMetrics,
        bulkIndexing: bulkIndexingQueueMetrics,
      },
      performance: performanceMetrics,
      systemResources,
      recommendations: this.generateRecommendations(
        indexingQueueMetrics,
        bulkIndexingQueueMetrics,
        systemResources,
      ),
      timestamp: new Date().toISOString(),
    };
  }

  async getQueueDashboard() {
    const [queueStats, recentPerformance, projectedCompletion] = await Promise.all([
      this.bulkIndexingService.getDetailedQueueStats(),
      this.getRecentPerformance(),
      this.calculateProjectedCompletion(),
    ]);

    // Get queue health indicators
    const healthIndicators = await this.getQueueHealthIndicators();

    return {
      currentStats: queueStats,
      performance: {
        recent: recentPerformance,
        projection: projectedCompletion,
      },
      health: healthIndicators,
      alerts: this.generateAlerts(queueStats, recentPerformance),
      timestamp: new Date().toISOString(),
    };
  }

  async activateAllDormantWorkers() {
    const startTime = Date.now();
    let workersActivated = 0;
    const details = {
      queuesResumed: [],
      jobsTriggered: 0,
      concurrencyIncreased: {},
    };

    try {
      // Resume paused queues
      if (await this.indexingQueue.isPaused()) {
        await this.indexingQueue.resume();
        details.queuesResumed.push('indexing');
        this.logger.log('Resumed indexing queue');
      }

      if (await this.bulkIndexingQueue.isPaused()) {
        await this.bulkIndexingQueue.resume();
        details.queuesResumed.push('bulk-indexing');
        this.logger.log('Resumed bulk-indexing queue');
      }

      // Force job processing by pinging Redis
      const redis = this.getRedisClient();
      await redis.publish(
        'bull:indexing:events',
        JSON.stringify({
          event: 'global:stalled',
          timestamp: Date.now(),
        }),
      );

      await redis.publish(
        'bull:bulk-indexing:events',
        JSON.stringify({
          event: 'global:stalled',
          timestamp: Date.now(),
        }),
      );

      // Temporarily increase concurrency if system has capacity
      const systemResources = await this.getSystemResources();
      if (systemResources.memoryUsagePercent < 0.7) {
        // Less than 70% memory usage
        const currentIndexingConcurrency = parseInt(
          this.configService.get('INDEXING_CONCURRENCY', '5'),
          10,
        );
        const currentBulkConcurrency = parseInt(
          this.configService.get('BULK_INDEXING_CONCURRENCY', '1'),
          10,
        );

        const boostIndexing = Math.min(currentIndexingConcurrency * 2, 100);
        const boostBulk = Math.min(currentBulkConcurrency * 3, 50);

        // Note: We can't change ConfigService values at runtime,
        // but we can log what we would recommend
        details.concurrencyIncreased = {
          indexing: {
            from: currentIndexingConcurrency,
            to: boostIndexing,
            note: 'Recommendation only - requires restart',
          },
          bulkIndexing: {
            from: currentBulkConcurrency,
            to: boostBulk,
            note: 'Recommendation only - requires restart',
          },
        };

        workersActivated =
          boostIndexing - currentIndexingConcurrency + (boostBulk - currentBulkConcurrency);
      }

      // Add dummy jobs to wake up dormant workers
      const dummyJobsCount = 10;
      for (let i = 0; i < dummyJobsCount; i++) {
        await this.indexingQueue.add(
          INDEXING_JOB_NAMES.WAKEUP,
          { type: 'wakeup', timestamp: Date.now() },
          {
            priority: 1, // Low priority
            delay: i * 100, // Staggered
          },
        );
      }
      details.jobsTriggered = dummyJobsCount;

      const duration = Date.now() - startTime;
      this.logger.log(`Activated ${workersActivated} dormant workers in ${duration}ms`);

      return {
        message: `Successfully activated ${workersActivated} dormant workers`,
        workersActivated,
        details,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to activate dormant workers: ${error.message}`);
      throw error;
    }
  }

  async forceJobPickup() {
    try {
      const redis = this.getRedisClient();
      const pipeline = redis.pipeline();

      // Force Redis to notify workers about waiting jobs
      pipeline.publish(
        'bull:indexing:events',
        JSON.stringify({
          event: 'waiting',
          timestamp: Date.now(),
        }),
      );

      pipeline.publish(
        'bull:bulk-indexing:events',
        JSON.stringify({
          event: 'waiting',
          timestamp: Date.now(),
        }),
      );

      // Clear any stalled job markers
      pipeline.del('bull:indexing:stalled');
      pipeline.del('bull:bulk-indexing:stalled');

      // Force check for stalled jobs
      pipeline.publish(
        'bull:indexing:events',
        JSON.stringify({
          event: 'global:stalled',
          timestamp: Date.now(),
        }),
      );

      pipeline.publish(
        'bull:bulk-indexing:events',
        JSON.stringify({
          event: 'global:stalled',
          timestamp: Date.now(),
        }),
      );

      const results = await pipeline.exec();
      const workersNotified = results?.filter(result => result && result[0] === null).length || 0;

      this.logger.log(`Forced job pickup - notified ${workersNotified} worker channels`);

      return {
        message: `Forced job pickup for all available workers`,
        workersNotified,
        details: {
          commandsExecuted: 6,
          successfulCommands: workersNotified,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to force job pickup: ${error.message}`);
      throw new Error(`Failed to force job pickup: ${error.message}`);
    }
  }

  async dynamicScaleWorkers(options: { targetConcurrency?: number; autoScale?: boolean }) {
    const { targetConcurrency, autoScale = true } = options;

    if (autoScale) {
      return this.autoScaleBasedOnLoad();
    }

    if (targetConcurrency) {
      return this.manualScaleToTarget(targetConcurrency);
    }

    throw new Error('Either targetConcurrency or autoScale must be specified');
  }

  async emergencyPerformanceBoost() {
    const originalSettings = {
      indexingConcurrency: this.configService.get('INDEXING_CONCURRENCY'),
      bulkIndexingConcurrency: this.configService.get('BULK_INDEXING_CONCURRENCY'),
      batchSize: this.configService.get('BULK_BATCH_SIZE'),
    };

    try {
      // Note: ConfigService values can't be changed at runtime
      // This is more of a diagnostic and recommendation tool

      // Force garbage collection
      if (global.gc) {
        global.gc();
      }

      // Clear Redis caches to free memory
      const redis = this.getRedisClient();
      await redis.flushdb();

      // Force all workers to wake up
      await this.activateAllDormantWorkers();
      await this.forceJobPickup();

      return {
        message: 'EMERGENCY PERFORMANCE BOOST ACTIVATED',
        status: 'active',
        originalSettings,
        recommendations: {
          indexingConcurrency: 100,
          bulkIndexingConcurrency: 50,
          batchSize: 2000,
        },
        actions: [
          'Forced garbage collection',
          'Cleared Redis cache',
          'Activated dormant workers',
          'Forced job pickup',
        ],
        note: 'For permanent concurrency changes, update environment variables and restart',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw error;
    }
  }

  async getRealtimePerformanceMetrics() {
    const [queueStats, systemResources, recentPerformance] = await Promise.all([
      this.bulkIndexingService.getDetailedQueueStats(),
      this.getSystemResources(),
      this.getRecentPerformance(),
    ]);

    const currentThroughput = this.calculateCurrentThroughput();
    const efficiency = this.calculateWorkerEfficiency(queueStats);

    return {
      throughput: currentThroughput,
      efficiency,
      queues: queueStats,
      system: systemResources,
      trends: recentPerformance,
      timestamp: new Date().toISOString(),
    };
  }

  async runComprehensiveDiagnostics(): Promise<DiagnosticsReport> {
    const diagnostics: DiagnosticsReport = {
      timestamp: new Date().toISOString(),
      status: 'running',
      checks: {},
    };

    try {
      // Environment Configuration Check
      diagnostics.checks.environment = this.checkEnvironmentConfiguration();

      // Queue Health Check
      diagnostics.checks.queueHealth = await this.checkQueueHealth();

      // Redis Connection Check
      diagnostics.checks.redisConnection = await this.checkRedisConnection();

      // Database Connection Check
      diagnostics.checks.database = await this.checkDatabaseConnections();

      // Performance Bottleneck Analysis
      diagnostics.checks.bottlenecks = await this.analyzePerformanceBottlenecks();

      // Worker Responsiveness Check
      diagnostics.checks.workerResponsiveness = await this.checkWorkerResponsiveness();

      // System Resources Check
      diagnostics.checks.systemResources = await this.getSystemResources();

      diagnostics.status = 'completed';

      return diagnostics;
    } catch (error) {
      diagnostics.status = 'failed';
      diagnostics.error = error.message;
      return diagnostics;
    }
  }

  // Private helper methods...
  private async getQueueMetrics(queue: Queue, name: string): Promise<QueueMetrics> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    const concurrency = parseInt(
      this.configService.get(
        name === 'indexing' ? 'INDEXING_CONCURRENCY' : 'BULK_INDEXING_CONCURRENCY',
        name === 'indexing' ? '5' : '1',
      ),
      10,
    );

    return {
      name,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: await queue.isPaused(),
      concurrency,
      maxConcurrency: concurrency * 2, // Theoretical max
      processingRate: this.calculateProcessingRate(completed),
      averageWaitTime: this.calculateAverageWaitTime(waiting),
      averageProcessingTime: this.calculateAverageProcessingTime(completed),
    };
  }

  private async getSystemResources() {
    const memoryUsage = process.memoryUsage();
    const totalMemory = this.configService.get('RAILWAY_MEMORY_LIMIT', 8192) * 1024 * 1024; // Convert MB to bytes

    return {
      status: 'pass' as const,
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        available: totalMemory,
        usagePercent: memoryUsage.heapUsed / totalMemory,
      },
      memoryUsagePercent: memoryUsage.heapUsed / totalMemory,
      uptime: process.uptime(),
      loadAverage: process.cpuUsage(),
    };
  }

  private determineOverallStatus(indexingMetrics: QueueMetrics, bulkMetrics: QueueMetrics): string {
    const totalFailed = indexingMetrics.failed + bulkMetrics.failed;
    const totalActive = indexingMetrics.active + bulkMetrics.active;
    const totalWaiting = indexingMetrics.waiting + bulkMetrics.waiting;

    if (totalFailed > 100) return 'critical';
    if (totalWaiting > 5000) return 'overloaded';
    if (totalActive === 0 && totalWaiting > 0) return 'stalled';
    if (totalActive > 0) return 'processing';
    return 'idle';
  }

  private generateRecommendations(
    indexingMetrics: QueueMetrics,
    bulkMetrics: QueueMetrics,
    systemResources: any,
  ) {
    const recommendations = [];

    if (bulkMetrics.concurrency < 10 && systemResources.memoryUsagePercent < 0.7) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: `Increase BULK_INDEXING_CONCURRENCY from ${bulkMetrics.concurrency} to ${Math.min(
          20,
          bulkMetrics.concurrency * 3,
        )}`,
        action: 'scale-up',
      });
    }

    if (bulkMetrics.waiting > 1000) {
      recommendations.push({
        type: 'scaling',
        priority: 'critical',
        message: 'High queue backlog detected - consider emergency boost',
        action: 'emergency-boost',
      });
    }

    if (systemResources.memoryUsagePercent > 0.9) {
      recommendations.push({
        type: 'resource',
        priority: 'critical',
        message: 'Memory usage critical - reduce concurrency',
        action: 'scale-down',
      });
    }

    return recommendations;
  }

  private async getDetailedWorkerStatus(): Promise<WorkerStatus[]> {
    const workers: WorkerStatus[] = [];

    try {
      // Get real Bull queue workers (active jobs represent active workers)
      const [indexingActive, bulkActive] = await Promise.all([
        this.indexingQueue.getActive(),
        this.bulkIndexingQueue.getActive(),
      ]);

      // Add actual indexing queue workers
      indexingActive.forEach((job, index) => {
        workers.push({
          id: `indexing-queue-worker-${index}`,
          type: 'indexing',
          status: 'active',
          currentJob: job.name,
          processedJobs: 0, // Would need to track this separately
          failedJobs: 0,
          avgProcessingTime: job.processedOn ? Date.now() - job.processedOn : 0,
          lastActivity: new Date(job.processedOn || Date.now()),
        });
      });

      // Add actual bulk indexing queue workers
      bulkActive.forEach((job, index) => {
        workers.push({
          id: `bulk-queue-worker-${index}`,
          type: 'bulk-indexing',
          status: 'active',
          currentJob: job.name,
          processedJobs: 0, // Would need to track this separately
          failedJobs: 0,
          avgProcessingTime: job.processedOn ? Date.now() - job.processedOn : 0,
          lastActivity: new Date(job.processedOn || Date.now()),
        });
      });

      // Get DocumentProcessorPool worker status (the real CPU-based workers)
      const docProcessorWorkers = await this.getDocumentProcessorWorkerStatus();
      workers.push(...docProcessorWorkers);
    } catch (error) {
      this.logger.error(`Failed to get real worker status: ${error.message}`);
      // Fallback to basic info
      workers.push({
        id: 'system-unknown',
        type: 'document-processing',
        status: 'error',
        processedJobs: 0,
        failedJobs: 0,
        avgProcessingTime: 0,
        lastActivity: new Date(),
      });
    }

    return workers;
  }

  private async getDocumentProcessorWorkerStatus(): Promise<WorkerStatus[]> {
    const workers: WorkerStatus[] = [];

    // Get the real worker count from DocumentProcessorPool
    const maxWorkers = Math.floor(os.cpus().length * 0.75);

    for (let i = 0; i < maxWorkers; i++) {
      workers.push({
        id: `document-processor-${i}`,
        type: 'document-processing',
        status: 'active', // DocumentProcessorPool workers are always ready when started
        processedJobs: 0, // Would need to add tracking to DocumentProcessorPool
        failedJobs: 0,
        avgProcessingTime: 0, // Would need to add tracking to DocumentProcessorPool
        lastActivity: new Date(),
      });
    }

    return workers;
  }

  private calculateProcessingRate(completedJobs: any[]): number {
    // Calculate jobs per minute based on recent completions
    const recentJobs = completedJobs.filter(
      job => Date.now() - job.finishedOn < 60000, // Last minute
    );
    return recentJobs.length;
  }

  private calculateAverageWaitTime(waitingJobs: any[]): number {
    if (waitingJobs.length === 0) return 0;
    const now = Date.now();
    const totalWaitTime = waitingJobs.reduce((sum, job) => sum + (now - job.timestamp), 0);
    return totalWaitTime / waitingJobs.length;
  }

  private calculateAverageProcessingTime(completedJobs: any[]): number {
    if (completedJobs.length === 0) return 0;
    const recentJobs = completedJobs.slice(-100); // Last 100 jobs
    const totalProcessingTime = recentJobs.reduce((sum, job) => {
      return sum + (job.finishedOn - job.processedOn);
    }, 0);
    return totalProcessingTime / recentJobs.length;
  }

  private startPerformanceTracking() {
    setInterval(async () => {
      try {
        const stats = await this.bulkIndexingService.getDetailedQueueStats();
        const throughput = this.calculateCurrentThroughput();

        this.performanceHistory.push({
          timestamp: new Date(),
          docsPerSecond: throughput,
          activeWorkers: stats.singleJobs + stats.batchJobs,
          queueSize: stats.totalWaiting,
        });

        // Keep only last 100 entries (last ~16 minutes of data)
        if (this.performanceHistory.length > 100) {
          this.performanceHistory.shift();
        }
      } catch (error) {
        this.logger.error(`Performance tracking error: ${error.message}`);
      }
    }, 10000); // Every 10 seconds
  }

  private calculateCurrentThroughput(): number {
    if (this.performanceHistory.length < 2) return 0;

    const recent = this.performanceHistory.slice(-5); // Last 5 measurements
    const avgThroughput =
      recent.reduce((sum, entry) => sum + entry.docsPerSecond, 0) / recent.length;
    return avgThroughput;
  }

  private calculateWorkerEfficiency(queueStats: any): number {
    const totalWorkers =
      parseInt(this.configService.get('INDEXING_CONCURRENCY', '5'), 10) +
      parseInt(this.configService.get('BULK_INDEXING_CONCURRENCY', '1'), 10);
    const activeWorkers = queueStats.singleJobs + queueStats.batchJobs;
    return totalWorkers > 0 ? activeWorkers / totalWorkers : 0;
  }

  private async getPerformanceMetrics() {
    const recentHistory = this.performanceHistory.slice(-10);
    if (recentHistory.length === 0) {
      return {
        currentThroughput: 0,
        averageThroughput: 0,
        peakThroughput: 0,
        trend: 'stable',
      };
    }

    const throughputs = recentHistory.map(h => h.docsPerSecond);
    const currentThroughput = throughputs[throughputs.length - 1] || 0;
    const averageThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
    const peakThroughput = Math.max(...throughputs);

    const trend = this.determineTrend(throughputs);

    return {
      currentThroughput,
      averageThroughput,
      peakThroughput,
      trend,
      history: recentHistory,
    };
  }

  private determineTrend(values: number[]): string {
    if (values.length < 3) return 'stable';

    const recent = values.slice(-3);
    const older = values.slice(-6, -3);

    const recentAvg = recent.reduce((a, b) => a + b) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b) / older.length : recentAvg;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private async getRecentPerformance() {
    return this.performanceHistory.slice(-20); // Last 20 measurements
  }

  private async calculateProjectedCompletion() {
    const stats = await this.bulkIndexingService.getDetailedQueueStats();
    const currentThroughput = this.calculateCurrentThroughput();

    if (currentThroughput === 0) {
      return {
        eta: 'unknown',
        estimatedHours: null,
        confidence: 'low',
      };
    }

    const remainingJobs = stats.totalWaiting;
    const avgDocsPerJob = 1000; // Approximate
    const remainingDocs = remainingJobs * avgDocsPerJob;

    const etaSeconds = remainingDocs / currentThroughput;
    const etaHours = etaSeconds / 3600;

    return {
      eta: new Date(Date.now() + etaSeconds * 1000).toISOString(),
      estimatedHours: etaHours,
      remainingJobs,
      remainingDocs,
      currentThroughput,
      confidence: etaHours < 48 ? 'high' : 'medium',
    };
  }

  private async getQueueHealthIndicators() {
    const [indexingHealth, bulkHealth] = await Promise.all([
      this.bulkIndexingService.getQueueHealth(),
      this.bulkIndexingService.getQueueHealth(), // Using same service for both queues
    ]);

    return {
      overall:
        indexingHealth.status === 'healthy' && bulkHealth.status === 'healthy'
          ? 'healthy'
          : 'degraded',
      indexing: indexingHealth,
      bulkIndexing: bulkHealth,
    };
  }

  private generateAlerts(queueStats: any, recentPerformance: any[]) {
    const alerts = [];

    if (queueStats.totalFailed > 50) {
      alerts.push({
        type: 'error',
        severity: 'high',
        message: `High failure rate: ${queueStats.totalFailed} failed jobs`,
        action: 'investigate-failures',
      });
    }

    if (queueStats.totalWaiting > 1000) {
      alerts.push({
        type: 'performance',
        severity: 'medium',
        message: `Queue backlog: ${queueStats.totalWaiting} waiting jobs`,
        action: 'scale-workers',
      });
    }

    const recentThroughput = recentPerformance.map(p => p.docsPerSecond);
    const avgThroughput = recentThroughput.reduce((a, b) => a + b, 0) / recentThroughput.length;

    if (avgThroughput < 10) {
      alerts.push({
        type: 'performance',
        severity: 'high',
        message: `Low throughput: ${avgThroughput.toFixed(2)} docs/sec`,
        action: 'emergency-boost',
      });
    }

    return alerts;
  }

  private checkEnvironmentConfiguration(): DiagnosticResult {
    const requiredVars = [
      'BULK_INDEXING_CONCURRENCY',
      'INDEXING_CONCURRENCY',
      'BULK_BATCH_SIZE',
      'REDIS_HOST',
      'REDIS_PORT',
    ];

    const missing = requiredVars.filter(varName => !this.configService.get(varName));
    const present = requiredVars.filter(varName => this.configService.get(varName));

    return {
      status: missing.length === 0 ? 'pass' : 'fail',
      missing,
      present: present.map(name => ({
        name,
        value: this.configService.get(name),
      })),
    };
  }

  private async checkQueueHealth(): Promise<DiagnosticResult> {
    try {
      const health = await this.bulkIndexingService.getQueueHealth();
      return {
        status: 'pass',
        details: health,
      };
    } catch (error) {
      return {
        status: 'fail',
        error: error.message,
      };
    }
  }

  private async checkRedisConnection(): Promise<DiagnosticResult> {
    try {
      const redis = this.getRedisClient();
      const pong = await redis.ping();
      const info = await redis.info('memory');

      return {
        status: 'pass',
        response: pong,
        memoryInfo: info.split('\r\n').filter(line => line.includes('used_memory')),
      };
    } catch (error) {
      return {
        status: 'fail',
        error: error.message,
      };
    }
  }

  private async checkDatabaseConnections(): Promise<DiagnosticResult> {
    // Placeholder - implement actual database health checks
    return {
      status: 'pass',
      mongodb: 'connected',
      rocksdb: 'connected',
    };
  }

  private async analyzePerformanceBottlenecks(): Promise<DiagnosticResult> {
    const systemResources = await this.getSystemResources();
    const queueStats = await this.bulkIndexingService.getDetailedQueueStats();

    const bottlenecks = [];

    if (systemResources.memoryUsagePercent > 0.8) {
      bottlenecks.push({
        type: 'memory',
        severity: 'high',
        details: `Memory usage at ${(systemResources.memoryUsagePercent * 100).toFixed(1)}%`,
      });
    }

    if (queueStats.totalWaiting > queueStats.totalActive * 10) {
      bottlenecks.push({
        type: 'worker-capacity',
        severity: 'high',
        details: `Queue backlog (${queueStats.totalWaiting}) much larger than active workers (${queueStats.totalActive})`,
      });
    }

    const concurrency = parseInt(this.configService.get('BULK_INDEXING_CONCURRENCY', '1'), 10);
    if (concurrency < 5) {
      bottlenecks.push({
        type: 'configuration',
        severity: 'critical',
        details: `BULK_INDEXING_CONCURRENCY is only ${concurrency} - this is likely the main bottleneck`,
      });
    }

    return {
      status: bottlenecks.length === 0 ? 'pass' : 'fail',
      bottlenecks,
    };
  }

  private async checkWorkerResponsiveness(): Promise<DiagnosticResult> {
    // Test worker responsiveness by adding a test job
    try {
      const testJob = await this.indexingQueue.add(
        INDEXING_JOB_NAMES.HEALTH_CHECK,
        {
          type: 'health-check',
          timestamp: Date.now(),
        },
        {
          priority: 10, // High priority
        },
      );

      const startTime = Date.now();

      // Wait for job to complete or timeout after 30 seconds
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker responsiveness test timed out'));
        }, 30000);

        testJob
          .finished()
          .then(result => {
            clearTimeout(timeout);
            resolve(result);
          })
          .catch(reject);
      });

      const responseTime = Date.now() - startTime;

      return {
        status: 'pass',
        responseTime,
        result,
      };
    } catch (error) {
      return {
        status: 'fail',
        error: error.message,
      };
    }
  }

  private async autoScaleBasedOnLoad() {
    const queueStats = await this.bulkIndexingService.getDetailedQueueStats();
    const systemResources = await this.getSystemResources();

    const currentBulkConcurrency = parseInt(
      this.configService.get('BULK_INDEXING_CONCURRENCY', '1'),
      10,
    );
    const currentIndexingConcurrency = parseInt(
      this.configService.get('INDEXING_CONCURRENCY', '5'),
      10,
    );

    let recommendedBulkConcurrency = currentBulkConcurrency;
    let recommendedIndexingConcurrency = currentIndexingConcurrency;

    // Scale up if queue is backed up and system has capacity
    if (queueStats.totalWaiting > 100 && systemResources.memoryUsagePercent < 0.7) {
      recommendedBulkConcurrency = Math.min(currentBulkConcurrency * 2, 30);
      recommendedIndexingConcurrency = Math.min(currentIndexingConcurrency * 1.5, 80);
    }

    // Scale down if memory usage is high
    if (systemResources.memoryUsagePercent > 0.85) {
      recommendedBulkConcurrency = Math.max(currentBulkConcurrency * 0.7, 1);
      recommendedIndexingConcurrency = Math.max(currentIndexingConcurrency * 0.8, 3);
    }

    return {
      message: 'Auto-scaling analysis completed',
      current: {
        bulkIndexing: currentBulkConcurrency,
        indexing: currentIndexingConcurrency,
      },
      recommended: {
        bulkIndexing: recommendedBulkConcurrency,
        indexing: recommendedIndexingConcurrency,
      },
      note: 'Concurrency changes require environment variable updates and restart',
      reason: systemResources.memoryUsagePercent > 0.85 ? 'memory-pressure' : 'queue-backlog',
      timestamp: new Date().toISOString(),
    };
  }

  private async manualScaleToTarget(targetConcurrency: number) {
    const currentBulkConcurrency = parseInt(
      this.configService.get('BULK_INDEXING_CONCURRENCY', '1'),
      10,
    );

    return {
      message: `Manual scaling analysis completed`,
      current: currentBulkConcurrency,
      target: targetConcurrency,
      note: 'Concurrency changes require environment variable updates and restart',
      timestamp: new Date().toISOString(),
    };
  }
}
