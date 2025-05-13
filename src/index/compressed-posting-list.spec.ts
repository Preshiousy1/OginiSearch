import { CompressedPostingList } from './compressed-posting-list';

describe('CompressedPostingList', () => {
  let postingList: CompressedPostingList;

  beforeEach(() => {
    postingList = new CompressedPostingList();
  });

  it('should be defined', () => {
    expect(postingList).toBeDefined();
  });

  describe('basic functionality', () => {
    it('should add entries correctly', () => {
      postingList.addEntry({ docId: 1, frequency: 5 });
      postingList.addEntry({ docId: 2, frequency: 3, positions: [1, 4, 7] });

      expect(postingList.size()).toBe(2);
      expect(postingList.getEntry(1)).toEqual({ docId: 1, frequency: 5 });
      expect(postingList.getEntry(2).positions).toEqual([1, 4, 7]);
    });

    it('should ignore invalid entries', () => {
      postingList.addEntry(null);
      postingList.addEntry({ docId: null, frequency: 0 });
      postingList.addEntry({ docId: 1, frequency: -1 });

      expect(postingList.size()).toBe(0);
    });

    it('should remove entries correctly', () => {
      postingList.addEntry({ docId: 1, frequency: 5 });
      postingList.addEntry({ docId: 2, frequency: 3 });

      expect(postingList.size()).toBe(2);

      const removed = postingList.removeEntry(1);
      expect(removed).toBe(true);
      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1)).toBeUndefined();
      expect(postingList.getEntry(2)).toBeDefined();
    });

    it('should get all entries correctly', () => {
      postingList.addEntry({ docId: 1, frequency: 5 });
      postingList.addEntry({ docId: 2, frequency: 3 });

      const entries = postingList.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].docId).toBe(1);
      expect(entries[1].docId).toBe(2);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      // Add test data
      postingList.addEntry({ docId: 1, frequency: 5, positions: [1, 4, 10] });
      postingList.addEntry({ docId: 2, frequency: 3, positions: [2, 6] });

      // Serialize
      const buffer = postingList.serialize();
      expect(buffer).toBeInstanceOf(Buffer);

      // Create a new list and deserialize
      const newList = new CompressedPostingList();
      newList.deserialize(buffer);

      // Check if data was preserved
      expect(newList.size()).toBe(2);
      expect(newList.getEntry(1).frequency).toBe(5);
      expect(newList.getEntry(1).positions).toEqual([1, 4, 10]);
      expect(newList.getEntry(2).frequency).toBe(3);
      expect(newList.getEntry(2).positions).toEqual([2, 6]);
    });
  });

  describe('multiple data formats', () => {
    const testEntry = { d: 1, f: 5, p: [1, 4, 10], m: {} };
    const testData = { entries: [testEntry], version: 1 };

    it('should handle Buffer data', () => {
      const buffer = Buffer.from(JSON.stringify(testData));
      postingList.deserialize(buffer);

      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1).frequency).toBe(5);
      expect(postingList.getEntry(1).positions).toEqual([1, 4, 10]);
    });

    it('should handle Buffer-like object', () => {
      // Create a Buffer-like object
      const bufferData = Buffer.from(JSON.stringify(testData));
      const bufferLike = {
        type: 'Buffer',
        data: Array.from(bufferData),
      };

      postingList.deserialize(bufferLike);

      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1).frequency).toBe(5);
      expect(postingList.getEntry(1).positions).toEqual([1, 4, 10]);
    });

    it('should handle string data', () => {
      const jsonString = JSON.stringify(testData);
      postingList.deserialize(jsonString);

      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1).frequency).toBe(5);
      expect(postingList.getEntry(1).positions).toEqual([1, 4, 10]);
    });

    it('should handle JavaScript object directly', () => {
      postingList.deserialize(testData);

      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1).frequency).toBe(5);
      expect(postingList.getEntry(1).positions).toEqual([1, 4, 10]);
    });

    it('should clear entries before deserializing', () => {
      // Add some initial entries
      postingList.addEntry({ docId: 3, frequency: 7 });
      postingList.addEntry({ docId: 4, frequency: 2 });
      expect(postingList.size()).toBe(2);

      // Deserialize new data
      postingList.deserialize(testData);

      // Should have only the new data
      expect(postingList.size()).toBe(1);
      expect(postingList.getEntry(1)).toBeDefined();
      expect(postingList.getEntry(3)).toBeUndefined();
      expect(postingList.getEntry(4)).toBeUndefined();
    });

    it('should handle invalid data gracefully', () => {
      // Add an entry first
      postingList.addEntry({ docId: 1, frequency: 5 });
      expect(postingList.size()).toBe(1);

      // Try to deserialize invalid data
      postingList.deserialize('{"not": "valid json"');

      // Should keep the list empty but not throw
      expect(postingList.size()).toBe(0);
    });
  });
});
