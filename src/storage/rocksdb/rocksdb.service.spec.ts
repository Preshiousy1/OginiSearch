import { Test, TestingModule } from '@nestjs/testing';
import { RocksDBService } from './rocksdb.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

// Mock implementation for testing
jest.mock('rocksdb');
jest.mock('levelup');
jest.mock('encoding-down');

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
      createReadStream: jest.fn().mockReturnValue({
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'data') {
            // Mock some data
            callback({
              key: 'test:key1',
              value: Buffer.from(JSON.stringify({ test: 'data1' })),
            });
            callback({
              key: 'test:key2',
              value: Buffer.from(JSON.stringify({ test: 'data2' })),
            });
          }
          if (event === 'end') {
            callback();
          }
          return { on: jest.fn() };
        }),
      }),
    };

    // Mock the connect method to use our mockDb
    jest.spyOn(RocksDBService.prototype as any, 'connect').mockImplementation(function () {
      this.db = mockDb;
    });

    // Mock directory creation
    jest
      .spyOn(RocksDBService.prototype as any, 'ensureDbDirectoryExists')
      .mockImplementation(() => Promise.resolve());

    const module: TestingModule = await Test.createTestingModule({
      providers: [RocksDBService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<RocksDBService>(RocksDBService);
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
      mockDb.get.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockValue)));

      const result = await service.get('test-key');

      expect(mockDb.get).toHaveBeenCalledWith('test-key');
      expect(result).toEqual(mockValue);
    });

    it('should return null when key does not exist', async () => {
      const error = new Error('Not found');
      error['notFound'] = true;
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

      expect(mockDb.put).toHaveBeenCalledWith('test-key', expect.any(Buffer));

      // Verify serialization
      const serializedData = Buffer.from(JSON.stringify(testData));
      expect(mockDb.put.mock.calls[0][1].toString()).toEqual(serializedData.toString());
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
      const result = await service.getByPrefix('test:');

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('test:key1');
      expect(result[0].value).toEqual({ test: 'data1' });
      expect(result[1].key).toBe('test:key2');
      expect(result[1].value).toEqual({ test: 'data2' });
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
