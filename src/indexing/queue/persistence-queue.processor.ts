import { Processor, Process, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Job } from 'bull';
import { InMemoryTermDictionary } from '../../index/term-dictionary';
import { SimplePostingList } from '../../index/posting-list';
import { PersistentTermDictionaryService } from '../../storage/index-storage/persistent-term-dictionary.service';
import { BulkOperationTrackerService } from '../services/bulk-operation-tracker.service';
import {
  PersistenceBatchJob,
  PersistenceBatchResult,
} from '../interfaces/persistence-job.interface';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PERSISTENCE_JOB_NAMES } from '../constants/queue-job-names';
import { PersistencePayloadRepository } from '../../storage/mongodb/repositories/persistence-payload.repository';
import { PersistencePendingJobRepository } from '../../storage/mongodb/repositories/persistence-pending-job.repository';

const DRAIN_BATCH_SIZE = 100;
const DRAIN_IDLE_MS = 100;

export interface DrainDirtyListJob {
  bulkOpId: string;
  indexName: string;
}

/**
 * Persistence Queue Processor - single dedicated worker for all DB writes.
 *
 * Bulk ops: "drain-dirty-list" runs from the start; pops from the left of the Redis
 * dirty list in batches of 100 while indexers push to the right. Stops when list
 * is empty AND all batches are indexed. Single-batch: "persist-batch-terms" for that batch.
 */
@Injectable()
@Processor('term-persistence')
export class PersistenceQueueProcessor {
  private readonly logger = new Logger(PersistenceQueueProcessor.name);

  constructor(
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
    @InjectQueue('term-persistence') private readonly persistenceQueue: Queue,
    private readonly persistencePayloadRepo: PersistencePayloadRepository,
    private readonly persistencePendingJobRepo: PersistencePendingJobRepository,
  ) {
    this.logger.log('PersistenceQueueProcessor initialized - concurrency: 1 (sequential writes)');
  }

  /**
   * Drain the dirty list from the left in batches; runs concurrently with indexers.
   * We collect unique terms only; actual DB writes happen once the list is empty AND
   * all batches are indexed, so each term is written once with its final merged state.
   * (Writing as we pop would overwrite the same term multiple times → wrong counts.)
   */
  @Process({ name: PERSISTENCE_JOB_NAMES.DRAIN_DIRTY_LIST, concurrency: 1 })
  async drainDirtyList(
    job: Job<DrainDirtyListJob>,
  ): Promise<{ success: boolean; persistedCount: number }> {
    const { bulkOpId, indexName } = job.data;
    const startTime = Date.now();
    const uniqueTerms = new Set<string>();

    this.logger.log(`🔄 Drain worker started for ${indexName} (${bulkOpId})`);

    try {
      // Phase 1: drain list into unique set (don't persist yet – same term appears in many batches)
      for (;;) {
        const batch = await this.bulkOperationTracker.popDirtyTermsBatch(
          bulkOpId,
          DRAIN_BATCH_SIZE,
        );

        if (batch.length > 0) {
          batch.forEach(t => uniqueTerms.add(t));
          if (uniqueTerms.size > 0 && uniqueTerms.size % 500 === 0) {
            this.logger.debug(`Drain collected ${uniqueTerms.size} unique terms for ${bulkOpId}`);
          }
          continue;
        }

        const op = this.bulkOperationTracker.getOperation(bulkOpId);
        const listLen = await this.bulkOperationTracker.getDirtyListLength(bulkOpId);
        if (!op) {
          this.logger.warn(`Bulk op ${bulkOpId} not found; stopping drain`);
          break;
        }
        if (op.completedBatches >= op.totalBatches && listLen === 0) {
          break;
        }
        await new Promise(r => setTimeout(r, DRAIN_IDLE_MS));
      }

      // Phase 2: Do NOT persist here. The 20 per-batch jobs (with captured termPostings) are the
      // only writers; they merge into MongoDB. If the drain also persisted (memory+rocks+mongo),
      // it would race with those jobs and could overwrite with a partial list (e.g. 412 docs
      // instead of 3000). So the drain only drains the list and deletes it.
      const duration = Date.now() - startTime;
      await this.bulkOperationTracker.deleteDirtyList(bulkOpId);

      this.logger.log(
        `✅ Drain complete for ${bulkOpId}: ${uniqueTerms.size} terms drained in ${duration}ms. ` +
          `Persistence is done only by the 20 per-batch merge jobs.`,
      );
      return { success: true, persistedCount: 0 };
    } catch (error) {
      this.logger.error(`Drain failed for ${bulkOpId}: ${error.message}`);
      this.bulkOperationTracker.markOperationFailed(bulkOpId, error.message);
      throw error;
    }
  }

  /**
   * Persist a batch of terms: merge from memory, RocksDB, and MongoDB so we never overwrite
   * with a partial list (e.g. when in-memory cache was evicted and only had one batch's docs).
   */
  private async persistTermsBatch(
    terms: string[],
  ): Promise<{ persistedCount: number; failedCount: number }> {
    let persistedCount = 0;
    let failedCount = 0;
    await Promise.all(
      terms.map(async (indexAwareTerm: string) => {
        try {
          const firstColon = indexAwareTerm.indexOf(':');
          if (firstColon === -1) return;
          const termIndexName = indexAwareTerm.substring(0, firstColon);
          const fieldTerm = indexAwareTerm.substring(firstColon + 1);

          const memoryList = await (this.termDictionary as any).getPostingListForIndex(
            termIndexName,
            fieldTerm,
          );
          const rocksList = await this.persistentTermDictionary.getTermPostings(indexAwareTerm);
          const mongoList = await this.persistentTermDictionary.getTermPostingsFromMongoDB(
            indexAwareTerm,
          );

          const postingList = this.persistentTermDictionary.mergePostingLists([
            mongoList,
            rocksList,
            memoryList,
          ]);

          if (postingList.size() > 0) {
            await this.persistentTermDictionary.saveTermPostingsToRocksDB(
              indexAwareTerm,
              postingList,
            );
            await this.persistentTermDictionary.saveTermPostingsToMongoDB(
              indexAwareTerm,
              postingList,
            );
            persistedCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
      }),
    );
    return { persistedCount, failedCount };
  }

  /** Single-batch (non-bulk) persistence: one job per batch when not part of a bulk op. */
  @Process({ name: PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS, concurrency: 1 })
  async persistBatchTerms(job: Job<PersistenceBatchJob>): Promise<PersistenceBatchResult> {
    const raw = job.data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.logger.warn(
        `persist-batch-terms job ${job.id} has invalid payload (missing or non-object); completing with no-op`,
      );
      return {
        success: true,
        persistedCount: 0,
        failedCount: 0,
        duration: 0,
        batchId: String(job.id),
      };
    }

    let payload = raw as PersistenceBatchJob;
    let processedPayloadKey: string | null = null;
    if (payload.payloadKey) {
      const payloadKey = payload.payloadKey;
      let stored: string | null = null;
      const redis = this.persistenceQueue.client;
      try {
        stored = await redis.get(payloadKey);
      } catch {
        // Redis unavailable; try MongoDB
      }
      if (!stored) {
        stored = await this.persistencePayloadRepo.get(payloadKey);
      }
      if (!stored) {
        // Payload not found - check if batch was already persisted (idempotency check)
        // This can happen if:
        // 1. Batch was already persisted and payload was deleted
        // 2. Duplicate persistence job was enqueued (e.g., from recovery)
        // 3. Payload expired or was manually deleted
        const op =
          this.bulkOperationTracker.getOperation(payload.bulkOpId) ??
          (await this.bulkOperationTracker.getOrLoadOperation(payload.bulkOpId));
        if (op) {
          const persistedBatches = op.persistedBatches || 0;
          const totalBatches = op.totalBatches || 0;
          // If operation shows batches as persisted, this is likely a duplicate job
          if (persistedBatches >= totalBatches) {
            this.logger.warn(
              `persist-batch-terms job ${job.id}: payload key ${payloadKey} not found, but bulk operation ${payload.bulkOpId} shows all batches persisted. ` +
                `This is likely a duplicate job - skipping gracefully.`,
            );
            return {
              success: true,
              persistedCount: 0,
              failedCount: 0,
              duration: 0,
              batchId: payload.batchId,
            };
          }
        }
        this.logger.error(
          `persist-batch-terms job ${job.id}: payload key ${payloadKey} not found in Redis or MongoDB; batch ${payload.batchId} will not be persisted. ` +
            `If this batch was already persisted, this is a duplicate job and can be safely ignored.`,
        );
        return {
          success: false,
          persistedCount: 0,
          failedCount: 1,
          duration: 0,
          batchId: payload.batchId,
        };
      }
      try {
        const parsedPayload = JSON.parse(stored) as PersistenceBatchJob;
        // Clear the large JSON string from memory immediately after parsing
        stored = null;
        payload = parsedPayload;
      } catch (e: any) {
        // Clear stored even on error
        stored = null;
        this.logger.error(
          `persist-batch-terms job ${job.id}: failed to parse stored payload: ${e?.message}`,
        );
        return {
          success: false,
          persistedCount: 0,
          failedCount: 1,
          duration: 0,
          batchId: payload.batchId,
        };
      }
      // Remove from pending before deleting payload so a crash never leaves a pending ref with no payload
      // (recovery would then pop that ref and see "no payload in MongoDB").
      try {
        await this.persistencePendingJobRepo.removeByPayloadKey(payloadKey);
      } catch (e) {
        this.logger.warn(`Failed to remove pending job ${payloadKey}: ${(e as Error).message}`);
      }
      processedPayloadKey = payloadKey;
    }

    const result = await this.processResolvedPayload(payload);

    // Explicitly clear large payload object from memory after processing
    if (payload.termPostings) {
      payload.termPostings = undefined as any;
    }
    if (payload.dirtyTerms) {
      payload.dirtyTerms = undefined as any;
    }
    payload = null as any;

    // Delete payload after successful process (pending ref already removed above when we had payloadKey)
    if (processedPayloadKey) {
      try {
        await this.persistenceQueue.client.del(processedPayloadKey);
      } catch {
        // ignore
      }
      await this.persistencePayloadRepo.delete(processedPayloadKey);
    }
    return result;
  }

  /**
   * Runs persistence for a fully resolved payload (used by persistBatchTerms and by unnamed-job recovery).
   */
  private async processResolvedPayload(
    payload: PersistenceBatchJob,
  ): Promise<PersistenceBatchResult> {
    const { indexName, batchId, bulkOpId, dirtyTerms, termPostings } = payload;
    const startTime = Date.now();

    let persistedCount: number;
    let failedCount: number;

    if (termPostings && termPostings.length > 0) {
      this.logger.log(
        `📝 Merging ${termPostings.length} terms from batch ${batchId} into MongoDB (index: ${indexName})`,
      );
      persistedCount = 0;
      failedCount = 0;
      const failedTerms: string[] = [];
      for (const { indexAwareTerm, postings } of termPostings) {
        let list: SimplePostingList | null = null;
        try {
          list = new SimplePostingList();
          for (const [docId, entry] of Object.entries(postings)) {
            list.addEntry({
              docId,
              frequency: entry.frequency,
              positions: entry.positions || [],
              metadata: entry.metadata || {},
            });
          }
          if (list.size() > 0) {
            await this.persistentTermDictionary.saveTermPostingsToMongoDB(indexAwareTerm, list);
            persistedCount++;
          }
          // Clear the posting list from memory after saving
          list = null;
        } catch (err) {
          failedCount++;
          failedTerms.push(indexAwareTerm);
          this.logger.error(
            `Failed to persist term ${indexAwareTerm} in batch ${batchId}: ${
              (err as Error).message
            }`,
          );
        } finally {
          // Ensure list is cleared even on error
          if (list) list = null;
        }
      }
      // CRITICAL: If ANY terms failed, throw so Bull retries the job.
      // The merge is idempotent (re-persisting already-saved terms is a no-op),
      // so retrying is safe and ensures no data is silently lost.
      if (failedCount > 0) {
        const duration = Date.now() - startTime;
        this.logger.error(
          `❌ ${failedCount}/${termPostings.length} terms failed for batch ${batchId} in ${duration}ms. ` +
            `Throwing to trigger Bull retry. Failed terms: ${failedTerms.slice(0, 5).join(', ')}${
              failedTerms.length > 5 ? '...' : ''
            }`,
        );
        throw new Error(
          `Persistence failed for ${failedCount}/${termPostings.length} terms in batch ${batchId}`,
        );
      }
    } else {
      this.logger.log(
        `📝 Persisting ${dirtyTerms.length} terms (batch ${batchId}, index: ${indexName})`,
      );
      const result = await this.persistTermsBatch(dirtyTerms);
      persistedCount = result.persistedCount;
      failedCount = result.failedCount;
      // Also throw on failure for dirty-terms path
      if (failedCount > 0) {
        throw new Error(
          `Persistence failed for ${failedCount}/${dirtyTerms.length} dirty terms in batch ${batchId}`,
        );
      }
    }

    const duration = Date.now() - startTime;
    const totalTerms = termPostings?.length ?? dirtyTerms.length;
    this.logger.log(`✅ Persisted ${persistedCount}/${totalTerms} terms in ${duration}ms`);

    if (bulkOpId) {
      try {
        await this.bulkOperationTracker.markBatchPersisted(bulkOpId, batchId);
      } catch (error) {
        this.logger.warn(`Failed to update bulk operation tracker: ${(error as Error).message}`);
      }
    }

    return {
      success: true,
      persistedCount,
      failedCount: 0,
      duration,
      batchId,
    };
  }

  /**
   * Handle jobs that were queued without a name (Bull treats them as __default__).
   * Re-queue with the correct name so they are processed and data is not lost.
   */
  @Process({ name: PERSISTENCE_JOB_NAMES.__DEFAULT__, concurrency: 1 })
  async handleUnnamedJob(
    job: Job,
  ): Promise<{ requeued?: string; skipped?: boolean } | PersistenceBatchResult> {
    const raw = job.data;
    const data =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    if (!data) {
      this.logger.warn(
        `Unnamed persistence job ${job.id} has invalid payload (array or primitive); completing without retry`,
      );
      return { skipped: true };
    }
    if (
      data.bulkOpId != null &&
      data.indexName != null &&
      data.batchId == null &&
      !Array.isArray(data.dirtyTerms)
    ) {
      this.logger.warn(
        `Re-queuing unnamed job as drain-dirty-list (bulkOpId: ${data.bulkOpId}) to avoid data loss`,
      );
      await this.persistenceQueue.add(PERSISTENCE_JOB_NAMES.DRAIN_DIRTY_LIST, data, {
        priority: 10,
        removeOnComplete: false, // Keep all for tracking (was 50)
        removeOnFail: false,
      });
      return { requeued: PERSISTENCE_JOB_NAMES.DRAIN_DIRTY_LIST };
    }
    if (
      data.indexName != null &&
      (data.batchId != null ||
        data.payloadKey != null ||
        data.dirtyTerms != null ||
        data.termPostings != null)
    ) {
      this.logger.warn(
        `Re-queuing unnamed job as persist-batch-terms (batchId: ${
          data.batchId ?? data.payloadKey
        }) to avoid data loss`,
      );
      await this.persistenceQueue.add(
        PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS,
        data as unknown as PersistenceBatchJob,
        {
          priority: 5,
          removeOnComplete: false, // Keep all for tracking (was 100, but queue default was 50)
          removeOnFail: false,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      return { requeued: PERSISTENCE_JOB_NAMES.PERSIST_BATCH_TERMS };
    }
    const keys = Object.keys(data);
    if (keys.length === 0) {
      const recovered = await this.tryRecoverFromPending(String(job.id));
      if (recovered) return recovered;
    }
    this.logger.warn(
      `Unnamed persistence job ${job.id} with unknown or empty payload (keys: ${JSON.stringify(
        keys,
      )}). ` +
        `No pending job recovered from MongoDB. Ensure Redis has enough memory (maxmemory/noeviction) for Bull job keys.`,
    );
    return { skipped: true };
  }

  /**
   * When Bull's job key was evicted we have no payloadKey. Pop the oldest pending ref from MongoDB,
   * load the payload, process it, and return the result so the batch is not lost.
   * If a ref has no payload (stale from old run or previous bug), skip it and try the next.
   */
  private async tryRecoverFromPending(jobId: string): Promise<PersistenceBatchResult | null> {
    const maxAttempts = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const ref = await this.persistencePendingJobRepo.popOldest();
      if (!ref) return null;
      let stored = await this.persistencePayloadRepo.get(ref.payloadKey);
      if (!stored) {
        this.logger.debug(
          `Recovery for job ${jobId}: skipping stale pending ref ${ref.batchId} (no payload); trying next`,
        );
        continue;
      }
      let payload: PersistenceBatchJob;
      try {
        payload = JSON.parse(stored) as PersistenceBatchJob;
        // Clear stored string immediately after parsing
        stored = null;
      } catch (e) {
        stored = null;
        this.logger.warn(`Recovery for job ${jobId}: failed to parse payload for ${ref.batchId}`);
        continue;
      }
      this.logger.log(
        `Recovered batch ${ref.batchId} from MongoDB pending (Bull job ${jobId} had empty data)`,
      );
      const result = await this.processResolvedPayload(payload);
      // Clear payload from memory
      if (payload.termPostings) payload.termPostings = undefined as any;
      if (payload.dirtyTerms) payload.dirtyTerms = undefined as any;
      payload = null as any;
      await this.persistencePayloadRepo.delete(ref.payloadKey);
      return result;
    }
    this.logger.warn(
      `Recovery for job ${jobId}: gave up after ${maxAttempts} attempts (all refs had no payload)`,
    );
    return null;
  }

  /**
   * Drain all pending refs from MongoDB: process every ref that has a payload, skip (remove) refs
   * that have no payload (stale). Use this to clean the collection without waiting for recovery.
   * Returns counts of processed batches and skipped (stale) refs.
   */
  async drainPendingRefs(): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;
    const maxIterations = 10_000;
    for (let i = 0; i < maxIterations; i++) {
      const ref = await this.persistencePendingJobRepo.popOldest();
      if (!ref) break;
      let stored = await this.persistencePayloadRepo.get(ref.payloadKey);
      if (!stored) {
        skipped++;
        this.logger.debug(`Drain: skipped stale ref ${ref.batchId}`);
        continue;
      }
      let payload: PersistenceBatchJob;
      try {
        payload = JSON.parse(stored) as PersistenceBatchJob;
        // Clear stored string immediately after parsing
        stored = null;
      } catch {
        stored = null;
        skipped++;
        this.logger.warn(`Drain: failed to parse payload for ${ref.batchId}`);
        continue;
      }
      await this.processResolvedPayload(payload);
      // Clear payload from memory after processing
      if (payload.termPostings) payload.termPostings = undefined as any;
      if (payload.dirtyTerms) payload.dirtyTerms = undefined as any;
      payload = null as any;
      await this.persistencePayloadRepo.delete(ref.payloadKey);
      processed++;
      this.logger.log(
        `Drain: processed batch ${ref.batchId} (${processed} processed, ${skipped} skipped)`,
      );
    }
    if (processed > 0 || skipped > 0) {
      this.logger.log(
        `Drain complete: ${processed} batches processed, ${skipped} stale refs skipped`,
      );
    }
    return { processed, skipped };
  }

  @OnQueueCompleted()
  async onCompleted(job: Job, result: unknown) {
    const r = result as {
      persistedCount?: number;
      duration?: number;
      requeued?: string;
      skipped?: boolean;
    };
    if (r?.requeued) {
      this.logger.debug(`Persistence job ${job.id} re-queued as ${r.requeued}`);
    } else if (r?.skipped) {
      this.logger.debug(`Persistence job ${job.id} completed (skipped invalid payload)`);
    } else if (r?.persistedCount != null) {
      this.logger.debug(
        `Persistence job ${job.id} completed: ${r.persistedCount} terms in ${r.duration ?? '?'}ms`,
      );
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error) {
    this.logger.error(`Persistence job ${job.id} failed after all retries: ${error.message}`);
    const data = job.data as PersistenceBatchJob | DrainDirtyListJob;
    if (data?.bulkOpId) {
      this.bulkOperationTracker.markOperationFailed(
        data.bulkOpId,
        `Persistence failed for job ${job.id}: ${error.message}`,
      );
    }
  }
}
