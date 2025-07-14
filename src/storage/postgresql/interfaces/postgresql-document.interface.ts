import { ProcessedDocument } from '../../../document/interfaces/document-processor.interface';

/**
 * PostgreSQL-specific processed document
 */
export interface PostgreSQLProcessedDocument extends ProcessedDocument {
  /**
   * PostgreSQL tsvector for full-text search
   */
  searchVector?: string;

  /**
   * Document boost factor for relevance scoring
   */
  boostFactor?: number;
}
