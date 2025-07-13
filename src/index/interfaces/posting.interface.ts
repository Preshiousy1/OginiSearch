/**
 * Represents a document entry in a posting list
 */
export interface PostingEntry {
  /**
   * Document ID
   */
  docId: string;

  /**
   * Term frequency in the document
   */
  frequency: number;

  /**
   * Optional list of positions where the term appears in the document
   */
  positions: number[];

  /**
   * Optional metadata for the posting entry
   */
  metadata?: Record<string, any>;
}

/**
 * Interface for posting list operations
 */
export interface PostingList {
  /**
   * Add a document to the posting list
   */
  addEntry(entry: PostingEntry): void;

  /**
   * Remove a document from the posting list
   */
  removeEntry(docId: string | number): boolean;

  /**
   * Get a posting entry by document ID
   */
  getEntry(docId: string | number): PostingEntry | undefined;

  /**
   * Get all posting entries
   */
  getEntries(): PostingEntry[];

  /**
   * Get the size of the posting list
   */
  size(): number;

  /**
   * Serialize the posting list for storage
   */
  serialize(): any;

  /**
   * Deserialize a posting list from storage
   */
  deserialize(data: any): void;
}

/**
 * Interface for term dictionary operations
 */
export interface TermDictionary {
  /**
   * Initialize the dictionary
   */
  initialize(): Promise<void>;

  /**
   * Add a term to the dictionary
   */
  addTerm(term: string): Promise<void>;

  /**
   * Remove a term from the dictionary
   */
  removeTerm(term: string): Promise<void>;

  /**
   * Add a document to a term's posting list
   */
  addPosting(term: string, documentId: string, positions: number[]): Promise<void>;

  /**
   * Remove a document from a term's posting list
   */
  removePosting(term: string, documentId: string): Promise<void>;

  /**
   * Get all terms in the dictionary
   */
  getTerms(): string[];

  /**
   * Get postings for a term
   */
  getPostings(term: string): Map<string, number[]> | undefined;

  /**
   * Check if a posting exists for a term and document
   */
  hasPosting(term: string, documentId: string): boolean;

  /**
   * Clear the dictionary
   */
  clear(): void;

  /**
   * Get the number of terms in the dictionary
   */
  size(): number;
}
