import { Injectable } from '@nestjs/common';
import { IndexStats } from './interfaces/scoring.interface';

@Injectable()
export class IndexStatsService implements IndexStats {
  // Collection of document frequencies (how many documents contain each term)
  private documentFrequencies: Map<string, number> = new Map();

  // Track field lengths for each document
  private fieldLengths: Map<string, Map<string, number>> = new Map();

  // Sum of field lengths for calculating averages
  private fieldLengthSums: Map<string, number> = new Map();

  // Track total document count
  private _totalDocuments = 0;

  constructor() {
    // Initialize any necessary properties or perform setup tasks here
  }

  get totalDocuments(): number {
    return this._totalDocuments;
  }

  /**
   * Get document frequency for a term
   */
  getDocumentFrequency(term: string): number {
    return this.documentFrequencies.get(term) || 0;
  }

  /**
   * Get average length of a specific field across all documents
   */
  getAverageFieldLength(field: string): number {
    const sum = this.fieldLengthSums.get(field) || 0;
    return this._totalDocuments > 0 ? sum / this._totalDocuments : 0;
  }

  /**
   * Get length of a specific field in a document
   */
  getFieldLength(docId: string | number, field: string): number {
    const docKey = String(docId);
    const fieldMap = this.fieldLengths.get(docKey);
    return fieldMap ? fieldMap.get(field) || 0 : 0;
  }

  /**
   * Update stats when a document is added or removed
   */
  updateDocumentStats(
    docId: string | number,
    fieldLengths: Record<string, number>,
    isRemoval = false,
  ): void {
    const docKey = String(docId);
    const multiplier = isRemoval ? -1 : 1;

    // Update total documents count
    if (!isRemoval && !this.fieldLengths.has(docKey)) {
      this._totalDocuments++;
    } else if (isRemoval && this.fieldLengths.has(docKey)) {
      this._totalDocuments--;
    }

    // Get existing field lengths for this document (or create new map)
    let existingFields = this.fieldLengths.get(docKey);
    if (!existingFields) {
      existingFields = new Map();
      if (!isRemoval) {
        this.fieldLengths.set(docKey, existingFields);
      }
    }

    // Update field length statistics
    for (const [field, length] of Object.entries(fieldLengths)) {
      // Update field length sum
      const currentSum = this.fieldLengthSums.get(field) || 0;
      this.fieldLengthSums.set(field, currentSum + length * multiplier);

      // Update stored field length
      if (isRemoval) {
        existingFields.delete(field);
      } else {
        existingFields.set(field, length);
      }
    }

    // If removing, delete the document's entry if it's now empty
    if (isRemoval && existingFields.size === 0) {
      this.fieldLengths.delete(docKey);
    }
  }

  /**
   * Update term statistics when documents are added or removed
   */
  updateTermStats(term: string, docId: string | number, isRemoval = false): void {
    const currentFreq = this.documentFrequencies.get(term) || 0;
    const newFreq = currentFreq + (isRemoval ? -1 : 1);

    if (newFreq <= 0) {
      this.documentFrequencies.delete(term);
    } else {
      this.documentFrequencies.set(term, newFreq);
    }
  }

  /**
   * Reset all statistics (useful for testing or reindexing)
   */
  reset(): void {
    this.documentFrequencies.clear();
    this.fieldLengths.clear();
    this.fieldLengthSums.clear();
    this._totalDocuments = 0;
  }

  /**
   * Get all terms with their document frequencies
   */
  getTermFrequencies(): Map<string, number> {
    return new Map(this.documentFrequencies);
  }

  /**
   * Get stats for a specific document
   */
  getDocumentStats(docId: string | number): Record<string, number> | null {
    const docKey = String(docId);
    const fieldMap = this.fieldLengths.get(docKey);

    if (!fieldMap) {
      return null;
    }

    const stats: Record<string, number> = {};
    for (const [field, length] of fieldMap.entries()) {
      stats[field] = length;
    }

    return stats;
  }
}
