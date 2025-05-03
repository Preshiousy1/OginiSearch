import { Test, TestingModule } from '@nestjs/testing';
import { IndexStorageService } from './index-storage.service';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { SerializationUtils } from '../rocksdb/serialization.utils';
import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';

describe('IndexStorageService', () => {
  let service: IndexStorageService;
  let rocksDBService: RocksDBService;

  beforeEach(async () => {
    const mockRocksDBService = {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      getByPrefix: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [IndexStorageService, { provide: RocksDBService, useValue: mockRocksDBService }],
    }).compile();

    service = module.get<IndexStorageService>(IndexStorageService);
    rocksDBService = module.get<RocksDBService>(RocksDBService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('storeTermPostings', () => {
    it('should store serialized postings with the correct key', async () => {
      const indexName = 'test-index';
      const term = 'test-term';
      const postings = new Map([
        ['doc1', [1, 5, 10]],
        ['doc2', [3, 8]],
      ]);

      // Create spy on serialization method
      const serializeSpy = jest.spyOn(SerializationUtils, 'serializePostingList');
      serializeSpy.mockReturnValue(Buffer.from('mocked-serialized-data'));

      await service.storeTermPostings(indexName, term, postings);

      const expectedKey = SerializationUtils.createTermKey(indexName, term);
      expect(rocksDBService.put).toHaveBeenCalledWith(expectedKey, expect.any(Buffer));
      expect(serializeSpy).toHaveBeenCalledWith(postings);
    });
  });

  describe('getTermPostings', () => {
    it('should return null if term not found', async () => {
      (rocksDBService.get as jest.Mock).mockResolvedValue(null);

      const result = await service.getTermPostings('test-index', 'non-existent');

      expect(result).toBeNull();
      expect(rocksDBService.get).toHaveBeenCalledWith(
        expect.stringContaining('term:test-index:non-existent'),
      );
    });

    it('should deserialize and return postings if found', async () => {
      const mockBuffer = Buffer.from('test-buffer');
      (rocksDBService.get as jest.Mock).mockResolvedValue(mockBuffer);

      const mockPostings = new Map([['doc1', [1, 2, 3]]]);
      const deserializeSpy = jest.spyOn(SerializationUtils, 'deserializePostingList');
      deserializeSpy.mockReturnValue(mockPostings);

      const result = await service.getTermPostings('test-index', 'existing-term');

      expect(result).toBe(mockPostings);
      expect(deserializeSpy).toHaveBeenCalledWith(mockBuffer);
    });
  });

  describe('storeProcessedDocument', () => {
    it('should store serialized document with the correct key', async () => {
      const indexName = 'test-index';
      const document: ProcessedDocument = {
        id: 'doc123',
        fields: {
          title: {
            original: 'test',
            terms: ['test'],
            termFrequencies: { test: 1 },
            length: 1,
          },
        },
        source: {
          title: 'test',
        },
        fieldLengths: { title: 1, content: 2 },
      };
      const serializeSpy = jest.spyOn(SerializationUtils, 'serializeDocument');
      serializeSpy.mockReturnValue(Buffer.from('mocked-document-data'));

      await service.storeProcessedDocument(indexName, document);

      const expectedKey = SerializationUtils.createDocumentKey(indexName, document.id);
      expect(rocksDBService.put).toHaveBeenCalledWith(expectedKey, expect.any(Buffer));
      expect(serializeSpy).toHaveBeenCalledWith(document);
    });
  });

  describe('deleteIndex', () => {
    it('should delete all index-related keys', async () => {
      const indexName = 'test-index';

      // Mock keys to be returned from getByPrefix
      (rocksDBService.getByPrefix as jest.Mock).mockImplementation(prefix => {
        if (prefix === 'idx:test-index:') {
          return Promise.resolve([
            { key: 'idx:test-index:term:1', value: {} },
            { key: 'idx:test-index:term:2', value: {} },
          ]);
        }
        if (prefix === 'term:test-index:') {
          return Promise.resolve([{ key: 'term:test-index:word1', value: {} }]);
        }
        if (prefix === 'doc:test-index:') {
          return Promise.resolve([
            { key: 'doc:test-index:doc1', value: {} },
            { key: 'doc:test-index:doc2', value: {} },
          ]);
        }
        if (prefix === 'stats:test-index:') {
          return Promise.resolve([{ key: 'stats:test-index:docCount', value: {} }]);
        }
        return Promise.resolve([]);
      });

      await service.deleteIndex(indexName);

      // Should have deleted 7 keys in total (6 from prefixes + 1 metadata key)
      expect(rocksDBService.delete).toHaveBeenCalledTimes(7);

      // Verify it tried to get keys with the right prefixes
      expect(rocksDBService.getByPrefix).toHaveBeenCalledWith('idx:test-index:');
      expect(rocksDBService.getByPrefix).toHaveBeenCalledWith('term:test-index:');
      expect(rocksDBService.getByPrefix).toHaveBeenCalledWith('doc:test-index:');
      expect(rocksDBService.getByPrefix).toHaveBeenCalledWith('stats:test-index:');
    });
  });
});
