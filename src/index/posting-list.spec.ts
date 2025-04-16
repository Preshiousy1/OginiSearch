import { SimplePostingList } from './posting-list';
import { PostingEntry } from './interfaces/posting.interface';

describe('SimplePostingList', () => {
  let postingList: SimplePostingList;

  beforeEach(() => {
    postingList = new SimplePostingList();
  });

  it('should be defined', () => {
    expect(postingList).toBeDefined();
  });

  it('should add entries correctly', () => {
    const entry: PostingEntry = { docId: 1, frequency: 5 };
    postingList.addEntry(entry);

    expect(postingList.size()).toBe(1);
    expect(postingList.getEntry(1)).toEqual(entry);
  });

  it('should remove entries correctly', () => {
    const entry1: PostingEntry = { docId: 1, frequency: 5 };
    const entry2: PostingEntry = { docId: 2, frequency: 3 };

    postingList.addEntry(entry1);
    postingList.addEntry(entry2);

    expect(postingList.size()).toBe(2);

    const removed = postingList.removeEntry(1);
    expect(removed).toBe(true);
    expect(postingList.size()).toBe(1);
    expect(postingList.getEntry(1)).toBeUndefined();
    expect(postingList.getEntry(2)).toEqual(entry2);
  });

  it('should return all entries', () => {
    const entry1: PostingEntry = { docId: 1, frequency: 5 };
    const entry2: PostingEntry = { docId: 2, frequency: 3 };

    postingList.addEntry(entry1);
    postingList.addEntry(entry2);

    const entries = postingList.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(entry1);
    expect(entries).toContainEqual(entry2);
  });

  it('should update frequencies correctly', () => {
    const entry: PostingEntry = { docId: 1, frequency: 5 };
    postingList.addEntry(entry);

    postingList.updateFrequency(1, 3);
    expect(postingList.getEntry(1).frequency).toBe(8);

    postingList.updateFrequency(1, -8);
    expect(postingList.getEntry(1)).toBeUndefined();
    expect(postingList.size()).toBe(0);
  });

  it('should add positions correctly', () => {
    const entry: PostingEntry = { docId: 1, frequency: 5 };
    postingList.addEntry(entry);

    postingList.addPosition(1, 10);
    postingList.addPosition(1, 20);

    const updatedEntry = postingList.getEntry(1);
    expect(updatedEntry.positions).toEqual([10, 20]);
  });

  it('should serialize and deserialize correctly', () => {
    const entry1: PostingEntry = { docId: 1, frequency: 5, positions: [1, 4, 10] };
    const entry2: PostingEntry = { docId: 2, frequency: 3, positions: [2, 8] };

    postingList.addEntry(entry1);
    postingList.addEntry(entry2);

    const serialized = postingList.serialize();

    const newPostingList = new SimplePostingList();
    newPostingList.deserialize(serialized);

    expect(newPostingList.size()).toBe(2);
    expect(newPostingList.getEntry(1)).toEqual(entry1);
    expect(newPostingList.getEntry(2)).toEqual(entry2);
  });

  it('should merge posting lists correctly', () => {
    const list1 = new SimplePostingList();
    list1.addEntry({ docId: 1, frequency: 5 });
    list1.addEntry({ docId: 2, frequency: 3 });

    const list2 = new SimplePostingList();
    list2.addEntry({ docId: 2, frequency: 2 });
    list2.addEntry({ docId: 3, frequency: 4 });

    list1.merge(list2);

    expect(list1.size()).toBe(3);
    expect(list1.getEntry(1).frequency).toBe(5);
    expect(list1.getEntry(2).frequency).toBe(5); // 3 + 2
    expect(list1.getEntry(3).frequency).toBe(4);
  });
});
