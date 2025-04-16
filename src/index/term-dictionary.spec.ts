import { InMemoryTermDictionary } from './term-dictionary';
import { PostingEntry } from './interfaces/posting.interface';

describe('InMemoryTermDictionary', () => {
  let dictionary: InMemoryTermDictionary;

  beforeEach(() => {
    dictionary = new InMemoryTermDictionary();
  });

  it('should be defined', () => {
    expect(dictionary).toBeDefined();
  });

  it('should add terms correctly', () => {
    dictionary.addTerm('hello');
    expect(dictionary.hasTerm('hello')).toBe(true);
    expect(dictionary.size()).toBe(1);
  });

  it('should add postings correctly', () => {
    const entry: PostingEntry = { docId: 1, frequency: 5 };
    dictionary.addPosting('hello', entry);

    expect(dictionary.hasTerm('hello')).toBe(true);

    const postingList = dictionary.getPostingList('hello');
    expect(postingList.size()).toBe(1);
    expect(postingList.getEntry(1)).toEqual(entry);
  });

  it('should remove terms correctly', () => {
    dictionary.addTerm('hello');
    dictionary.addTerm('world');

    expect(dictionary.size()).toBe(2);

    const removed = dictionary.removeTerm('hello');
    expect(removed).toBe(true);
    expect(dictionary.size()).toBe(1);
    expect(dictionary.hasTerm('hello')).toBe(false);
    expect(dictionary.hasTerm('world')).toBe(true);
  });

  it('should remove postings correctly', () => {
    dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    dictionary.addPosting('hello', { docId: 2, frequency: 3 });

    expect(dictionary.hasTerm('hello')).toBe(true);
    expect(dictionary.getPostingList('hello').size()).toBe(2);

    const removed = dictionary.removePosting('hello', 1);
    expect(removed).toBe(true);
    expect(dictionary.getPostingList('hello').size()).toBe(1);

    // Removing the last posting for a term should remove the term
    dictionary.removePosting('hello', 2);
    expect(dictionary.hasTerm('hello')).toBe(false);
  });

  it('should return all terms', () => {
    dictionary.addTerm('hello');
    dictionary.addTerm('world');

    const terms = dictionary.getTerms();
    expect(terms).toHaveLength(2);
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('should return term statistics correctly', () => {
    dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    dictionary.addPosting('hello', { docId: 2, frequency: 3 });

    const stats = dictionary.getTermStats('hello');
    expect(stats).toEqual({
      term: 'hello',
      docFreq: 2,
    });

    expect(dictionary.getTermStats('nonexistent')).toBeUndefined();
  });

  it('should get multiple posting lists efficiently', () => {
    dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    dictionary.addPosting('world', { docId: 2, frequency: 3 });

    const postingLists = dictionary.getPostingLists(['hello', 'world', 'nonexistent']);

    expect(postingLists.size).toBe(2);
    expect(postingLists.has('hello')).toBe(true);
    expect(postingLists.has('world')).toBe(true);
    expect(postingLists.has('nonexistent')).toBe(false);
  });

  it('should serialize and deserialize correctly', () => {
    dictionary.addPosting('hello', { docId: 1, frequency: 5, positions: [1, 4, 10] });
    dictionary.addPosting('world', { docId: 2, frequency: 3, positions: [2, 8] });

    const serialized = dictionary.serialize();

    const newDictionary = new InMemoryTermDictionary();
    newDictionary.deserialize(serialized);

    expect(newDictionary.size()).toBe(2);
    expect(newDictionary.hasTerm('hello')).toBe(true);
    expect(newDictionary.hasTerm('world')).toBe(true);

    const helloPostingList = newDictionary.getPostingList('hello');
    expect(helloPostingList.size()).toBe(1);
    expect(helloPostingList.getEntry(1).frequency).toBe(5);
    expect(helloPostingList.getEntry(1).positions).toEqual([1, 4, 10]);
  });
});
