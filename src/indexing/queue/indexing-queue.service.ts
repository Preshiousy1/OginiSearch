import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { ConfigService } from '@nestjs/config';

export interface IndexingJob {
  indexName: string;
  documents: any[];
  batchId: string;
  priority: number;
  retryCount?: number;
  metadata?: {
    source: string;
    uploadId?: string;
    userId?: string;
    totalBatches?: number;
    batchNumber?: number;
  };
}

export interface BulkIndexingJob {
  indexName: string;
  documentIds: string[];
  source: 'database' | 'file' | 'api';
  batchSize: number;
  startOffset?: number;
  totalDocuments?: number;
  filters?: Record<string, any>;
}

@Injectable()
export class IndexingQueueService {
  private readonly logger = new Logger(IndexingQueueService.name);

  constructor(
    @InjectQueue('indexing') private indexingQueue: Queue,
    @InjectQueue('bulk-indexing') private bulkIndexingQueue: Queue,
    private configService: ConfigService,
  ) {}

  /**
   * Add a batch of documents to the indexing queue
   */
  async addBatch(
    indexName: string,
    documents: any[],
    options: {
      priority?: number;
      delay?: number;
      batchId?: string;
      metadata?: any;
    } = {},
  ): Promise<Job<IndexingJob>> {
    const batchId = options.batchId || this.generateBatchId();

    const job: IndexingJob = {
      indexName,
      documents,
      batchId,
      priority: options.priority || 0,
      metadata: options.metadata,
    };

    return this.indexingQueue.add('process-batch', job, {
      priority: options.priority || 0,
      delay: options.delay || 0,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50, // Keep last 50 failed jobs
    });
  }

  /**
   * Add a bulk indexing job for large datasets
   */
  async addBulkIndexing(
    indexName: string,
    options: {
      source: 'database' | 'file' | 'api';
      totalDocuments?: number;
      batchSize?: number;
      filters?: Record<string, any>;
      priority?: number;
    },
  ): Promise<Job<BulkIndexingJob>> {
    const batchSize = options.batchSize || this.configService.get('indexing.defaultBatchSize', 500);

    const job: BulkIndexingJob = {
      indexName,
      documentIds: [], // Will be populated by the processor
      source: options.source,
      batchSize,
      totalDocuments: options.totalDocuments,
      filters: options.filters,
    };

    return this.bulkIndexingQueue.add('process-bulk', job, {
      priority: options.priority || 5, // Higher priority for bulk jobs
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
  }

  /**
   * Add high-priority single document indexing
   */
  async addSingleDocument(
    indexName: string,
    document: any,
    options: { priority?: number; delay?: number } = {},
  ): Promise<Job<IndexingJob>> {
    return this.addBatch(indexName, [document], {
      ...options,
      priority: options.priority || 10, // High priority for single docs
      batchId: `single-${document.id || Date.now()}`,
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [
      indexingWaiting,
      indexingActive,
      indexingCompleted,
      indexingFailed,
      bulkWaiting,
      bulkActive,
      bulkCompleted,
      bulkFailed,
    ] = await Promise.all([
      this.indexingQueue.getWaiting(),
      this.indexingQueue.getActive(),
      this.indexingQueue.getCompleted(),
      this.indexingQueue.getFailed(),
      this.bulkIndexingQueue.getWaiting(),
      this.bulkIndexingQueue.getActive(),
      this.bulkIndexingQueue.getCompleted(),
      this.bulkIndexingQueue.getFailed(),
    ]);

    return {
      indexing: {
        waiting: indexingWaiting.length,
        active: indexingActive.length,
        completed: indexingCompleted.length,
        failed: indexingFailed.length,
      },
      bulkIndexing: {
        waiting: bulkWaiting.length,
        active: bulkActive.length,
        completed: bulkCompleted.length,
        failed: bulkFailed.length,
      },
    };
  }

  /**
   * Pause/Resume queues for maintenance
   */
  async pauseQueues(): Promise<void> {
    await Promise.all([this.indexingQueue.pause(), this.bulkIndexingQueue.pause()]);
    this.logger.log('All indexing queues paused');
  }

  async resumeQueues(): Promise<void> {
    await Promise.all([this.indexingQueue.resume(), this.bulkIndexingQueue.resume()]);
    this.logger.log('All indexing queues resumed');
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(): Promise<void> {
    const olderThan = 24 * 60 * 60 * 1000; // 24 hours

    await Promise.all([
      this.indexingQueue.clean(olderThan, 'completed'),
      this.indexingQueue.clean(olderThan, 'failed'),
      this.bulkIndexingQueue.clean(olderThan, 'completed'),
      this.bulkIndexingQueue.clean(olderThan, 'failed'),
    ]);

    this.logger.log('Cleaned old jobs from queues');
  }

  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
