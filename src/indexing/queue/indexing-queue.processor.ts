import {
  Processor,
  Process,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
  InjectQueue,
} from '@nestjs/bull';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';
import { ConfigService } from '@nestjs/config';
import { SingleIndexingJob, BatchIndexingJob } from '../services/bulk-indexing.service';
import { BulkOperationTrackerService } from '../services/bulk-operation-tracker.service';
import { INDEXING_JOB_NAMES, PERSISTENCE_JOB_NAMES } from '../constants/queue-job-names';
import { IndexNotFoundError } from '../errors/index-not-found.error';
import {
  SerializedTermPostings,
  PERSIST_PAYLOAD_REDIS_PREFIX,
  PERSIST_PAYLOAD_TTL_SEC,
} from '../interfaces/persistence-job.interface';
import { TermDictionary } from '../../index/interfaces/term-dictionary.interface';
import { PersistentTermDictionaryService } from '../../storage/index-storage/persistent-term-dictionary.service';
import { PersistencePayloadRepository } from '../../storage/mongodb/repositories/persistence-payload.repository';
import { PersistencePendingJobRepository } from '../../storage/mongodb/repositories/persistence-pending-job.repository';
import { IndexingPendingJobRepository } from '../../storage/mongodb/repositories/indexing-pending-job.repository';

// Helper function to get concurrency - reads from env at module load time
// This ensures the value is available when decorators are evaluated
function getIndexingConcurrency(): number {
  // Try to read from process.env (will be available if dotenv is loaded before this module)
  const envValue = process.env.INDEXING_CONCURRENCY;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Default fallback
  return 12;
}

const BATCH_CONCURRENCY = getIndexingConcurrency();

@Injectable()
@Processor('indexing')
export class IndexingQueueProcessor {
  private readonly logger = new Logger(IndexingQueueProcessor.name);
  private readonly concurrency: number;

  constructor(
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    private readonly configService: ConfigService,
    @InjectQueue('indexing') private readonly indexingQueue: Queue,
    @InjectQueue('term-persistence') private readonly persistenceQueue: Queue,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: TermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
    private readonly persistencePayloadRepo: PersistencePayloadRepository,
    private readonly persistencePendingJobRepo: PersistencePendingJobRepository,
    private readonly indexingPendingJobRepo: IndexingPendingJobRepository,
  ) {
    // Get concurrency from config, default to 12 if not set
    this.concurrency = parseInt(this.configService.get<string>('INDEXING_CONCURRENCY', '12'), 10);
    const envConcurrency = process.env.INDEXING_CONCURRENCY
      ? parseInt(process.env.INDEXING_CONCURRENCY, 10)
      : null;
    this.logger.log(
      `IndexingQueueProcessor initialized - bulk batch concurrency=${BATCH_CONCURRENCY} (set INDEXING_CONCURRENCY to change). ` +
        `ENV=${envConcurrency ?? 'not set'}, Config=${this.concurrency}`,
    );
    if (BATCH_CONCURRENCY !== this.concurrency) {
      this.logger.warn(
        `⚠️ Concurrency mismatch: Decorator=${BATCH_CONCURRENCY}, Config=${this.concurrency}. ` +
          `Decorator value (${BATCH_CONCURRENCY}) will be used for batch jobs.`,
      );
    }
  }

  @Process({ name: INDEXING_JOB_NAMES.SINGLE, concurrency: 5 })
  async processSingleDocument(job: Job<SingleIndexingJob>) {
    const { indexName, documentId, document } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `🔄 Processing single document job ${job.id}: ${documentId} in index ${indexName}`,
    );

    try {
      // Check if index exists
      const indexExists = await this.indexService.getIndex(indexName);
      if (!indexExists) {
        throw new IndexNotFoundError(indexName);
      }

      this.logger.debug(`✅ Index ${indexName} exists, proceeding with document indexing`);

      // Index the document
      const result = await this.documentService.indexDocument(indexName, {
        id: documentId,
        document,
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Successfully processed single document ${documentId} in ${duration}ms`);

      return { success: true, documentId, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to process single document ${documentId} after ${duration}ms:`,
        error.message,
      );
      throw error; // Let Bull handle retries
    }
  }

  @Process({ name: INDEXING_JOB_NAMES.HEALTH_CHECK, concurrency: 1 })
  async processHealthCheck(job: Job<any>) {
    const startTime = Date.now();
    this.logger.log(`🏥 Processing health check job ${job.id}`);

    // Simple health check - just return success with timing
    const duration = Date.now() - startTime;

    return {
      success: true,
      message: 'Worker is responsive',
      duration,
      timestamp: new Date().toISOString(),
      workerId: process.pid,
    };
  }

  @Process({ name: INDEXING_JOB_NAMES.WAKEUP, concurrency: 1 })
  async processWakeup(job: Job<any>) {
    this.logger.debug(`👋 Wakeup job ${job.id} processed - worker is active`);
    return { success: true, message: 'Worker awake' };
  }

  /**
   * Bulk indexing: up to BATCH_CONCURRENCY batch jobs run at the same time.
   * Set INDEXING_CONCURRENCY (default 12) to control how many batch jobs are processed concurrently.
   *
   * NEW ARCHITECTURE:
   * - Creates batch-local dirty tracking (no shared state)
   * - Passes dirty tracker to DocumentService
   * - Queues persistence job to term-persistence queue after indexing
   * - Notifies BulkOperationTracker of completion
   */
  @Process({
    name: INDEXING_JOB_NAMES.BATCH,
    concurrency: BATCH_CONCURRENCY,
  })
  async processBatchDocuments(job: Job<BatchIndexingJob & { payloadKey?: string }>) {
    let indexName: string;
    let documents: Array<{ id: string; document: any }>;
    let batchId: string;
    let options: BatchIndexingJob['options'];
    let metadata: Record<string, any> | undefined;
    const payloadKey = job.data.payloadKey;

    if (payloadKey) {
      const stored = await this.persistencePayloadRepo.get(payloadKey);
      if (!stored) {
        throw new Error(
          `Indexing payload not found for ${payloadKey}. It may have expired or been deleted.`,
        );
      }
      const fullPayload = JSON.parse(stored) as BatchIndexingJob;
      indexName = fullPayload.indexName;
      documents = fullPayload.documents;
      batchId = fullPayload.batchId;
      options = fullPayload.options;
      metadata = fullPayload.metadata;
      await this.indexingPendingJobRepo.removeByPayloadKey(payloadKey);
    } else {
      indexName = job.data.indexName;
      documents = job.data.documents;
      batchId = job.data.batchId;
      options = job.data.options;
      metadata = job.data.metadata;
    }

    const bulkOpId = metadata?.bulkOpId;
    const startTime = Date.now();

    this.logger.log(
      `🔄 Processing batch job ${job.id}: ${batchId} with ${documents.length} documents in index ${indexName}` +
        (bulkOpId ? ` (bulk op: ${bulkOpId})` : ''),
    );

    const batchDirtyTerms = new Set<string>();
    const batchTermPostings = new Map<
      string,
      Array<{
        docId: string | number;
        frequency: number;
        positions?: number[];
        metadata?: Record<string, any>;
      }>
    >();

    try {
      // Check if index exists
      const indexExists = await this.indexService.getIndex(indexName);
      if (!indexExists) {
        throw new Error(`Index ${indexName} does not exist`);
      }

      this.logger.debug(`✅ Index ${indexName} exists, proceeding with batch indexing`);

      // Convert to the format expected by processBatchDirectly
      const documentsWithIds = documents.map(doc => ({
        id: doc.id,
        document: doc.document,
      }));

      this.logger.debug(`📦 Processing ${documentsWithIds.length} documents in batch ${batchId}`);

      // Detect if this is a rebuild operation from metadata
      const isRebuild = metadata?.source === 'rebuild';
      if (isRebuild) {
        this.logger.debug(`🔄 Detected rebuild operation for batch ${batchId}`);
      }

      // Get skipDuplicates option (defaults to true for bulk operations)
      const skipDuplicates = options?.skipDuplicates !== false;

      const result = await this.documentService.processBatchDirectly(
        indexName,
        documentsWithIds,
        isRebuild,
        skipDuplicates,
        batchDirtyTerms,
        batchTermPostings,
      );

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Successfully indexed batch ${batchId}: ${result.successCount}/${documents.length} docs in ${duration}ms, ` +
          `${batchDirtyTerms.size} dirty terms`,
      );

      // Indexing workers push dirty terms to the shared Redis list (right); dedicated persistence
      // worker drains from the left in batches of 100. Both run concurrently from the start.
      // CRITICAL: Enqueue persistence job BEFORE markBatchIndexed so that when the last batch
      // completes, verifyPersistenceJobsEnqueued() sees all batches as enqueued (no race).
      if (bulkOpId) {
        try {
          await this.bulkOperationTracker.pushDirtyTerms(bulkOpId, Array.from(batchDirtyTerms));
          const termPostings = this.buildSerializedTermPostings(batchTermPostings);
          // Always enqueue persistence job first (even if termPostings empty).
          await this.enqueuePersistBatchTerms(
            indexName,
            batchId,
            bulkOpId,
            Array.from(batchDirtyTerms),
            termPostings,
          );
          await this.bulkOperationTracker.markBatchIndexed(bulkOpId, batchId);
        } catch (error) {
          this.logger.error(
            `Failed to enqueue persistence job for batch ${batchId} (bulkOp: ${bulkOpId}): ${error.message}`,
          );
          this.logger.warn(
            `Batch ${batchId} was indexed but persistence job was NOT enqueued. This batch will be missing from search results.`,
          );
        }
      } else {
        if (batchDirtyTerms.size > 0) {
          await this.persistenceQueue.add(
            PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS,
            {
              indexName,
              batchId,
              bulkOpId: `single:${batchId}`,
              dirtyTerms: Array.from(batchDirtyTerms),
              persistenceId: `persist:${batchId}`,
              indexedAt: new Date(),
            },
            {
              priority: 10,
              removeOnComplete: false, // Keep all for tracking (was 50)
              removeOnFail: false,
              attempts: 5,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
        }
      }

      return {
        success: true,
        batchId,
        documentsProcessed: result.successCount,
        documentsTotal: documents.length,
        dirtyTermsCount: batchDirtyTerms.size,
        duration,
        result,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to process batch ${batchId} after ${duration}ms:`,
        error.message,
      );

      // Notify tracker of failure
      if (bulkOpId) {
        try {
          this.bulkOperationTracker.markOperationFailed(
            bulkOpId,
            `Batch ${batchId} failed: ${error.message}`,
          );
        } catch (trackerError) {
          this.logger.warn(`Failed to notify tracker of failure: ${trackerError.message}`);
        }
      }

      throw error; // Let Bull handle retries
    }
  }

  /**
   * Build serialized term postings from the map captured during batch indexing.
   * This avoids reading from the term dictionary cache (which can be evicted).
   */
  private buildSerializedTermPostings(
    batchTermPostings: Map<
      string,
      Array<{
        docId: string | number;
        frequency: number;
        positions?: number[];
        metadata?: Record<string, any>;
      }>
    >,
  ): SerializedTermPostings[] {
    const result: SerializedTermPostings[] = [];
    for (const [indexAwareTerm, entries] of batchTermPostings) {
      if (!entries.length) continue;
      const postings: Record<
        string,
        {
          docId: string;
          frequency: number;
          positions?: number[];
          metadata?: Record<string, any>;
        }
      > = {};
      for (const entry of entries) {
        const docId = entry.docId.toString();
        postings[docId] = {
          docId,
          frequency: entry.frequency,
          positions: entry.positions,
          metadata: entry.metadata,
        };
      }
      result.push({ indexAwareTerm, postings });
    }
    return result;
  }

  /**
   * Enqueue a persist-batch-terms job by storing the full payload in Redis and adding a small job.
   * This avoids Bull/Redis losing large job data (which was causing unnamed jobs with empty payload).
   */
  private async enqueuePersistBatchTerms(
    indexName: string,
    batchId: string,
    bulkOpId: string,
    dirtyTerms: string[],
    termPostings: SerializedTermPostings[],
  ): Promise<void> {
    const payload = {
      indexName,
      batchId,
      bulkOpId,
      dirtyTerms,
      termPostings,
      persistenceId: `persist:${bulkOpId}:${batchId}`,
      indexedAt: new Date(),
    };
    const payloadKey = `${PERSIST_PAYLOAD_REDIS_PREFIX}${bulkOpId}:${batchId}`;
    const payloadJson = JSON.stringify(payload);
    try {
      await this.persistencePayloadRepo.set(payloadKey, payloadJson);
      this.logger.debug(
        `Stored persistence payload for batch ${batchId} in MongoDB (key: ${payloadKey})`,
      );
    } catch (e: any) {
      this.logger.error(
        `❌ CRITICAL: Failed to store persistence payload in MongoDB for batch ${batchId} (bulkOp: ${bulkOpId}): ${e?.message}. ` +
          `This batch will NOT be persisted and will be missing from search results.`,
      );
      throw e;
    }
    // Optional: cache in Redis for faster worker read; MongoDB is source of truth so no data loss on eviction
    const redis = this.persistenceQueue.client;
    try {
      await redis.setex(payloadKey, PERSIST_PAYLOAD_TTL_SEC, payloadJson);
    } catch {
      // Non-fatal; worker will load from MongoDB
    }
    // Register in MongoDB so we can recover if Bull's job key is evicted (unnamed job).
    try {
      await this.persistencePendingJobRepo.add({
        payloadKey,
        indexName,
        batchId,
        bulkOpId,
      });
      this.logger.debug(
        `Registered pending persistence job for batch ${batchId} (payloadKey: ${payloadKey})`,
      );
    } catch (e: any) {
      this.logger.error(
        `❌ CRITICAL: Failed to register pending persistence job in MongoDB for batch ${batchId} (bulkOp: ${bulkOpId}): ${e?.message}. ` +
          `Recovery may not work if Bull job metadata is lost.`,
      );
      throw e;
    }
    // Clear large payload objects from memory after storing (they're now in MongoDB/Redis)
    payload.dirtyTerms = undefined as any;
    payload.termPostings = undefined as any;
    // Job payload is kept minimal so Bull's job key stays small. Full payload in MongoDB.
    try {
      await this.persistenceQueue.add(
        PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS,
        {
          payloadKey,
          indexName,
          batchId,
          bulkOpId,
        },
        {
          priority: 5,
          removeOnComplete: false, // Keep all for tracking (was 100, but queue default was 50)
          removeOnFail: false,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      this.logger.debug(
        `Successfully enqueued persistence job for batch ${batchId} (bulkOp: ${bulkOpId})`,
      );
    } catch (e: any) {
      this.logger.error(
        `❌ CRITICAL: Failed to add persistence job to Bull queue for batch ${batchId} (bulkOp: ${bulkOpId}): ${e?.message}. ` +
          `Payload is stored in MongoDB but job was not enqueued. Recovery mechanism should handle this.`,
      );
      throw e;
    }
    // CRITICAL: Only mark as enqueued AFTER the Bull job is successfully added.
    // This ensures tracking is accurate - if enqueue fails, the batch won't be marked as having a persistence job.
    await this.bulkOperationTracker.markPersistenceJobEnqueued(bulkOpId, batchId);
    // Clear payloadJson string from memory (already stored)
    // Note: payloadJson is a const, so we can't reassign, but GC will handle it after function returns
  }

  /**
   * Handle jobs that were queued without a name (Bull reports them as __default__).
   * If job still has payload (small/minimal), re-queue with correct name. If payload was evicted,
   * recover by popping the oldest pending indexing job from MongoDB and re-queuing it.
   */
  @Process({ name: INDEXING_JOB_NAMES.__DEFAULT__, concurrency: 1 })
  async handleUnnamedIndexingJob(job: Job): Promise<{ requeued?: string; skipped?: boolean }> {
    const data = job.data as Record<string, unknown>;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.payloadKey != null && data.indexName != null && data.batchId != null) {
        this.logger.warn(
          `Re-queuing unnamed indexing job ${job.id} as 'batch' (payloadKey: ${data.payloadKey}) to avoid data loss`,
        );
        await this.indexingQueue.add(
          INDEXING_JOB_NAMES.BATCH,
          {
            payloadKey: data.payloadKey,
            indexName: data.indexName,
            batchId: data.batchId,
            metadata: data.metadata,
          },
          {
            attempts: job.opts?.attempts ?? 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
        return { requeued: INDEXING_JOB_NAMES.BATCH };
      }
      if (data.indexName != null && Array.isArray(data.documents) && data.batchId != null) {
        this.logger.warn(
          `Re-queuing unnamed indexing job ${job.id} as 'batch' (batchId: ${data.batchId}) to avoid data loss`,
        );
        await this.indexingQueue.add(
          INDEXING_JOB_NAMES.BATCH,
          data as unknown as BatchIndexingJob,
          {
            attempts: job.opts?.attempts ?? 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
        return { requeued: INDEXING_JOB_NAMES.BATCH };
      }
      if (data.indexName != null && data.documentId != null && data.document != null) {
        this.logger.warn(
          `Re-queuing unnamed indexing job ${job.id} as 'single' (documentId: ${data.documentId}) to avoid data loss`,
        );
        await this.indexingQueue.add(
          INDEXING_JOB_NAMES.SINGLE,
          data as unknown as SingleIndexingJob,
          {
            attempts: job.opts?.attempts ?? 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
        return { requeued: INDEXING_JOB_NAMES.SINGLE };
      }
    }

    // Payload was evicted (empty or invalid). Recover by processing oldest pending indexing job.
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const ref = await this.indexingPendingJobRepo.popOldest();
      if (!ref) {
        if (attempt === 0) {
          this.logger.warn(
            `Unnamed indexing job ${job.id} has no payload and no pending indexing jobs to recover; completing without retry`,
          );
        }
        return { skipped: true };
      }
      const stored = await this.persistencePayloadRepo.get(ref.payloadKey);
      if (!stored) {
        this.logger.debug(
          `Recovery: pending ref ${ref.batchId} had no payload in MongoDB (stale); skipping`,
        );
        continue;
      }
      this.logger.warn(
        `Re-queuing recovered batch from pending (batchId: ${ref.batchId}) for unnamed job ${job.id}`,
      );
      await this.indexingQueue.add(
        INDEXING_JOB_NAMES.BATCH,
        {
          payloadKey: ref.payloadKey,
          indexName: ref.indexName,
          batchId: ref.batchId,
          metadata: { bulkOpId: ref.bulkOpId },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      return { requeued: INDEXING_JOB_NAMES.BATCH };
    }

    this.logger.warn(
      `Unnamed indexing job ${job.id} has invalid or unknown payload; completing without retry to avoid loop`,
    );
    return { skipped: true };
  }

  @OnQueueActive()
  onActive(job: Job) {
    // Reduced logging - only log in debug mode
    this.logger.debug(`Job ${job.id} (${job.name}) is now ACTIVE`);
    // Log active count periodically for debugging concurrency issues
    if (job.name === INDEXING_JOB_NAMES.BATCH && Math.random() < 0.01) {
      // Log ~1% of batch job activations to track concurrency
      const indexName = (job.data as any)?.indexName || 'unknown';
      this.logger.debug(`Batch job ${job.id} activated (index: ${indexName})`);
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    // Log summary only, not full result object (which can be very large)
    const summary =
      result && typeof result === 'object'
        ? {
            success: result.success,
            batchId: result.batchId,
            documentsProcessed: result.documentsProcessed,
            documentsTotal: result.documentsTotal,
            duration: result.duration,
          }
        : 'completed';
    this.logger.log(`✅ Job ${job.id} of type '${job.name}' COMPLETED: ${JSON.stringify(summary)}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    // Log summary only, not full job.data (which can be very large)
    const jobSummary =
      job.data && typeof job.data === 'object'
        ? {
            indexName: job.data.indexName,
            batchId: job.data.batchId,
            documentsCount: job.data.documents?.length || 'N/A',
          }
        : 'unknown';

    // If it's an IndexNotFoundError, don't retry - mark as permanently failed
    const isIndexNotFound =
      error.name === 'IndexNotFoundError' || error.message.includes('does not exist');

    const jobName = job?.name ?? '__default__';
    if (isIndexNotFound) {
      const indexName =
        typeof jobSummary === 'object' && 'indexName' in jobSummary
          ? jobSummary.indexName
          : 'unknown';
      this.logger.warn(
        `⚠️ Job ${job.id} (${jobName}) PERMANENTLY FAILED - Index does not exist: ${indexName}. Job will not be retried.`,
      );
      // Mark job as permanently failed (no more retries)
      job.opts.attempts = job.attemptsMade;
    } else {
      this.logger.error(
        `❌ Job ${job.id} (${jobName}) FAILED after ${job.attemptsMade}/${job.opts.attempts} attempts: ${error.message}`,
      );
    }
    this.logger.debug(`Job summary: ${JSON.stringify(jobSummary)}`);
  }
}
