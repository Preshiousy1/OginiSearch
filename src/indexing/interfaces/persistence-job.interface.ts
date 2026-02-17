/** Serialized postings for one term (safe for Bull job payload) */
export interface SerializedTermPostings {
  indexAwareTerm: string;
  postings: Record<
    string,
    { docId: string; frequency: number; positions?: number[]; metadata?: Record<string, any> }
  >;
}

/** Redis key prefix for out-of-band persistence payloads (avoids Bull job size limits) */
export const PERSIST_PAYLOAD_REDIS_PREFIX = 'persist:payload:';
export const PERSIST_PAYLOAD_TTL_SEC = 86400 * 7; // 7 days

/** MongoDB key prefix for indexing batch payloads (avoids Bull/Redis eviction of large job data) */
export const INDEX_PAYLOAD_PREFIX = 'index:payload:';

/**
 * Job payload for term persistence queue.
 * When payloadKey is set, the full payload is in Redis; otherwise fields are inline.
 */
export interface PersistenceBatchJob {
  /** When set, load full payload from Redis at this key (avoids large Bull job data) */
  payloadKey?: string;

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
