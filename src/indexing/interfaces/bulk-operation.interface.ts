/**
 * Represents a bulk indexing operation that spans multiple batches.
 * Used to coordinate batch completion and trigger final cleanup.
 */
export interface BulkOperation {
  /** Unique identifier for this bulk operation */
  id: string;

  /** The index being populated */
  indexName: string;

  /** Total number of batches in this operation */
  totalBatches: number;

  /** Number of batches that have completed indexing */
  completedBatches: number;

  /** Number of batches that have been persisted to MongoDB */
  persistedBatches: number;

  /** Array of all batch job IDs */
  batchIds: string[];

  /** Set of batch IDs that have enqueued persistence jobs (for verification) */
  persistenceJobsEnqueued?: Set<string> | string[];

  /** When the operation was created */
  createdAt: Date;

  /** Current status of the operation */
  status: 'indexing' | 'persisting' | 'completed' | 'failed';

  /** Total number of documents in this operation */
  totalDocuments?: number;

  /** When the last update occurred */
  updatedAt?: Date;

  /** Error message if failed */
  error?: string;
}

/**
 * Event emitted when all batches have been indexed (but not yet persisted).
 * dirtyTerms is the union of all batch dirty terms - single persistence job uses this.
 */
export interface AllBatchesIndexedEvent {
  bulkOpId: string;
  indexName: string;
  totalBatches: number;
  totalDocuments: number;
  indexingDuration: number;
  /** Accumulated dirty terms from all batches - for single-writer persistence job */
  dirtyTerms: string[];
}

/**
 * Event emitted when all batches have been persisted to MongoDB
 */
export interface BulkOperationCompletedEvent {
  bulkOpId: string;
  indexName: string;
  totalBatches: number;
  totalDocuments: number;
  indexingDuration: number;
  persistenceDuration: number;
  totalDuration: number;
}
