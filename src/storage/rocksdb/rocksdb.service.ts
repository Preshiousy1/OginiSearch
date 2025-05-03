import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import encodingDown from 'encoding-down';
// const encodingDown = require('encoding-down');

@Injectable()
export class RocksDBService implements OnModuleInit, OnModuleDestroy {
  private db: any;
  private readonly logger = new Logger(RocksDBService.name);
  private readonly dbPath: string;
  private isAvailable = false;
  private rocksdb: any;
  private levelup: any;
  private encodingDown: any;

  constructor(private configService: ConfigService) {
    this.dbPath =
      this.configService.get<string>('ROCKSDB_PATH') || path.join(process.cwd(), 'data', 'rocksdb');

    try {
      // Use import() for dynamic imports instead of require()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.rocksdb = require('rocksdb');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.levelup = require('levelup');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.encodingDown = require('encoding-down');
      this.isAvailable = true;
    } catch (error) {
      this.logger.warn(`RocksDB dependencies not available: ${error.message}`);
      this.isAvailable = false;
    }
  }

  async onModuleInit() {
    await this.ensureDbDirectoryExists();
    await this.connect();
  }

  async onModuleDestroy() {
    await this.close();
  }

  private async ensureDbDirectoryExists() {
    const mkdirAsync = promisify(fs.mkdir);
    try {
      await mkdirAsync(this.dbPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        this.logger.error(`Failed to create RocksDB directory: ${error.message}`);
        throw error;
      }
    }
  }

  private async connect() {
    try {
      const db = this.levelup(
        this.encodingDown(this.rocksdb(this.dbPath), { valueEncoding: 'binary' }),
      );
      this.db = db;
      this.logger.log('Connected to RocksDB successfully');
    } catch (error) {
      this.logger.error(`Failed to connect to RocksDB: ${error.message}`);
      throw error;
    }
  }

  async close() {
    if (this.db) {
      try {
        await this.db.close();
        this.logger.log('RocksDB connection closed');
      } catch (error) {
        this.logger.error(`Error closing RocksDB connection: ${error.message}`);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.db.get(key);
      return this.deserialize<T>(data);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Error getting key ${key}: ${error.message}`);
      throw error;
    }
  }

  async put(key: string, value: any): Promise<void> {
    try {
      const serialized = this.serialize(value);
      await this.db.put(key, serialized);
    } catch (error) {
      this.logger.error(`Error putting key ${key}: ${error.message}`);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.db.del(key);
    } catch (error) {
      this.logger.error(`Error deleting key ${key}: ${error.message}`);
      throw error;
    }
  }

  async getMany<T>(keys: string[]): Promise<Array<T | null>> {
    const promises = keys.map(key => this.get<T>(key));
    return Promise.all(promises);
  }

  async putMany(entries: Array<{ key: string; value: any }>): Promise<void> {
    const batch = this.db.batch();

    for (const { key, value } of entries) {
      const serialized = this.serialize(value);
      batch.put(key, serialized);
    }

    await batch.write();
  }

  async getByPrefix<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const result: Array<{ key: string; value: T }> = [];

    return new Promise((resolve, reject) => {
      const stream = this.db.createReadStream({
        gte: prefix,
        lt: prefix + '\uffff', // End of Unicode range to match all keys with the prefix
      });

      stream.on('data', data => {
        result.push({
          key: data.key.toString(),
          value: this.deserialize<T>(data.value),
        });
      });

      stream.on('error', error => {
        reject(error);
      });

      stream.on('end', () => {
        resolve(result);
      });
    });
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

  private serialize(data: any): Buffer {
    return Buffer.from(JSON.stringify(data));
  }

  private deserialize<T>(buffer: Buffer): T {
    return JSON.parse(buffer.toString());
  }
}
