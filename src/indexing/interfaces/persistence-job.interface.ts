/** Serialized postings for one term (safe for Bull job payload) */
export interface SerializedTermPostings {
  indexAwareTerm: string;
  postings: Record<
    string,
    { docId: string; frequency: number; positions?: number[]; metadata?: Record<string, any> }
  >;
}

/**
 * Job payload for term persistence queue.
 * Contains the terms that need to be persisted to MongoDB for a specific batch.
 */
export interface PersistenceBatchJob {
  /** The index name */
  indexName: string;

  /** The batch ID from the original indexing job */
  batchId: string;

  /** The parent bulk operation ID (tracks entire multi-batch operation) */
  bulkOpId: string;

  /** Index-aware terms to persist (format: indexName:field:term) */
  dirtyTerms: string[];

  /**
   * Optional: per-term postings from this batch. When set, these are merged into MongoDB
   * so bulk indexing gets correct counts (in-memory cache can be partial due to eviction).
   */
  termPostings?: SerializedTermPostings[];

  /** Unique ID for this persistence job */
  persistenceId: string;

  /** Optional priority (higher = processed first) */
  priority?: number;

  /** Timestamp when the indexing batch completed */
  indexedAt: Date;
}

/**
 * Result returned from persistence job processing
 */
export interface PersistenceBatchResult {
  /** Whether persistence succeeded */
  success: boolean;

  /** Number of terms successfully persisted */
  persistedCount: number;

  /** Number of terms that failed to persist */
  failedCount: number;

  /** Duration in milliseconds */
  duration: number;

  /** The batch ID that was persisted */
  batchId: string;

  /** Any error message if failed */
  error?: string;
}
