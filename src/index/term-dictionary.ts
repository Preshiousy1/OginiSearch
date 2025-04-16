import { PostingEntry, PostingList, TermDictionary } from './interfaces/posting.interface';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';

export interface TermDictionaryOptions {
  useCompression?: boolean;
}

export class InMemoryTermDictionary implements TermDictionary {
  private dictionary: Map<string, PostingList> = new Map();
  private options: TermDictionaryOptions;

  constructor(options: TermDictionaryOptions = {}) {
    this.options = {
      useCompression: true,
      ...options,
    };
  }

  addTerm(term: string): PostingList {
    if (!this.dictionary.has(term)) {
      const postingList = this.options.useCompression
        ? new CompressedPostingList()
        : new SimplePostingList();
      this.dictionary.set(term, postingList);
    }
    return this.dictionary.get(term);
  }

  getPostingList(term: string): PostingList | undefined {
    return this.dictionary.get(term);
  }

  hasTerm(term: string): boolean {
    return this.dictionary.has(term);
  }

  removeTerm(term: string): boolean {
    return this.dictionary.delete(term);
  }

  getTerms(): string[] {
    return Array.from(this.dictionary.keys());
  }

  size(): number {
    return this.dictionary.size;
  }

  addPosting(term: string, entry: PostingEntry): void {
    const postingList = this.addTerm(term);
    postingList.addEntry(entry);
  }

  removePosting(term: string, docId: number | string): boolean {
    const postingList = this.dictionary.get(term);
    if (!postingList) {
      return false;
    }

    const removed = postingList.removeEntry(docId);

    // If posting list is empty, remove the term
    if (postingList.size() === 0) {
      this.dictionary.delete(term);
    }

    return removed;
  }

  serialize(): Buffer {
    // Serialize each term and its posting list
    const serialized = {};

    for (const [term, postingList] of this.dictionary.entries()) {
      serialized[term] = postingList.serialize();
    }

    return Buffer.from(JSON.stringify(serialized));
  }

  deserialize(data: Buffer): void {
    this.dictionary.clear();

    const serialized = JSON.parse(data.toString());

    for (const term in serialized) {
      if (Object.prototype.hasOwnProperty.call(serialized, term)) {
        const postingList = this.options.useCompression
          ? new CompressedPostingList()
          : new SimplePostingList();

        // Convert string back to Buffer before deserializing
        const buffer = Buffer.from(serialized[term]);
        postingList.deserialize(buffer);

        this.dictionary.set(term, postingList);
      }
    }
  }

  /**
   * Get term statistics including document frequency
   */
  getTermStats(term: string): { term: string; docFreq: number } | undefined {
    const postingList = this.dictionary.get(term);
    if (!postingList) {
      return undefined;
    }

    return {
      term,
      docFreq: postingList.size(),
    };
  }

  /**
   * Get multiple posting lists at once for efficient retrieval
   */
  getPostingLists(terms: string[]): Map<string, PostingList> {
    const result = new Map<string, PostingList>();

    for (const term of terms) {
      const postingList = this.dictionary.get(term);
      if (postingList) {
        result.set(term, postingList);
      }
    }

    return result;
  }
}
