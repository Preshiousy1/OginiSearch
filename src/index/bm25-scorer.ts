import { Scorer, BM25Parameters, IndexStats } from './interfaces/scoring.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
export class BM25Scorer implements Scorer {
  private k1: number;
  private b: number;
  private fieldWeights: Record<string, number>;
  private indexStats: IndexStats;

  constructor(indexStats: IndexStats, params: BM25Parameters = {}) {
    this.indexStats = indexStats;
    this.k1 = params.k1 !== undefined ? params.k1 : 1.2;
    this.b = params.b !== undefined ? params.b : 0.75;
    this.fieldWeights = params.fieldWeights || {};
  }

  /**
   * Calculate BM25 score for a document-term pair in a specific field
   */
  score(term: string, docId: string | number, field: string, termFrequency: number): number {
    if (termFrequency <= 0) {
      return 0;
    }

    // Get field weight (default to 1.0 if not specified)
    const fieldWeight = this.fieldWeights[field] || 1.0;

    // Get document frequency (number of documents containing this term)
    const df = this.indexStats.getDocumentFrequency(term);
    if (df <= 0) {
      return 0;
    }

    // Get total number of documents in the index
    const N = this.indexStats.totalDocuments;

    // Calculate IDF (Inverse Document Frequency)
    // Adding 1 to N to avoid division by zero and handle edge cases
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    // Get field length normalization components
    const fieldLength = this.indexStats.getFieldLength(docId, field);
    const avgFieldLength = this.indexStats.getAverageFieldLength(field);

    // Avoid division by zero
    if (avgFieldLength === 0) {
      return 0;
    }

    // Calculate normalized field length
    const normalizedLength = fieldLength / avgFieldLength;

    // Calculate BM25 score component for this term-document-field combination
    const numerator = termFrequency * (this.k1 + 1);
    const denominator = termFrequency + this.k1 * (1 - this.b + this.b * normalizedLength);

    // Final score calculation with field weighting
    return idf * (numerator / denominator) * fieldWeight;
  }

  /**
   * Score a document across multiple fields (combined score)
   */
  scoreMultipleFields(
    term: string,
    docId: string | number,
    fieldFrequencies: Record<string, number>,
  ): number {
    let totalScore = 0;

    for (const [field, frequency] of Object.entries(fieldFrequencies)) {
      totalScore += this.score(term, docId, field, frequency);
    }

    return totalScore;
  }

  /**
   * Get the name of this scoring algorithm
   */
  getName(): string {
    return 'bm25';
  }

  /**
   * Get current scoring parameters
   */
  getParameters(): Record<string, any> {
    return {
      k1: this.k1,
      b: this.b,
      fieldWeights: { ...this.fieldWeights },
    };
  }

  /**
   * Set scoring parameters
   */
  setParameters(params: BM25Parameters): void {
    if (params.k1 !== undefined) {
      this.k1 = params.k1;
    }

    if (params.b !== undefined) {
      this.b = params.b;
    }

    if (params.fieldWeights) {
      this.fieldWeights = { ...params.fieldWeights };
    }
  }
}
