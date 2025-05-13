import { PostingEntry, PostingList } from './interfaces/posting.interface';
import { Logger } from '@nestjs/common';

/**
 * A posting list implementation with compression for storage efficiency
 */
export class CompressedPostingList implements PostingList {
  private entries: PostingEntry[] = [];
  private readonly logger = new Logger(CompressedPostingList.name);
  private readonly BATCH_SIZE = 1000; // Process entries in batches

  addEntry(entry: PostingEntry): void {
    if (entry && entry.docId && typeof entry.frequency === 'number' && entry.frequency > 0) {
      // Only add valid entries
      this.entries.push(entry);
    }
  }

  removeEntry(docId: number | string): boolean {
    const index = this.entries.findIndex(e => e.docId === docId);
    if (index !== -1) {
      this.entries.splice(index, 1);
      return true;
    }
    return false;
  }

  getEntry(docId: number | string): PostingEntry | undefined {
    return this.entries.find(e => e.docId === docId);
  }

  getEntries(): PostingEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }

  /**
   * Compress a posting list using delta encoding for docIds and frequencies
   */
  serialize(): Buffer {
    try {
      // Process entries in batches to avoid memory issues
      const batches = [];
      for (let i = 0; i < this.entries.length; i += this.BATCH_SIZE) {
        const batch = this.entries.slice(i, i + this.BATCH_SIZE);
        const serializedBatch = batch.map(entry => ({
          d: entry.docId,
          f: entry.frequency,
          p: Array.isArray(entry.positions) ? entry.positions : [],
          m: entry.metadata || {},
        }));
        batches.push(serializedBatch);
      }

      // Combine all batches
      const data = {
        entries: batches.flat(),
        version: 1,
      };

      return Buffer.from(JSON.stringify(data));
    } catch (error) {
      this.logger.error(`Failed to serialize posting list: ${error.message}`);
      throw error;
    }
  }

  /**
   * Decompress a posting list from delta-encoded format
   */
  deserialize(data: Buffer | Record<string, any> | string): void {
    try {
      // Clear existing entries first
      this.entries = [];

      let parsed;

      // Handle different data types
      if (Buffer.isBuffer(data)) {
        try {
          parsed = JSON.parse(data.toString());
        } catch (parseError) {
          this.logger.warn(`Invalid JSON data in posting list: ${parseError.message}`);
          return; // Return early rather than throwing
        }
      } else if (
        data &&
        typeof data === 'object' &&
        data.type === 'Buffer' &&
        Array.isArray(data.data)
      ) {
        // Handle Buffer-like object
        const buffer = Buffer.from(data.data);
        try {
          parsed = JSON.parse(buffer.toString());
        } catch (parseError) {
          this.logger.warn(`Invalid JSON data in posting list: ${parseError.message}`);
          return;
        }
      } else if (typeof data === 'string') {
        try {
          parsed = JSON.parse(data);
        } catch (parseError) {
          this.logger.warn(`Invalid JSON data in posting list: ${parseError.message}`);
          return;
        }
      } else {
        // If it's already a JavaScript object
        parsed = data;
      }

      // Handle versioned data structure
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.entries)) {
        // Process entries in batches
        for (let i = 0; i < parsed.entries.length; i += this.BATCH_SIZE) {
          const batch = parsed.entries.slice(i, i + this.BATCH_SIZE);
          for (const entry of batch) {
            if (entry && entry.d && typeof entry.f === 'number' && entry.f > 0) {
              this.entries.push({
                docId: entry.d,
                frequency: entry.f,
                positions: Array.isArray(entry.p) ? entry.p : [],
                metadata: entry.m || {},
              });
            }
          }
        }
      } else {
        this.logger.warn('Invalid posting list data format');
      }
    } catch (error) {
      this.logger.error(`Failed to deserialize posting list: ${error.message}`);
      // Don't throw, just log the error and continue with empty entries
    }
  }
}
