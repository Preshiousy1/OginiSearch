import { PostingEntry, PostingList } from './interfaces/posting.interface';

export class SimplePostingList implements PostingList {
  private entries: Map<string | number, PostingEntry> = new Map();

  constructor() {
    // Initialize any necessary properties or perform setup tasks here
  }

  addEntry(entry: PostingEntry): void {
    this.entries.set(entry.docId, entry);
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
    // Convert to a format that can be stored efficiently
    const data = JSON.stringify(Array.from(this.entries.entries()));
    return Buffer.from(data);
  }

  deserialize(data: Buffer): void {
    const entriesArray = JSON.parse(data.toString());
    this.entries = new Map(entriesArray);
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
