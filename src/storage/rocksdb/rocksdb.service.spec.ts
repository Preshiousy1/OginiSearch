import { Test, TestingModule } from '@nestjs/testing';
import { RocksDBService } from './rocksdb.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

// Mock implementation for testing
jest.mock('classic-level');

describe('RocksDBService', () => {
  let service: RocksDBService;
  let mockDb: any;

  const mockConfigService = {
    get: jest.fn().mockImplementation(key => {
      if (key === 'ROCKSDB_PATH') {
        return path.join(process.cwd(), 'test-data', 'rocksdb');
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    mockDb = {
      get: jest.fn(),
      put: jest.fn(),
      del: jest.fn(),
      close: jest.fn(),
      batch: jest.fn().mockReturnValue({
        put: jest.fn(),
        write: jest.fn().mockResolvedValue(undefined),
      }),
      iterator: jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const mockData = [['test:key1', JSON.stringify({ test: 'data1' })]];
          let index = 0;

          return {
            next: async () => {
              if (index < mockData.length) {
                return { done: false, value: mockData[index++] };
              }
              return { done: true, value: undefined };
            },
          };
        },
      }),
      open: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };

    // Mock ClassicLevel constructor
    const ClassicLevelMock = jest.requireMock('classic-level').ClassicLevel;
    ClassicLevelMock.mockImplementation(() => mockDb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [RocksDBService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<RocksDBService>(RocksDBService);

    // Mock directory creation/checks
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return deserialized value when key exists', async () => {
      const mockValue = { test: 'value' };
      mockDb.get.mockResolvedValueOnce(JSON.stringify(mockValue));

      const result = await service.get('test-key');

      expect(mockDb.get).toHaveBeenCalledWith('test-key');
      expect(result).toEqual(mockValue);
    });

    it('should return null when key does not exist', async () => {
      const error: any = new Error('Not found');
      error.code = 'LEVEL_NOT_FOUND';
      mockDb.get.mockRejectedValueOnce(error);

      const result = await service.get('non-existent-key');

      expect(result).toBeNull();
    });

    it('should throw error for other errors', async () => {
      const error = new Error('Database error');
      mockDb.get.mockRejectedValueOnce(error);

      await expect(service.get('test-key')).rejects.toThrow('Database error');
    });
  });

  describe('put', () => {
    it('should serialize and store the value', async () => {
      const testData = { test: 'value' };

      await service.put('test-key', testData);

      expect(mockDb.put).toHaveBeenCalledWith('test-key', JSON.stringify(testData));
    });

    it('should handle different data types properly', async () => {
      // String value
      await service.put('string-key', 'string-value');
      expect(mockDb.put).toHaveBeenCalledWith('string-key', '"string-value"');

      // Number value
      await service.put('number-key', 123);
      expect(mockDb.put).toHaveBeenCalledWith('number-key', '123');

      // Buffer-like object
      const bufferLike = { type: 'Buffer', data: [1, 2, 3] };
      await service.put('buffer-key', bufferLike);
      expect(mockDb.put).toHaveBeenCalledWith('buffer-key', JSON.stringify(bufferLike));
    });
  });

  describe('delete', () => {
    it('should delete the key', async () => {
      await service.delete('test-key');

      expect(mockDb.del).toHaveBeenCalledWith('test-key');
    });
  });

  describe('getByPrefix', () => {
    it('should return all keys with the given prefix', async () => {
      // Mock implementation of getByPrefix to parse the JSON
      jest.spyOn(service as any, 'getByPrefix').mockImplementation(async prefix => {
        return [
          {
            key: 'test:key1',
            value: { test: 'data1' },
          },
        ];
      });

      const result = await service.getByPrefix('test:');

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('test:key1');
      expect(result[0].value).toEqual({ test: 'data1' });
    });
  });

  describe('key formatting', () => {
    it('should format index keys correctly', () => {
      const key = service.formatIndexKey('products', 'term', '123');
      expect(key).toBe('idx:products:term:123');
    });

    it('should format term keys correctly', () => {
      const key = service.formatTermKey('products', 'smartphone');
      expect(key).toBe('term:products:smartphone');
    });

    it('should format stats keys correctly', () => {
      const key = service.formatStatsKey('products', 'docCount');
      expect(key).toBe('stats:products:docCount');
    });
  });
});
