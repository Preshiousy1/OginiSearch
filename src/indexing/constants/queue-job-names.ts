/**
 * Centralized job names for all queues. Use these constants whenever adding jobs
 * so that no job is ever created with null, undefined, or __default__.
 *
 * Bull uses the first argument to queue.add(name, data, opts) as the job name;
 * if name is omitted or not a string, Bull may assign __default__, which can
 * cause "Missing process handler" errors. Always pass a constant from this file.
 */

/** Job names for the 'indexing' queue (IndexingQueueProcessor) */
export const INDEXING_JOB_NAMES = {
  BATCH: 'batch',
  SINGLE: 'single',
  WAKEUP: 'wakeup',
  HEALTH_CHECK: 'health-check',
  /** Handler for jobs that were queued without a name; do not use when adding jobs */
  __DEFAULT__: '__default__',
} as const;

/** Job names for the 'term-persistence' queue (PersistenceQueueProcessor) */
export const PERSISTENCE_JOB_NAMES = {
  PERSIST_BATCH_TERMS: 'persist-batch-terms',
  DRAIN_DIRTY_LIST: 'drain-dirty-list',
  /** Handler for unnamed persistence jobs; do not use when adding jobs */
  __DEFAULT__: '__default__',
} as const;

/** Job names for the 'bulk-indexing' queue (if used) */
export const BULK_INDEXING_JOB_NAMES = {
  PROCESS_BULK: 'process-bulk',
} as const;

/** Job names for the dead-letter queue (indexing-dlq) */
export const DEAD_LETTER_JOB_NAMES = {
  FAILED: 'failed',
} as const;

export type IndexingJobName = (typeof INDEXING_JOB_NAMES)[keyof typeof INDEXING_JOB_NAMES];
export type PersistenceJobName = (typeof PERSISTENCE_JOB_NAMES)[keyof typeof PERSISTENCE_JOB_NAMES];
