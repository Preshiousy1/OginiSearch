/**
 * Options for bulk indexing operations
 */
export interface BulkIndexingOptions {
  /**
   * Number of documents to process in each batch
   */
  batchSize?: number;

  /**
   * Whether to skip duplicate documents
   */
  skipDuplicates?: boolean;

  /**
   * Whether to enable progress tracking
   */
  enableProgress?: boolean;

  /**
   * Priority of the bulk indexing job (1-10)
   */
  priority?: number;

  /**
   * Number of retry attempts for failed jobs
   */
  retryAttempts?: number;

  /**
   * Delay between retry attempts (in milliseconds)
   */
  retryDelay?: number;
}
