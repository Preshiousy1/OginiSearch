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
  ) {
    this.logger.log('PersistenceQueueProcessor initialized - concurrency: 1 (sequential writes)');
  }

  /**
   * Drain the dirty list from the left in batches; runs concurrently with indexers.
   * We collect unique terms only; actual DB writes happen once the list is empty AND
   * all batches are indexed, so each term is written once with its final merged state.
   * (Writing as we pop would overwrite the same term multiple times → wrong counts.)
   */
  @Process({ name: 'drain-dirty-list', concurrency: 1 })
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
  @Process({ name: 'persist-batch-terms', concurrency: 1 })
  async persistBatchTerms(job: Job<PersistenceBatchJob>): Promise<PersistenceBatchResult> {
    const { indexName, batchId, bulkOpId, dirtyTerms, termPostings } = job.data;
    const startTime = Date.now();

    let persistedCount: number;
    let failedCount: number;

    if (termPostings && termPostings.length > 0) {
      // Bulk: merge this batch's postings into MongoDB (saveTermPostingsToMongoDB merges with existing)
      this.logger.log(
        `📝 Merging ${termPostings.length} terms from batch ${batchId} into MongoDB (index: ${indexName})`,
      );
      persistedCount = 0;
      failedCount = 0;
      for (const { indexAwareTerm, postings } of termPostings) {
        try {
          const list = new SimplePostingList();
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
        } catch {
          failedCount++;
        }
      }
    } else {
      this.logger.log(
        `📝 Persisting ${dirtyTerms.length} terms (batch ${batchId}, index: ${indexName})`,
      );
      const result = await this.persistTermsBatch(dirtyTerms);
      persistedCount = result.persistedCount;
      failedCount = result.failedCount;
    }

    const duration = Date.now() - startTime;
    const totalTerms = termPostings?.length ?? dirtyTerms.length;
    this.logger.log(
      `✅ Persisted ${persistedCount}/${totalTerms} terms in ${duration}ms (${failedCount} failed)`,
    );

    if (bulkOpId) {
      try {
        this.bulkOperationTracker.markBatchPersisted(bulkOpId, batchId);
      } catch (error) {
        this.logger.warn(`Failed to update bulk operation tracker: ${error.message}`);
      }
    }

    return {
      success: failedCount === 0,
      persistedCount,
      failedCount,
      duration,
      batchId,
    };
  }

  /**
   * Handle jobs that were queued without a name (Bull treats them as __default__).
   * Re-queue with the correct name so they are processed and data is not lost.
   */
  @Process({ name: '__default__', concurrency: 1 })
  async handleUnnamedJob(job: Job): Promise<{ requeued: string }> {
    const data = job.data as Record<string, unknown>;
    if (
      data?.bulkOpId != null &&
      data?.indexName != null &&
      data?.batchId == null &&
      !Array.isArray(data?.dirtyTerms)
    ) {
      this.logger.warn(
        `Re-queuing unnamed job as drain-dirty-list (bulkOpId: ${data.bulkOpId}) to avoid data loss`,
      );
      await this.persistenceQueue.add('drain-dirty-list', data, {
        priority: 10,
        removeOnComplete: 50,
        removeOnFail: false,
      });
      return { requeued: 'drain-dirty-list' };
    }
    if (
      data?.indexName != null &&
      (data?.batchId != null || data?.dirtyTerms != null || data?.termPostings != null)
    ) {
      this.logger.warn(
        `Re-queuing unnamed job as persist-batch-terms (batchId: ${data.batchId}) to avoid data loss`,
      );
      await this.persistenceQueue.add(
        'persist-batch-terms',
        data as unknown as PersistenceBatchJob,
        {
          priority: 5,
          removeOnComplete: 100,
          removeOnFail: false,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      return { requeued: 'persist-batch-terms' };
    }
    this.logger.error(
      `Unnamed persistence job with unknown payload: ${JSON.stringify(Object.keys(data || {}))}`,
    );
    throw new Error('Unknown persistence job payload - cannot re-queue');
  }

  @OnQueueCompleted()
  async onCompleted(job: Job, result: unknown) {
    const r = result as { persistedCount?: number; duration?: number; requeued?: string };
    if (r?.requeued) {
      this.logger.debug(`Persistence job ${job.id} re-queued as ${r.requeued}`);
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
