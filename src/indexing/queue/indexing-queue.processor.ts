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
import { IndexNotFoundError } from '../errors/index-not-found.error';
import { SerializedTermPostings } from '../interfaces/persistence-job.interface';
import { TermDictionary } from '../../index/interfaces/term-dictionary.interface';
import { PersistentTermDictionaryService } from '../../storage/index-storage/persistent-term-dictionary.service';

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
    @InjectQueue('term-persistence') private readonly persistenceQueue: Queue,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: TermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
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

  @Process({ name: 'single', concurrency: 5 })
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

  @Process({ name: 'health-check', concurrency: 1 })
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

  @Process({ name: 'wakeup', concurrency: 1 })
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
    name: 'batch',
    concurrency: BATCH_CONCURRENCY,
  })
  async processBatchDocuments(job: Job<BatchIndexingJob>) {
    const { indexName, documents, batchId, options, metadata } = job.data;
    const bulkOpId = metadata?.bulkOpId; // Bulk operation ID for coordination
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
      if (bulkOpId) {
        try {
          await this.bulkOperationTracker.pushDirtyTerms(bulkOpId, Array.from(batchDirtyTerms));
          this.bulkOperationTracker.markBatchIndexed(bulkOpId, batchId);
          // Use postings captured during indexing (not from cache) so eviction can't drop terms
          const termPostings = this.buildSerializedTermPostings(batchTermPostings);
          if (termPostings.length > 0) {
            await this.persistenceQueue.add(
              'persist-batch-terms',
              {
                indexName,
                batchId,
                bulkOpId,
                dirtyTerms: Array.from(batchDirtyTerms),
                termPostings,
                persistenceId: `persist:${bulkOpId}:${batchId}`,
                indexedAt: new Date(),
              },
              {
                priority: 5,
                removeOnComplete: 100,
                removeOnFail: false,
                attempts: 5,
                backoff: { type: 'exponential', delay: 2000 },
              },
            );
          }
        } catch (error) {
          this.logger.warn(`Failed to update bulk operation tracker: ${error.message}`);
        }
      } else {
        // Single-batch (non-bulk): still queue one persistence job for this batch
        if (batchDirtyTerms.size > 0) {
          await this.persistenceQueue.add(
            'persist-batch-terms',
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
              removeOnComplete: 50,
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

  @OnQueueActive()
  onActive(job: Job) {
    // Reduced logging - only log in debug mode
    this.logger.debug(`Job ${job.id} (${job.name}) is now ACTIVE`);
    // Log active count periodically for debugging concurrency issues
    if (job.name === 'batch' && Math.random() < 0.01) {
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

    if (isIndexNotFound) {
      const indexName =
        typeof jobSummary === 'object' && 'indexName' in jobSummary
          ? jobSummary.indexName
          : 'unknown';
      this.logger.warn(
        `⚠️ Job ${job.id} (${job.name}) PERMANENTLY FAILED - Index does not exist: ${indexName}. Job will not be retried.`,
      );
      // Mark job as permanently failed (no more retries)
      job.opts.attempts = job.attemptsMade;
    } else {
      this.logger.error(
        `❌ Job ${job.id} (${job.name}) FAILED after ${job.attemptsMade}/${job.opts.attempts} attempts: ${error.message}`,
      );
    }
    this.logger.debug(`Job summary: ${JSON.stringify(jobSummary)}`);
  }
}
