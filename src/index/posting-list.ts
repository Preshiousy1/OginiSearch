import { PostingEntry, PostingList } from './interfaces/posting.interface';

export class SimplePostingList implements PostingList {
  private entries: Map<string | number, PostingEntry> = new Map();

  constructor() {
    // Initialize any necessary properties or perform setup tasks here
  }

  addEntry(entry: PostingEntry): void {
    this.entries.set(entry.docId, { ...entry });
  }

  removeEntry(docId: string | number): boolean {
    return this.entries.delete(docId);
  }

  getEntry(docId: string | number): PostingEntry | undefined {
    return this.entries.get(docId);
  }

  getEntries(): PostingEntry[] {
    return Array.from(this.entries.values());
  }

  size(): number {
    return this.entries.size;
  }

  serialize(): Buffer {
    // Convert entries to a serializable array format
    const serializable = Array.from(this.entries.entries()).map(([docId, entry]) => ({
      docId,
      ...entry,
    }));
    return Buffer.from(JSON.stringify(serializable));
  }

  deserialize(data: Buffer | Record<string, any> | string): void {
    try {
      let parsed;
      
      // Handle different data types
      if (Buffer.isBuffer(data)) {
        parsed = JSON.parse(data.toString());
      } else if (data && typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
        // Handle Buffer-like object
        const buffer = Buffer.from(data.data);
        parsed = JSON.parse(buffer.toString());
      } else if (typeof data === 'string') {
        parsed = JSON.parse(data);
      } else {
        // If it's already a JavaScript object
        parsed = data;
      }
      
      this.entries.clear();

      // Reconstruct entries from the parsed array
      for (const entry of parsed) {
        const { docId, ...rest } = entry;
        this.entries.set(docId, { docId, ...rest });
      }
    } catch (error) {
      throw new Error(`Failed to deserialize posting list: ${error.message}`);
    }
  }

  /**
   * Update the frequency of a posting entry
   */
  updateFrequency(docId: string | number, increment: number): void {
    const entry = this.entries.get(docId);
    if (entry) {
      entry.frequency += increment;
      if (entry.frequency <= 0) {
        this.entries.delete(docId);
      }
    }
  }

  /**
   * Add position data to a posting entry
   */
  addPosition(docId: string | number, position: number): void {
    const entry = this.entries.get(docId);
    if (entry) {
      if (!entry.positions) {
        entry.positions = [];
      }
      entry.positions.push(position);
    }
  }

  /**
   * Merge another posting list into this one
   */
  merge(other: PostingList): void {
    for (const entry of other.getEntries()) {
      const existingEntry = this.entries.get(entry.docId);
      if (existingEntry) {
        existingEntry.frequency += entry.frequency;
        if (entry.positions && entry.positions.length > 0) {
          if (!existingEntry.positions) {
            existingEntry.positions = [];
          }
          existingEntry.positions.push(...entry.positions);
        }
      } else {
        this.addEntry({ ...entry });
      }
    }
  }
}
