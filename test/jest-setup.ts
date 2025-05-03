import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from 'dotenv';
import * as path from 'path';

// Mock RocksDB dependencies
jest.mock('rocksdb', () => {
  return {
    RocksDB: jest.fn().mockImplementation(() => ({
      open: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(Buffer.from('{"test":"data"}')),
      del: jest.fn().mockResolvedValue(undefined),
      createReadStream: jest.fn().mockReturnValue({
        on: jest.fn().mockImplementation(function (event, callback) {
          if (event === 'data') {
            callback({ key: 'test-key', value: Buffer.from('{"test":"data"}') });
          }
          if (event === 'end') {
            callback();
          }
          return this;
        }),
      }),
    })),
  };
});

jest.mock('levelup', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('encoding-down', () => {
  return jest.fn().mockImplementation(() => ({}));
});

let mongod: MongoMemoryServer;

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '../.env.test'),
});

// Setup hook
beforeAll(async () => {
  // Start MongoDB memory server if needed
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
});

// Teardown hook
afterAll(async () => {
  if (mongod) {
    await mongod.stop();
  }
});
