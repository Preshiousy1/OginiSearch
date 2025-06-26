import { PostingList, PostingEntry } from './posting.interface';

export interface TermDictionary {
  getPostingList(term: string): Promise<PostingList | undefined>;
  addTerm(term: string): Promise<PostingList>;
  removeTerm(term: string): Promise<boolean>;
  clear(): Promise<void>;
  hasTerm(term: string): boolean;
  getTerms(): string[];
  size(): number;
  addPosting(term: string, entry: PostingEntry): Promise<void>;
  removePosting(term: string, docId: number | string): Promise<boolean>;
  serialize(): Buffer;
  deserialize(data: Buffer | Record<string, any>): void;
  saveToDisk(): Promise<void>;
}
