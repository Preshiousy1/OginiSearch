/**
 * Represents a document entry in a posting list
 */
export interface PostingEntry {
  /**
   * Document ID
   */
  docId: string | number;

  /**
   * Term frequency in the document
   */
  frequency: number;

  /**
   * Optional list of positions where the term appears in the document
   */
  positions?: number[];

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
  serialize(): Buffer;

  /**
   * Deserialize a posting list from storage
   */
  deserialize(data: Buffer): void;
}

/**
 * Interface for term dictionary operations
 */
export interface TermDictionary {
  /**
   * Add a term to the dictionary
   */
  addTerm(term: string): Promise<PostingList>;

  /**
   * Get a posting list for a term
   */
  getPostingList(term: string): Promise<PostingList | undefined>;

  /**
   * Check if a term exists in the dictionary
   */
  hasTerm(term: string): boolean;

  /**
   * Remove a term from the dictionary
   */
  removeTerm(term: string): Promise<boolean>;

  /**
   * Get all terms in the dictionary
   */
  getTerms(): string[];

  /**
   * Get the number of terms in the dictionary
   */
  size(): number;

  /**
   * Add a document to a term's posting list
   */
  addPosting(term: string, entry: PostingEntry): Promise<void>;

  /**
   * Remove a document from a term's posting list
   */
  removePosting(term: string, docId: number | string): Promise<boolean>;

  /**
   * Serialize the dictionary for storage
   */
  serialize(): Buffer;

  /**
   * Deserialize a dictionary from storage
   */
  deserialize(data: Buffer | Record<string, any>): void;

  /**
   * Save the current state to disk
   */
  saveToDisk(): Promise<void>;
}
