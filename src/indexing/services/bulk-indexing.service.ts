import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from 'src/document/document.service';
import { IndexService } from 'src/index/index.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export interface BulkIndexingOptions {
  batchSize?: number;
  concurrency?: number;
  skipDuplicates?: boolean;
  enableProgress?: boolean;
  priority?: number;
  retryAttempts?: number;
}

export interface BulkIndexingProgress {
  processed: number;
  total: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  documentsPerSecond: number;
  estimatedTimeRemaining: number;
  errors: number;
  skipped: number;
}

export interface BulkIndexingResult {
  successCount: number;
  errorCount: number;
  skippedCount: number;
  totalProcessed: number;
  duration: number;
  errors: Array<{
    documentId: string;
    error: string;
  }>;
}

export interface SingleIndexingJob {
  indexName: string;
  documentId: string;
  document: any;
  priority?: number;
  metadata?: Record<string, any>;
}

export interface BatchIndexingJob {
  indexName: string;
  documents: Array<{ id: string; document: any }>;
  batchId: string;
  options: BulkIndexingOptions;
  metadata?: Record<string, any>;
}

@Injectable()
export class BulkIndexingService {
  private readonly logger = new Logger(BulkIndexingService.name);

  // Configuration constants
  private readonly DEFAULT_BATCH_SIZE = 500;
  private readonly DEFAULT_CONCURRENCY = 3;

  constructor(
    @Inject(forwardRef(() => DocumentService))
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    private readonly configService: ConfigService,
    @InjectQueue('indexing')
    private indexingQueue: Queue,
  ) {}

  /**
   * Queue a single document for indexing
   */
  async queueSingleDocument(
    indexName: string,
    documentId: string,
    document: any,
    options: Partial<BulkIndexingOptions> = {},
  ): Promise<string> {
    const jobId = this.generateJobId('single', indexName, documentId);

    const job: SingleIndexingJob = {
      indexName,
      documentId,
      document,
      priority: options.priority || 5,
      metadata: {
        queuedAt: new Date().toISOString(),
        source: 'api',
      },
    };

    // Add to Bull queue
    await this.indexingQueue.add('single', job, {
      jobId,
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: options.retryAttempts || 3,
      priority: options.priority || 5,
    });

    this.logger.debug(
      `Queued single document ${documentId} for index ${indexName} with job ID ${jobId}`,
    );
    return jobId;
  }

  /**
   * Queue a batch of documents for indexing
   */
  async queueBatchDocuments(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    options: BulkIndexingOptions = {},
  ): Promise<string> {
    const batchId = this.generateJobId('batch', indexName);
    const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;

    if (documents.length === 0) {
      this.logger.warn(`No documents to process for batch ${batchId}`);
      return null;
    }

    // Split into smaller batches
    const batches = this.chunkArray(documents, batchSize);
    const totalBatches = batches.length;

    // Queue each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchJobId = `${batchId}:${i}`;

      const job: BatchIndexingJob = {
        indexName,
        documents: batch,
        batchId: batchJobId,
        options,
        metadata: {
          queuedAt: new Date().toISOString(),
          parentBatchId: batchId,
          batchNumber: i + 1,
          totalBatches,
          source: 'bulk',
        },
      };

      await this.indexingQueue.add('batch', job, {
        jobId: batchJobId,
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: options.retryAttempts || 3,
        priority: options.priority || 3,
      });
    }

    this.logger.log(`Queued ${totalBatches} batches for bulk indexing with batch ID ${batchId}`);
    return batchId;
  }

  /**
   * Get detailed queue statistics by job type
   */
  async getDetailedQueueStats(): Promise<{
    singleJobs: number;
    batchJobs: number;
    failedSingleJobs: number;
    failedBatchJobs: number;
    totalWaiting: number;
    totalActive: number;
    totalCompleted: number;
    totalFailed: number;
  }> {
    try {
      // Get all jobs in different states
      const [waitingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
        this.indexingQueue.getWaiting(),
        this.indexingQueue.getActive(),
        this.indexingQueue.getCompleted(),
        this.indexingQueue.getFailed(),
      ]);

      // Count jobs by type
      let singleJobs = 0;
      let batchJobs = 0;
      let failedSingleJobs = 0;
      let failedBatchJobs = 0;

      // Count waiting and active jobs
      [...waitingJobs, ...activeJobs].forEach(job => {
        if (job.name === 'single') {
          singleJobs++;
        } else if (job.name === 'batch') {
          batchJobs++;
        }
      });

      // Count failed jobs by type
      failedJobs.forEach(job => {
        if (job.name === 'single') {
          failedSingleJobs++;
        } else if (job.name === 'batch') {
          failedBatchJobs++;
        }
      });

      this.logger.debug(`Queue stats: ${singleJobs} single, ${batchJobs} batch, ${failedSingleJobs} failed single, ${failedBatchJobs} failed batch`);

      return {
        singleJobs,
        batchJobs,
        failedSingleJobs,
        failedBatchJobs,
        totalWaiting: waitingJobs.length,
        totalActive: activeJobs.length,
        totalCompleted: completedJobs.length,
        totalFailed: failedJobs.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get detailed queue stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.indexingQueue.getWaiting(),
      this.indexingQueue.getActive(),
      this.indexingQueue.getCompleted(),
      this.indexingQueue.getFailed(),
      this.indexingQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Get queue health status
   */
  async getQueueHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    message: string;
    stats: any;
  }> {
    try {
      const stats = await this.getQueueStats();
      const totalJobs = stats.waiting + stats.active + stats.delayed;

      if (stats.failed > 10 && stats.failed > totalJobs * 0.1) {
        return {
          status: 'unhealthy',
          message: 'High failure rate detected',
          stats,
        };
      }

      if (stats.waiting > 1000) {
        return {
          status: 'degraded',
          message: 'High queue backlog',
          stats,
        };
      }

      return {
        status: 'healthy',
        message: 'Queue operating normally',
        stats,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Queue error: ${error.message}`,
        stats: null,
      };
    }
  }

  /**
   * Clean completed and failed jobs
   */
  async cleanQueue(): Promise<void> {
    this.logger.log('Starting comprehensive queue cleanup...');
    
    try {
      // Get current stats before cleaning
      const statsBefore = await this.getDetailedQueueStats();
      this.logger.log(`Before cleanup: ${statsBefore.singleJobs} single, ${statsBefore.batchJobs} batch, ${statsBefore.totalWaiting} waiting, ${statsBefore.totalActive} active, ${statsBefore.totalFailed} failed`);

      // Clean completed jobs (aggressive - older than 1 second)
      await this.indexingQueue.clean(1000, 'completed');
      
      // Clean failed jobs (aggressive - older than 1 second)  
      await this.indexingQueue.clean(1000, 'failed');
      
      // Clean active jobs (force clean stuck jobs)
      await this.indexingQueue.clean(0, 'active');
      
      // Clean delayed jobs
      await this.indexingQueue.clean(0, 'delayed');

      // For waiting jobs, we need to manually remove them
      const waitingJobs = await this.indexingQueue.getWaiting();
      this.logger.log(`Manually removing ${waitingJobs.length} waiting jobs`);
      
      for (const job of waitingJobs) {
        try {
          await job.remove();
        } catch (error) {
          this.logger.warn(`Failed to remove waiting job ${job.id}: ${error.message}`);
        }
      }

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get stats after cleaning
      const statsAfter = await this.getDetailedQueueStats();
      this.logger.log(`After cleanup: ${statsAfter.singleJobs} single, ${statsAfter.batchJobs} batch, ${statsAfter.totalWaiting} waiting, ${statsAfter.totalActive} active, ${statsAfter.totalFailed} failed`);
      
      this.logger.log('Queue cleanup completed successfully');
    } catch (error) {
      this.logger.error(`Queue cleanup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    await this.indexingQueue.pause();
    this.logger.log('Indexing queue paused');
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    await this.indexingQueue.resume();
    this.logger.log('Indexing queue resumed');
  }

  // Helper methods

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Generate unique job ID for tracking
   */
  private generateJobId(type: 'single' | 'batch', indexName: string, identifier?: string): string {
    const timestamp = Date.now();
    const randomComponent = Math.random().toString(36).substr(2, 6); // Add random component for uniqueness
    const baseId = identifier
      ? `${type}:${indexName}:${identifier}:${timestamp}`
      : `${type}:${indexName}:${timestamp}`;
    return `${baseId}:${randomComponent}`;
  }
}
