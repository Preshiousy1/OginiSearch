import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { ClassicLevel } from 'classic-level';
import { AbstractBatchOperation } from 'abstract-level';

@Injectable()
export class RocksDBService implements OnModuleInit, OnModuleDestroy {
  private db: ClassicLevel<string, string>;
  private readonly logger = new Logger(RocksDBService.name);
  private readonly dbPath: string;
  private isAvailable = false;

  constructor(private configService: ConfigService) {
    // Check if we're running in Docker (environment variable set in Dockerfile)
    const isDocker = this.configService.get<string>('DOCKER') === 'true';

    // Use Docker path if in Docker, otherwise use local path
    this.dbPath =
      this.configService.get<string>('ROCKSDB_PATH') ||
      (isDocker ? '/usr/src/app/data/rocksdb' : path.join(process.cwd(), 'data', 'rocksdb'));
  }

  async onModuleInit() {
    this.logger.log(`Initializing RocksDB with path: ${this.dbPath}`);

    try {
      // Ensure the directory exists
      await fs.promises.mkdir(path.dirname(this.dbPath), { recursive: true });
      this.logger.log(`Created RocksDB directory at: ${this.dbPath}`);

      // Initialize the database
      await this.connect();
    } catch (error) {
      this.logger.error(`Failed to initialize RocksDB: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.db) {
      try {
        await this.db.close();
        this.isAvailable = false;
        this.logger.log('RocksDB connection closed');
      } catch (error) {
        this.logger.error(`Error closing RocksDB: ${error.message}`);
        throw error;
      }
    }
  }

  private async connect() {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Close any existing connection
        if (this.db) {
          try {
            await this.db.close();
          } catch (e) {
            // Ignore close errors
          }
        }

        // Try to remove the lock file
        const lockFile = path.join(this.dbPath, 'LOCK');
        try {
          await fs.promises.unlink(lockFile);
        } catch (e) {
          // Ignore if lock file doesn't exist
        }

        this.db = new ClassicLevel(this.dbPath, {
          keyEncoding: 'utf8',
          valueEncoding: 'utf8',
        });
        await this.db.open();
        this.isAvailable = true;
        this.logger.log('Connected to RocksDB successfully');
        return;
      } catch (error) {
        if (error.code === 'LEVEL_DATABASE_NOT_OPEN' && error.cause?.code === 'LEVEL_CORRUPTION') {
          this.logger.warn('Database corruption detected, recreating database...');
          await fs.promises.rm(this.dbPath, { recursive: true, force: true });
          await fs.promises.mkdir(this.dbPath, { recursive: true });
          continue;
        }

        if (attempt === maxRetries) {
          this.logger.error(
            `Failed to connect to RocksDB after ${maxRetries} attempts: ${error.message}`,
          );
          throw error;
        }

        this.logger.warn(`Connection attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async put(key: string, value: any): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    const serialized = JSON.stringify(value);
    await this.db.put(key, serialized);
  }

  async get(key: string): Promise<any> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    try {
      const value = await this.db.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    await this.db.del(key);
  }

  async batch(
    operations: Array<AbstractBatchOperation<ClassicLevel<string, string>, string, string>>,
  ): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    const serializedOps = operations.map(op => {
      if (op.type === 'put') {
        return {
          ...op,
          value: JSON.stringify(op.value),
        };
      }
      return op;
    });
    await this.db.batch(serializedOps);
  }

  async clear(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    await this.db.clear();
  }

  async getMany(keys: string[]): Promise<any[]> {
    if (!this.isAvailable) {
      throw new Error('RocksDB is not available');
    }
    return Promise.all(keys.map(key => this.get(key)));
  }

  async getByPrefix(prefix: string): Promise<Array<{ key: string; value: any }>> {
    const result: Array<{ key: string; value: any }> = [];

    for await (const [key, value] of this.db.iterator({
      gte: prefix,
      lt: prefix + '\uffff', // End of Unicode range to match all keys with the prefix
    })) {
      result.push({
        key: key.toString(),
        value,
      });
    }

    return result;
  }

  async getKeysWithPrefix(prefix: string): Promise<string[]> {
    const keyValues = await this.getByPrefix(prefix);
    return keyValues.map(kv => kv.key);
  }

  // Helper methods for key formatting
  formatIndexKey(indexName: string, type: string, id: string): string {
    return `idx:${indexName}:${type}:${id}`;
  }

  formatTermKey(indexName: string, term: string): string {
    return `term:${indexName}:${term}`;
  }

  formatStatsKey(indexName: string, statName: string): string {
    return `stats:${indexName}:${statName}`;
  }

  private serialize(value: any): Buffer {
    try {
      // Handle special types like Date, Map, Set
      const serialized = JSON.stringify(value, (key, value) => {
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        if (value instanceof Map) {
          return { __type: 'Map', value: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      });
      return Buffer.from(serialized);
    } catch (error) {
      this.logger.error(`Serialization error: ${error.message}`);
      throw new Error(`Failed to serialize value: ${error.message}`);
    }
  }

  private deserializeBuffer(data: any): any {
    try {
      // If null or undefined, return as is
      if (!data) {
        return data;
      }

      // Convert Buffer or Buffer-like to string
      let strData: string;
      if (Buffer.isBuffer(data)) {
        strData = data.toString('utf8');
      } else if (data.type === 'Buffer' && Array.isArray(data.data)) {
        strData = Buffer.from(data.data).toString('utf8');
      } else if (typeof data === 'string') {
        strData = data;
      } else {
        throw new Error('Invalid data format');
      }

      // Parse JSON with reviver for special types
      return JSON.parse(strData, (key, value) => {
        if (value && typeof value === 'object') {
          if (value.__type === 'Date') {
            return new Date(value.value);
          }
          if (value.__type === 'Map') {
            return new Map(value.value);
          }
          if (value.__type === 'Set') {
            return new Set(value.value);
          }
        }
        return value;
      });
    } catch (error) {
      this.logger.error(`Deserialization error: ${error.message}`);
      throw new Error(`Failed to deserialize data: ${error.message}`);
    }
  }

  private toBuffer(value: Buffer | string | object): Buffer {
    try {
      if (Buffer.isBuffer(value)) {
        return value;
      } else if (typeof value === 'string') {
        return Buffer.from(value);
      } else {
        return this.serialize(value);
      }
    } catch (error) {
      this.logger.error(`Buffer conversion error: ${error.message}`);
      throw new Error(`Failed to convert to buffer: ${error.message}`);
    }
  }
}
