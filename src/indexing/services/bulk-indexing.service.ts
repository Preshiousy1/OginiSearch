import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import Bull, { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { BulkIndexingOptions } from '../interfaces/bulk-indexing.interface';
import { IndexService } from '../../index/index.service';
import { chunk } from 'lodash';

@Injectable()
export class BulkIndexingService {
  private readonly logger = new Logger(BulkIndexingService.name);

  constructor(
    @InjectQueue('bulk-indexing') private readonly bulkIndexingQueue: Queue,
    @Inject(forwardRef(() => IndexService))
    private readonly indexService: IndexService,
  ) {}

  async queueBulkIndexing(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    options: BulkIndexingOptions = {},
  ): Promise<{
    batchId: string;
    totalBatches: number;
    totalDocuments: number;
    status: string;
  }> {
    const {
      batchSize = 1000,
      skipDuplicates = true,
      enableProgress = false,
      priority = 5,
    } = options;

    // Check if index exists
    const index = await this.indexService.getIndex(indexName);
    if (!index) {
      throw new Error(`Index ${indexName} does not exist`);
    }

    // Split documents into batches
    const batches = chunk(documents, batchSize);
    const totalBatches = batches.length;
    const batchId = `bulk-${Date.now()}`;

    // Queue each batch for processing
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      await this.bulkIndexingQueue.add(
        'batch',
        {
          indexName,
          documents: batch,
          batchId: `${batchId}-${i + 1}`,
          batchNumber: i + 1,
          totalBatches,
          options: {
            skipDuplicates,
            enableProgress,
          },
          metadata: {
            priority,
          },
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
    }

    return {
      batchId,
      totalBatches,
      totalDocuments: documents.length,
      status: 'completed',
    };
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
        this.bulkIndexingQueue.getWaiting(),
        this.bulkIndexingQueue.getActive(),
        this.bulkIndexingQueue.getCompleted(),
        this.bulkIndexingQueue.getFailed(),
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
      this.bulkIndexingQueue.getWaiting(),
      this.bulkIndexingQueue.getActive(),
      this.bulkIndexingQueue.getCompleted(),
      this.bulkIndexingQueue.getFailed(),
      this.bulkIndexingQueue.getDelayed(),
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
    status: 'healthy' | 'degraded' | 'critical';
    queues: {
      singleJobs: number;
      batchJobs: number;
      failedSingleJobs: number;
      failedBatchJobs: number;
      totalActive: number;
      totalFailed: number;
    };
    timestamp: string;
  }> {
    const stats = await this.getDetailedQueueStats();

    const isHealthy = stats.failedSingleJobs === 0 && stats.failedBatchJobs === 0;
    const isDegraded = stats.failedSingleJobs > 0 || stats.failedBatchJobs > 0;

    return {
      status: isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'critical',
      queues: {
        singleJobs: stats.singleJobs,
        batchJobs: stats.batchJobs,
        failedSingleJobs: stats.failedSingleJobs,
        failedBatchJobs: stats.failedBatchJobs,
        totalActive: stats.totalActive,
        totalFailed: stats.totalFailed,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Clean completed and failed jobs
   */
  async cleanQueue(): Promise<void> {
    this.logger.log('Starting comprehensive queue cleanup...');

    try {
      // Get current stats before cleaning
      const statsBefore = await this.getDetailedQueueStats();
      this.logger.log(
        `Before cleanup: ${statsBefore.singleJobs} single, ${statsBefore.batchJobs} batch, ${statsBefore.totalWaiting} waiting, ${statsBefore.totalActive} active, ${statsBefore.totalFailed} failed`,
      );

      // Clean completed jobs (aggressive - older than 1 second)
      await this.bulkIndexingQueue.clean(1000, 'completed');

      // Clean failed jobs (aggressive - older than 1 second)
      await this.bulkIndexingQueue.clean(1000, 'failed');

      // Clean active jobs (force clean stuck jobs)
      await this.bulkIndexingQueue.clean(0, 'active');

      // Clean delayed jobs
      await this.bulkIndexingQueue.clean(0, 'delayed');

      // For waiting jobs, we need to manually remove them
      const waitingJobs = await this.bulkIndexingQueue.getWaiting();
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
      this.logger.log(
        `After cleanup: ${statsAfter.singleJobs} single, ${statsAfter.batchJobs} batch, ${statsAfter.totalWaiting} waiting, ${statsAfter.totalActive} active, ${statsAfter.totalFailed} failed`,
      );

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
    await this.bulkIndexingQueue.pause();
    this.logger.log('Indexing queue paused');
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    await this.bulkIndexingQueue.resume();
    this.logger.log('Indexing queue resumed');
  }

  /**
   * Get failed jobs with details
   */
  async getFailedJobs(): Promise<Array<Bull.Job>> {
    try {
      // Get failed jobs from both queues
      const [mainQueueFailedJobs, dlqFailedJobs] = await Promise.all([
        this.bulkIndexingQueue.getFailed(),
        this.bulkIndexingQueue.getJobs(['failed']),
      ]);

      // Combine and sort all failed jobs by timestamp
      const allFailedJobs = [...mainQueueFailedJobs, ...dlqFailedJobs];
      return allFailedJobs.sort(
        (a, b) => (b.finishedOn || b.timestamp) - (a.finishedOn || a.timestamp),
      );
    } catch (error) {
      this.logger.error(`Failed to get failed jobs: ${error.message}`);
      throw error;
    }
  }

  async retryFailedJob(jobId: string): Promise<void> {
    try {
      const job = await this.bulkIndexingQueue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found in dead letter queue`);
      }

      // Remove error information and retry in main queue
      const { error, failedAt, attempts, ...jobData } = job.data;
      await this.bulkIndexingQueue.add('batch', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      });

      // Remove from dead letter queue
      await job.remove();

      this.logger.log(`Retried failed job ${jobId}`);
    } catch (error) {
      this.logger.error(`Failed to retry job ${jobId}: ${error.message}`);
      throw error;
    }
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
