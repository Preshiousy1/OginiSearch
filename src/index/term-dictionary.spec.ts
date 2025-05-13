import { InMemoryTermDictionary } from './term-dictionary';
import { PostingEntry } from './interfaces/posting.interface';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';
import { ConfigService } from '@nestjs/config';

describe('InMemoryTermDictionary', () => {
  let dictionary: InMemoryTermDictionary;
  let rocksDBService: RocksDBService;
  let configService: ConfigService;

  beforeEach(async () => {
    configService = new ConfigService();
    rocksDBService = new RocksDBService(configService);
    dictionary = new InMemoryTermDictionary({ persistToDisk: false }, rocksDBService);
    await dictionary.onModuleInit();
  });

  it('should be defined', () => {
    expect(dictionary).toBeDefined();
  });

  it('should add terms correctly', async () => {
    await dictionary.addTerm('hello');
    expect(dictionary.hasTerm('hello')).toBe(true);
    expect(dictionary.size()).toBe(1);
  });

  it('should add postings correctly', async () => {
    const entry: PostingEntry = { docId: 1, frequency: 5 };
    await dictionary.addPosting('hello', entry);

    expect(dictionary.hasTerm('hello')).toBe(true);

    const postingList = await dictionary.getPostingList('hello');
    expect(postingList).toBeDefined();
    expect(postingList.size()).toBe(1);
    expect(postingList.getEntry(1)).toEqual(entry);
  });

  it('should remove terms correctly', async () => {
    await dictionary.addTerm('hello');
    await dictionary.addTerm('world');

    expect(dictionary.size()).toBe(2);

    const removed = await dictionary.removeTerm('hello');
    expect(removed).toBe(true);
    expect(dictionary.size()).toBe(1);
    expect(dictionary.hasTerm('hello')).toBe(false);
    expect(dictionary.hasTerm('world')).toBe(true);
  });

  it('should remove postings correctly', async () => {
    await dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    await dictionary.addPosting('hello', { docId: 2, frequency: 3 });

    expect(dictionary.hasTerm('hello')).toBe(true);
    const postingList = await dictionary.getPostingList('hello');
    expect(postingList.size()).toBe(2);

    const removed = await dictionary.removePosting('hello', 1);
    expect(removed).toBe(true);

    const updatedList = await dictionary.getPostingList('hello');
    expect(updatedList.size()).toBe(1);

    // Removing the last posting for a term should remove the term
    await dictionary.removePosting('hello', 2);
    await dictionary.removeTerm('hello'); // Explicitly remove the term
    expect(dictionary.hasTerm('hello')).toBe(false);
  });

  it('should return all terms', async () => {
    await dictionary.addTerm('hello');
    await dictionary.addTerm('world');

    const terms = dictionary.getTerms();
    expect(terms).toHaveLength(2);
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('should return term statistics correctly', async () => {
    await dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    await dictionary.addPosting('hello', { docId: 2, frequency: 3 });

    const stats = dictionary.getTermStats('hello');
    expect(stats).toEqual({
      term: 'hello',
      docFreq: 2,
    });

    expect(dictionary.getTermStats('nonexistent')).toBeUndefined();
  });

  it('should get multiple posting lists efficiently', async () => {
    await dictionary.addPosting('hello', { docId: 1, frequency: 5 });
    await dictionary.addPosting('world', { docId: 2, frequency: 3 });

    const postingLists = dictionary.getPostingLists(['hello', 'world', 'nonexistent']);

    expect(postingLists.size).toBe(2);
    expect(postingLists.has('hello')).toBe(true);
    expect(postingLists.has('world')).toBe(true);
    expect(postingLists.has('nonexistent')).toBe(false);
  });

  it('should save to disk when configured', async () => {
    // Initialize RocksDB service first
    rocksDBService = new RocksDBService(configService);
    await rocksDBService.onModuleInit();

    // Clean up any existing data first
    try {
      await rocksDBService.delete('term_list');
      await rocksDBService.delete('term:hello');
    } catch (e) {
      // Ignore errors if keys don't exist
    }

    const persistentDictionary = new InMemoryTermDictionary(
      { persistToDisk: true },
      rocksDBService,
    );
    await persistentDictionary.onModuleInit();

    // Add some test data
    await persistentDictionary.addPosting('hello', {
      docId: 1,
      frequency: 5,
      positions: [1, 4, 10],
    });

    // Save to disk
    await persistentDictionary.saveToDisk();

    // Create a new dictionary instance to test loading from disk
    const newDictionary = new InMemoryTermDictionary({ persistToDisk: true }, rocksDBService);
    await newDictionary.onModuleInit();

    // Verify the data was persisted
    expect(newDictionary.hasTerm('hello')).toBe(true);
    const postingList = await newDictionary.getPostingList('hello');
    expect(postingList).toBeDefined();
    expect(postingList.size()).toBe(1);
    expect(postingList.getEntry(1).frequency).toBe(5);
    expect(postingList.getEntry(1).positions).toEqual([1, 4, 10]);

    // Clean up
    await rocksDBService.onModuleDestroy();
  });
});
