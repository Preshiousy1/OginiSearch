/**
 * Interface for index-level statistics needed for scoring
 */
export interface IndexStats {
  /**
   * Total number of documents in the index
   */
  totalDocuments: number;

  /**
   * Get document frequency (number of documents containing a term)
   */
  getDocumentFrequency(term: string): number;

  /**
   * Get average field length for a specific field
   */
  getAverageFieldLength(field: string): number;

  /**
   * Get the length of a specific field in a document
   */
  getFieldLength(docId: string | number, field: string): number;

  /**
   * Update stats for a document (add or remove)
   */
  updateDocumentStats(
    docId: string | number,
    fieldLengths: Record<string, number>,
    isRemoval?: boolean,
  ): void;

  /**
   * Update term frequency stats
   */
  updateTermStats(term: string, docId: string | number, isRemoval?: boolean): void;
}

/**
 * Interface for scoring algorithms
 */
export interface Scorer {
  /**
   * Calculate a score for a document matching a term
   */
  score(term: string, docId: string | number, field: string, termFrequency: number): number;

  /**
   * Get the name of the scoring algorithm
   */
  getName(): string;

  /**
   * Get the current scoring parameters
   */
  getParameters(): Record<string, any>;
}

/**
 * Parameters for BM25 scoring algorithm
 */
export interface BM25Parameters {
  /**
   * Controls term frequency saturation (default: 1.2)
   */
  k1?: number;

  /**
   * Controls field length normalization (default: 0.75)
   */
  b?: number;

  /**
   * Field weights for multi-field scoring (optional)
   */
  fieldWeights?: Record<string, number>;
}
