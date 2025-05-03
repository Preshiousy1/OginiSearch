import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RocksDBService } from '../../src/storage/rocksdb/rocksdb.service';

// Mock implementation of RocksDBService for testing
export class MockRocksDBService {
  private static storage = new Map<string, Buffer>();

  async open(): Promise<void> {
    // No-op for testing
  }

  async close(): Promise<void> {
    MockRocksDBService.storage.clear();
  }

  async put(key: string, value: Buffer): Promise<void> {
    MockRocksDBService.storage.set(key, value);
  }

  async get(key: string): Promise<Buffer | null> {
    return MockRocksDBService.storage.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    MockRocksDBService.storage.delete(key);
  }

  async getByPrefix(prefix: string): Promise<Array<{ key: string; value: Buffer }>> {
    const results: Array<{ key: string; value: Buffer }> = [];

    for (const [key, value] of MockRocksDBService.storage.entries()) {
      if (key.startsWith(prefix)) {
        results.push({ key, value });
      }
    }

    return results;
  }

  async getKeysWithPrefix(prefix: string): Promise<string[]> {
    return Array.from(MockRocksDBService.storage.keys()).filter(key => key.startsWith(prefix));
  }
}

const singletonMockRocksDBService = new MockRocksDBService();

@Module({
  imports: [
    // Configure MongoDB with in-memory server
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI,
      }),
    }),
  ],
  providers: [
    // Provide mock RocksDBService
    {
      provide: RocksDBService,
      useValue: singletonMockRocksDBService,
    },
  ],
  exports: [MongooseModule, RocksDBService],
})
export class TestDatabaseModule {}
