import { PostingEntry, PostingList } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';

/**
 * A posting list implementation with compression for storage efficiency
 */
export class CompressedPostingList implements PostingList {
  private internalList: SimplePostingList;

  constructor() {
    this.internalList = new SimplePostingList();
  }

  addEntry(entry: PostingEntry): void {
    this.internalList.addEntry(entry);
  }

  removeEntry(docId: string | number): boolean {
    return this.internalList.removeEntry(docId);
  }

  getEntry(docId: string | number): PostingEntry | undefined {
    return this.internalList.getEntry(docId);
  }

  getEntries(): PostingEntry[] {
    return this.internalList.getEntries();
  }

  size(): number {
    return this.internalList.size();
  }

  /**
   * Compress a posting list using delta encoding for docIds and frequencies
   */
  serialize(): Buffer {
    const entries = this.internalList.getEntries().sort((a, b) => {
      if (typeof a.docId === 'number' && typeof b.docId === 'number') {
        return a.docId - b.docId;
      }
      return String(a.docId).localeCompare(String(b.docId));
    });

    if (entries.length === 0) {
      return Buffer.from([]);
    }

    // Delta encode document IDs and frequencies for compression
    const encoded = {
      docIds: this.deltaEncode(entries.map(e => Number(e.docId))),
      frequencies: entries.map(e => e.frequency),
      // Store positions differently - as arrays of positions per document
      positions: entries.map(e => e.positions || []),
    };

    return Buffer.from(JSON.stringify(encoded));
  }

  /**
   * Decompress a posting list from delta-encoded format
   */
  deserialize(data: Buffer): void {
    if (data.length === 0) {
      this.internalList = new SimplePostingList();
      return;
    }

    const encoded = JSON.parse(data.toString());
    const docIds = this.deltaDecode(encoded.docIds);
    const entries: PostingEntry[] = [];

    for (let i = 0; i < docIds.length; i++) {
      entries.push({
        docId: docIds[i],
        frequency: encoded.frequencies[i],
        positions: encoded.positions[i],
      });
    }

    this.internalList = new SimplePostingList();
    for (const entry of entries) {
      this.internalList.addEntry(entry);
    }
  }

  /**
   * Apply delta encoding to a list of numbers
   * Stores differences between consecutive values instead of absolute values
   */
  private deltaEncode(numbers: number[]): number[] {
    if (!numbers.length) return [];

    const result = [numbers[0]]; // First number is stored as-is

    for (let i = 1; i < numbers.length; i++) {
      // Store the difference from the previous number
      result.push(numbers[i] - numbers[i - 1]);
    }

    return result;
  }

  /**
   * Decode a delta-encoded list back to absolute values
   */
  private deltaDecode(deltas: number[]): number[] {
    if (!deltas.length) return [];

    const result = [deltas[0]]; // First number is stored as-is

    for (let i = 1; i < deltas.length; i++) {
      // Add the delta to the previous result to get the actual value
      result.push(result[i - 1] + deltas[i]);
    }

    return result;
  }
}
