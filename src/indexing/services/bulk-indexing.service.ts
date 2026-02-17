import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from 'src/document/document.service';
import { IndexService } from 'src/index/index.service';
import { BulkOperationTrackerService } from './bulk-operation-tracker.service';
import { InjectQueue } from '@nestjs/bull';
import Bull from 'bull';
import {
  INDEXING_JOB_NAMES,
  PERSISTENCE_JOB_NAMES,
  DEAD_LETTER_JOB_NAMES,
} from '../constants/queue-job-names';
import { PersistenceQueueProcessor } from '../queue/persistence-queue.processor';
import { PersistencePayloadRepository } from '../../storage/mongodb/repositories/persistence-payload.repository';
import { PersistencePendingJobRepository } from '../../storage/mongodb/repositories/persistence-pending-job.repository';
import { IndexingPendingJobRepository } from '../../storage/mongodb/repositories/indexing-pending-job.repository';
import {
  INDEX_PAYLOAD_PREFIX,
  PERSIST_PAYLOAD_REDIS_PREFIX,
} from '../interfaces/persistence-job.interface';

export interface BulkIndexingOptions {
  batchSize?: number;
  concurrency?: number;
  skipDuplicates?: boolean;
  enableProgress?: boolean;
  priority?: number;
  retryAttempts?: number;
  retryDelay?: number;
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

export interface BulkIndexingResponse {
  batchId: string;
  totalBatches: number;
  totalDocuments: number;
  status: string;
}

@Injectable()
export class BulkIndexingService implements OnModuleInit {
  private readonly logger = new Logger(BulkIndexingService.name);
  private readonly deadLetterQueue: Bull.Queue;

  // Configuration constants
  private readonly DEFAULT_BATCH_SIZE = 500;
  private readonly DEFAULT_CONCURRENCY = 3;

  async onModuleInit(): Promise<void> {
    try {
      const paused = await this.indexingQueue.isPaused();
      if (paused) {
        await this.indexingQueue.resume();
        this.logger.log('Resumed indexing queue (was paused in Redis from previous run)');
      }
    } catch (error) {
      this.logger.warn(`Could not ensure queue is resumed on init: ${error.message}`);
    }
  }

  constructor(
    @Inject(forwardRef(() => DocumentService))
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    private readonly configService: ConfigService,
    @InjectQueue('indexing') private readonly indexingQueue: Bull.Queue,
    @InjectQueue('term-persistence') private readonly persistenceQueue: Bull.Queue,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
    private readonly persistenceQueueProcessor: PersistenceQueueProcessor,
    private readonly persistencePayloadRepo: PersistencePayloadRepository,
    private readonly persistencePendingJobRepo: PersistencePendingJobRepository,
    private readonly indexingPendingJobRepo: IndexingPendingJobRepository,
  ) {
    // Initialize dead letter queue
    this.deadLetterQueue = new Bull('indexing-dlq', {
      redis: {
        host: this.configService.get('REDIS_HOST', 'localhost'),
        port: this.configService.get('REDIS_PORT', 6379),
      },
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    // Listen for failed jobs
    this.indexingQueue.on('failed', async (job: Bull.Job, error: Error) => {
      if (job.attemptsMade >= job.opts.attempts) {
        await this.moveToDeadLetterQueue(job, error);
      }
    });
  }

  private async moveToDeadLetterQueue(job: Bull.Job, error: Error): Promise<void> {
    try {
      await this.deadLetterQueue.add(
        DEAD_LETTER_JOB_NAMES.FAILED,
        {
          ...job.data,
          error: {
            message: error.message,
            stack: error.stack,
          },
          failedAt: new Date().toISOString(),
          attempts: job.attemptsMade,
        },
        {
          jobId: `dlq:${job.id}`,
        },
      );

      this.logger.warn(
        `Moved failed job ${job.id} to dead letter queue after ${job.attemptsMade} attempts`,
      );
    } catch (dlqError) {
      this.logger.error(`Failed to move job ${job.id} to dead letter queue: ${dlqError.message}`);
    }
  }

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

    // Add to Bull queue (always use named job so handler is matched)
    await this.indexingQueue.add(INDEXING_JOB_NAMES.SINGLE, job, {
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
   * NEW ARCHITECTURE: Creates a bulk operation and tracks it
   */
  async queueBulkIndexing(
    indexName: string,
    documents: Array<{ id: string; document: any }>,
    options: BulkIndexingOptions = {},
    customMetadata: Record<string, any> = {},
  ): Promise<BulkIndexingResponse> {
    const {
      batchSize = 100,
      skipDuplicates = true,
      enableProgress = true,
      priority = 5,
      retryAttempts = 3,
      retryDelay = 5000,
    } = options;

    const batchId = `batch:${indexName}:${Date.now()}:${Math.random().toString(36).substr(2, 6)}`;
    const batches = [];
    const batchIds: string[] = [];
    const totalBatches = Math.ceil(documents.length / batchSize);

    // Create bulk operation for tracking (NEW)
    const bulkOpId = this.bulkOperationTracker.createOperation(
      indexName,
      totalBatches,
      [], // Will be filled as we queue batches
      documents.length,
    );

    this.logger.log(
      `Created bulk operation ${bulkOpId} for ${documents.length} documents in ${totalBatches} batches`,
    );

    // Split documents into batches. Store full payload in MongoDB and put only a reference in Bull
    // so Redis eviction does not drop batch data (which was causing "unnamed" jobs and lost documents).
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const currentBatchId = `${batchId}:${batchNumber}`;
      const payloadKey = `${INDEX_PAYLOAD_PREFIX}${bulkOpId}:${currentBatchId}`;

      const fullPayload: BatchIndexingJob = {
        indexName,
        documents: batch,
        batchId: currentBatchId,
        options: {
          batchSize,
          skipDuplicates,
          enableProgress,
          priority,
          retryAttempts,
        },
        metadata: {
          queuedAt: new Date().toISOString(),
          parentBatchId: batchId,
          batchNumber,
          totalBatches,
          source: 'bulk',
          bulkOpId,
          ...customMetadata,
        },
      };

      await this.persistencePayloadRepo.set(payloadKey, JSON.stringify(fullPayload));
      await this.indexingPendingJobRepo.add({
        payloadKey,
        indexName,
        batchId: currentBatchId,
        bulkOpId,
      });

      const job = await this.indexingQueue.add(
        INDEXING_JOB_NAMES.BATCH,
        {
          payloadKey,
          indexName,
          batchId: currentBatchId,
          metadata: fullPayload.metadata,
        },
        {
          priority,
          attempts: retryAttempts,
          backoff: {
            type: 'exponential',
            delay: retryDelay,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );

      batches.push(job);
      batchIds.push(currentBatchId);
    }

    // Update bulk operation with batch IDs
    const bulkOp = this.bulkOperationTracker.getOperation(bulkOpId);
    if (bulkOp) {
      bulkOp.batchIds = batchIds;
    }

    // Start the dedicated persistence worker immediately (same time as indexing workers).
    // It drains the dirty list from the left in batches of 100 while indexers push to the right.
    await this.persistenceQueue.add(
      PERSISTENCE_JOB_NAMES.DRAIN_DIRTY_LIST,
      { bulkOpId, indexName },
      { priority: 10, removeOnComplete: 50, removeOnFail: false },
    );

    this.logger.log(
      `Queued ${batches.length} batches for bulk indexing and started drain job (bulk op: ${bulkOpId}, index: ${indexName})`,
    );

    return {
      batchId,
      totalBatches: batches.length,
      totalDocuments: documents.length,
      status: 'queued',
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
        this.indexingQueue.getWaiting(),
        this.indexingQueue.getActive(),
        this.indexingQueue.getCompleted(),
        this.indexingQueue.getFailed(),
      ]);

      // Count jobs by type (no verbose logging)
      let singleJobs = 0;
      let batchJobs = 0;
      let failedSingleJobs = 0;
      let failedBatchJobs = 0;

      // Count waiting and active jobs (guard: Bull can return null or jobs without .name)
      [...waitingJobs, ...activeJobs].forEach(job => {
        if (!job) return;
        const name = job.name ?? (job as any).opts?.name;
        if (name === INDEXING_JOB_NAMES.SINGLE) singleJobs++;
        else if (name === INDEXING_JOB_NAMES.BATCH) batchJobs++;
      });

      // Count failed jobs by type
      failedJobs.forEach(job => {
        if (!job) return;
        const name = job.name ?? (job as any).opts?.name;
        if (name === INDEXING_JOB_NAMES.SINGLE) failedSingleJobs++;
        else if (name === INDEXING_JOB_NAMES.BATCH) failedBatchJobs++;
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
   * Get term-persistence queue statistics (waiting, active, completed, failed).
   */
  async getPersistenceQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.persistenceQueue.getWaiting(),
      this.persistenceQueue.getActive(),
      this.persistenceQueue.getCompleted(),
      this.persistenceQueue.getFailed(),
      this.persistenceQueue.getDelayed(),
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
   * Get failed jobs from the term-persistence queue.
   */
  async getPersistenceFailedJobs(): Promise<Array<Bull.Job>> {
    try {
      const failed = await this.persistenceQueue.getFailed();
      return failed.sort(
        (a, b) => (b.finishedOn || b.timestamp || 0) - (a.finishedOn || a.timestamp || 0),
      );
    } catch (error) {
      this.logger.error(`Failed to get persistence failed jobs: ${error.message}`);
      throw error;
    }
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
   * Clean completed and failed jobs. Use drainQueue() to also remove active and waiting jobs.
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
   * Completely drain the queue: pause, remove all jobs (including active), then resume.
   * Use this when you need to clear everything including jobs currently being processed.
   */
  async drainQueue(): Promise<void> {
    this.logger.log('Draining queue completely (including active jobs)...');

    try {
      const statsBefore = await this.getDetailedQueueStats();
      this.logger.log(
        `Before drain: ${statsBefore.totalWaiting} waiting, ${statsBefore.totalActive} active`,
      );

      await this.indexingQueue.pause(true, true);
      this.logger.log('Queue paused');

      if (typeof this.indexingQueue.obliterate === 'function') {
        await this.indexingQueue.obliterate({ force: true });
        this.logger.log('Queue obliterated (all jobs removed including active)');
      } else {
        await this.indexingQueue.clean(0, 'active');
        await this.indexingQueue.clean(0, 'completed');
        await this.indexingQueue.clean(0, 'failed');
        await this.indexingQueue.clean(0, 'delayed');
        const waiting = await this.indexingQueue.getWaiting();
        for (const job of waiting) {
          await job.remove();
        }
        this.logger.log(`Removed active/delayed and ${waiting.length} waiting jobs`);
      }

      await this.indexingQueue.resume(true);
      this.logger.log('Queue resumed');

      const statsAfter = await this.getDetailedQueueStats();
      this.logger.log(
        `After drain: ${statsAfter.totalWaiting} waiting, ${statsAfter.totalActive} active`,
      );
      this.logger.log('Queue drain completed successfully');
    } catch (error) {
      try {
        await this.indexingQueue.resume(true);
      } catch (resumeErr) {
        this.logger.warn(`Failed to resume after drain: ${resumeErr.message}`);
      }
      this.logger.error(`Queue drain failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Completely drain the term-persistence queue: pause, remove all jobs (including active), then resume.
   * Use when you need to clear all persistence jobs (e.g. before a clean re-index).
   */
  async drainPersistenceQueue(): Promise<void> {
    this.logger.log('Draining term-persistence queue completely (including active jobs)...');

    try {
      const [waiting, active] = await Promise.all([
        this.persistenceQueue.getWaiting(),
        this.persistenceQueue.getActive(),
      ]);
      this.logger.log(`Before drain: ${waiting.length} waiting, ${active.length} active`);

      await this.persistenceQueue.pause(true, true);
      this.logger.log('Persistence queue paused');

      if (typeof this.persistenceQueue.obliterate === 'function') {
        await this.persistenceQueue.obliterate({ force: true });
        this.logger.log('Persistence queue obliterated (all jobs removed including active)');
      } else {
        await this.persistenceQueue.clean(0, 'active');
        await this.persistenceQueue.clean(0, 'completed');
        await this.persistenceQueue.clean(0, 'failed');
        await this.persistenceQueue.clean(0, 'delayed');
        const waitingAfter = await this.persistenceQueue.getWaiting();
        for (const job of waitingAfter) {
          await job.remove();
        }
        this.logger.log(`Removed active/delayed and ${waitingAfter.length} waiting jobs`);
      }

      await this.persistenceQueue.resume(true);
      this.logger.log('Persistence queue resumed');

      const [waitingAfter, activeAfter] = await Promise.all([
        this.persistenceQueue.getWaiting(),
        this.persistenceQueue.getActive(),
      ]);
      this.logger.log(`After drain: ${waitingAfter.length} waiting, ${activeAfter.length} active`);
      this.logger.log('Persistence queue drain completed successfully');
    } catch (error) {
      try {
        await this.persistenceQueue.resume(true);
      } catch (resumeErr) {
        this.logger.warn(`Failed to resume persistence queue after drain: ${resumeErr.message}`);
      }
      this.logger.error(`Persistence queue drain failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Drain stale pending refs from MongoDB: process every pending ref that has a payload (merge terms),
   * and remove refs that have no payload (stale from old runs). Cleans persistence_pending_jobs
   * without waiting for recovery during normal queue processing.
   */
  async drainStalePendingRefs(): Promise<{ processed: number; skipped: number }> {
    return this.persistenceQueueProcessor.drainPendingRefs();
  }

  /**
   * Verify that all batches in a bulk operation have persistence jobs enqueued.
   * Returns missing batch IDs if any.
   */
  verifyPersistenceJobs(bulkOpId: string): {
    allEnqueued: boolean;
    missingBatches: string[];
    enqueuedCount: number;
    totalBatches: number;
    completedIndexingBatches: number;
    persistedBatches: number;
  } {
    const verification = this.bulkOperationTracker.verifyPersistenceJobsEnqueued(bulkOpId);
    const op = this.bulkOperationTracker.getOperation(bulkOpId);
    if (!op) {
      return {
        ...verification,
        completedIndexingBatches: 0,
        persistedBatches: 0,
      };
    }
    return {
      ...verification,
      completedIndexingBatches: op.completedBatches,
      persistedBatches: op.persistedBatches,
    };
  }

  /**
   * Verify all bulk operations for an indexName and return aggregated results.
   * This is the main verification endpoint - checks all operations for the index.
   */
  async verifyPersistenceJobsByIndex(indexName: string): Promise<{
    indexName: string;
    totalOperations: number;
    totalBatches: number;
    totalBatchesWithPersistenceJobs: number;
    totalBatchesIndexed: number;
    totalBatchesPersisted: number;
    missingBatches: string[];
    operations: Array<{
      bulkOpId: string;
      status: string;
      totalBatches: number;
      enqueuedCount: number;
      completedIndexing: number;
      persisted: number;
      missingBatches: string[];
      allEnqueued: boolean;
    }>;
  }> {
    const operations = await this.bulkOperationTracker.getOperationsByIndexName(indexName);
    let totalBatches = 0;
    let totalBatchesWithPersistenceJobs = 0;
    let totalBatchesIndexed = 0;
    let totalBatchesPersisted = 0;
    const allMissingBatches: string[] = [];
    const operationDetails: Array<{
      bulkOpId: string;
      status: string;
      totalBatches: number;
      enqueuedCount: number;
      completedIndexing: number;
      persisted: number;
      missingBatches: string[];
      allEnqueued: boolean;
    }> = [];

    for (const op of operations) {
      const verification = this.bulkOperationTracker.verifyPersistenceJobsEnqueued(op.id);
      totalBatches += op.totalBatches;
      totalBatchesWithPersistenceJobs += verification.enqueuedCount;
      totalBatchesIndexed += op.completedBatches;
      totalBatchesPersisted += op.persistedBatches;
      allMissingBatches.push(...verification.missingBatches);
      operationDetails.push({
        bulkOpId: op.id,
        status: op.status,
        totalBatches: op.totalBatches,
        enqueuedCount: verification.enqueuedCount,
        completedIndexing: op.completedBatches,
        persisted: op.persistedBatches,
        missingBatches: verification.missingBatches,
        allEnqueued: verification.allEnqueued,
      });
    }

    return {
      indexName,
      totalOperations: operations.length,
      totalBatches,
      totalBatchesWithPersistenceJobs,
      totalBatchesIndexed,
      totalBatchesPersisted,
      missingBatches: allMissingBatches,
      operations: operationDetails,
    };
  }

  /**
   * Recover missing persistence jobs for an index.
   * Uses the same operations data as the verify endpoint. For each operation's batchIds,
   * looks up persist payloads in MongoDB and re-enqueues any that exist (not yet persisted).
   */
  async recoverMissingPersistenceJobs(indexName: string): Promise<{
    indexName: string;
    totalOperations: number;
    batchesChecked: number;
    payloadsFound: number;
    batchesRecovered: number;
    batchesUnrecoverable: number;
    recoveredBatches: Array<{
      bulkOpId: string;
      batchId: string;
      payloadKey: string;
    }>;
    unrecoverableBatches: Array<{
      bulkOpId: string;
      batchId: string;
      payloadKey: string;
      reason: string;
    }>;
    documentCount?: number;
    diagnostic?: {
      totalPayloadsInCollection: number;
      sampleKeys: string[];
      persistPayloadPrefix: string;
      note: string;
    };
  }> {
    const recoveredBatches: Array<{
      bulkOpId: string;
      batchId: string;
      payloadKey: string;
    }> = [];
    const unrecoverableBatches: Array<{
      bulkOpId: string;
      batchId: string;
      payloadKey: string;
      reason: string;
    }> = [];
    let batchesChecked = 0;
    let payloadsFound = 0;

    // Same source as verify: operations from bulk operation tracker
    const operations = await this.bulkOperationTracker.getOperationsByIndexName(indexName);
    this.logger.log(
      `Recovering persistence jobs for index ${indexName}: ${operations.length} operations`,
    );

    for (const op of operations) {
      const batchIds = op.batchIds || [];
      if (batchIds.length === 0) continue;

      for (const batchId of batchIds) {
        batchesChecked++;
        const payloadKey = `${PERSIST_PAYLOAD_REDIS_PREFIX}${op.id}:${batchId}`;
        const payload = await this.persistencePayloadRepo.get(payloadKey);

        if (!payload) {
          // Normal case: payload was persisted (and deleted) or never stored; skip silently
          continue;
        }

        payloadsFound++;
        try {
          const payloadData = JSON.parse(payload);
          if (!payloadData.indexName || !payloadData.batchId || !payloadData.bulkOpId) {
            unrecoverableBatches.push({
              bulkOpId: op.id,
              batchId,
              payloadKey,
              reason: 'Invalid payload format',
            });
            continue;
          }

          const { indexName: payloadIndex, batchId: pBatchId, bulkOpId: pBulkOpId } = payloadData;

          const hasPendingRef = await this.persistencePendingJobRepo.existsByPayloadKey(payloadKey);
          if (!hasPendingRef) {
            await this.persistencePendingJobRepo.add({
              payloadKey,
              indexName: payloadIndex,
              batchId: pBatchId,
              bulkOpId: pBulkOpId,
            });
          }

          await this.persistenceQueue.add(
            PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS,
            {
              payloadKey,
              indexName: payloadIndex,
              batchId: pBatchId,
              bulkOpId: pBulkOpId,
            },
            {
              priority: 10,
              removeOnComplete: false,
              removeOnFail: false,
              attempts: 5,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );

          try {
            await this.bulkOperationTracker.markPersistenceJobEnqueued(op.id, batchId);
          } catch {
            // Operation may not exist - job still enqueued
          }

          recoveredBatches.push({ bulkOpId: op.id, batchId, payloadKey });
          this.logger.log(`✅ Recovered batch ${batchId} (operation: ${op.id})`);
        } catch (error: any) {
          unrecoverableBatches.push({
            bulkOpId: op.id,
            batchId,
            payloadKey,
            reason: `Recovery failed: ${error.message}`,
          });
        }
      }
    }

    // Fallback: query MongoDB for any persist payloads not in tracked batchIds (orphaned)
    const allPersistPayloads = await this.persistencePayloadRepo.findAllForIndex(indexName);
    const recoveredKeys = new Set(recoveredBatches.map(r => r.payloadKey));
    for (const { key: payloadKey, value: payloadJson } of allPersistPayloads) {
      if (recoveredKeys.has(payloadKey)) continue;
      payloadsFound++;
      batchesChecked++;
      try {
        const payloadData = JSON.parse(payloadJson);
        if (!payloadData.indexName || !payloadData.batchId || !payloadData.bulkOpId) {
          unrecoverableBatches.push({
            bulkOpId: 'unknown',
            batchId: payloadKey,
            payloadKey,
            reason: 'Invalid payload format',
          });
          continue;
        }
        const { indexName: pi, batchId: pb, bulkOpId: pbo } = payloadData;
        const hasPendingRef = await this.persistencePendingJobRepo.existsByPayloadKey(payloadKey);
        if (!hasPendingRef) {
          await this.persistencePendingJobRepo.add({
            payloadKey,
            indexName: pi,
            batchId: pb,
            bulkOpId: pbo,
          });
        }
        await this.persistenceQueue.add(
          PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS,
          { payloadKey, indexName: pi, batchId: pb, bulkOpId: pbo },
          { priority: 10, removeOnComplete: false, removeOnFail: false, attempts: 5 },
        );
        recoveredBatches.push({ bulkOpId: pbo, batchId: pb, payloadKey });
      } catch (error: any) {
        unrecoverableBatches.push({
          bulkOpId: 'unknown',
          batchId: payloadKey,
          payloadKey,
          reason: `Recovery failed: ${error.message}`,
        });
      }
    }

    let documentCount: number | undefined;
    try {
      const { total } = await this.documentService.listDocuments(indexName, { limit: 0 });
      documentCount = total;
    } catch {
      // ignore
    }

    let diagnostic:
      | {
          totalPayloadsInCollection: number;
          sampleKeys: string[];
          persistPayloadPrefix: string;
          note: string;
        }
      | undefined;
    if (payloadsFound === 0 && batchesChecked > 0) {
      try {
        const diag = await this.persistencePayloadRepo.getDiagnostics();
        diagnostic = {
          totalPayloadsInCollection: diag.totalCount,
          sampleKeys: diag.sampleKeys,
          persistPayloadPrefix: PERSIST_PAYLOAD_REDIS_PREFIX,
          note:
            `Recovery looks for keys like ${PERSIST_PAYLOAD_REDIS_PREFIX}bulk:${indexName}:timestamp:id:batchId. ` +
            `Sample keys use "index:payload" (indexing batches) not "persist:payload" (term postings). ` +
            `Persist payloads are deleted after successful persistence.`,
        };
      } catch (e: any) {
        diagnostic = {
          totalPayloadsInCollection: -1,
          sampleKeys: [],
          persistPayloadPrefix: PERSIST_PAYLOAD_REDIS_PREFIX,
          note: `Could not read diagnostics: ${e.message}`,
        };
      }
    }

    this.logger.log(
      `Recovery complete for ${indexName}: ${recoveredBatches.length} recovered, ` +
        `${unrecoverableBatches.length} unrecoverable (${batchesChecked} batches checked)`,
    );

    return {
      indexName,
      totalOperations: operations.length,
      batchesChecked,
      payloadsFound,
      batchesRecovered: recoveredBatches.length,
      batchesUnrecoverable: unrecoverableBatches.length,
      recoveredBatches,
      unrecoverableBatches,
      documentCount,
      diagnostic,
    };
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

  /**
   * Get failed jobs with details
   */
  async getFailedJobs(): Promise<Array<Bull.Job>> {
    try {
      // Get failed jobs from both queues
      const [mainQueueFailedJobs, dlqFailedJobs] = await Promise.all([
        this.indexingQueue.getFailed(),
        this.deadLetterQueue.getJobs(['failed']),
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
      const job = await this.deadLetterQueue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found in dead letter queue`);
      }

      // Remove error information and retry in main queue
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { error, failedAt, attempts, ...jobData } = job.data;
      await this.indexingQueue.add(INDEXING_JOB_NAMES.BATCH, jobData, {
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
   * Cancel/remove all jobs for a deleted index
   */
  async cancelJobsForIndex(indexName: string): Promise<{ cancelled: number; failed: number }> {
    this.logger.log(`Cancelling all jobs for deleted index: ${indexName}`);
    let cancelled = 0;
    let failed = 0;

    try {
      // Get all job states
      const [waiting, active, delayed] = await Promise.all([
        this.indexingQueue.getWaiting(),
        this.indexingQueue.getActive(),
        this.indexingQueue.getDelayed(),
      ]);

      const allJobs = [...waiting, ...active, ...delayed];

      // Filter jobs for this index
      const indexJobs = allJobs.filter(
        job => job.data && (job.data as any).indexName === indexName,
      );

      this.logger.log(`Found ${indexJobs.length} jobs to cancel for index ${indexName}`);

      // Remove each job
      for (const job of indexJobs) {
        try {
          await job.remove();
          cancelled++;
        } catch (error) {
          this.logger.warn(`Failed to cancel job ${job.id}: ${error.message}`);
          failed++;
        }
      }

      this.logger.log(
        `Cancelled ${cancelled} jobs for index ${indexName} (${failed} failed to cancel)`,
      );

      return { cancelled, failed };
    } catch (error) {
      this.logger.error(`Error cancelling jobs for index ${indexName}: ${error.message}`);
      throw error;
    }
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
