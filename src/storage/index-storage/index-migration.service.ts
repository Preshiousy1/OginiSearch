import { Injectable, Logger } from '@nestjs/common';
import { IndexRepository } from '../mongodb/repositories/index.repository';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { Index } from '../../index/interfaces/index.interface';

@Injectable()
export class IndexMigrationService {
  private readonly logger = new Logger(IndexMigrationService.name);

  constructor(
    private readonly indexRepository: IndexRepository,
    private readonly rocksDBService: RocksDBService,
  ) {}

  async migrateIndicesToMongoDB(): Promise<void> {
    this.logger.log('Starting migration of indices from RocksDB to MongoDB...');

    try {
      // Get all index keys from RocksDB
      const keys = await this.rocksDBService.getKeysWithPrefix('index:');

      if (keys.length === 0) {
        this.logger.log('No indices found in RocksDB to migrate');
        return;
      }

      let migratedCount = 0;
      let skippedCount = 0;

      for (const key of keys) {
        try {
          const data = await this.rocksDBService.get(key);
          if (!data) continue;

          const indexData = data as Index;
          if (!this.isValidIndex(indexData)) {
            this.logger.warn(`Skipping invalid index data for key ${key}`);
            continue;
          }

          // Check if already exists in MongoDB
          const existingIndex = await this.indexRepository.findByName(indexData.name);
          if (existingIndex) {
            this.logger.debug(`Index ${indexData.name} already exists in MongoDB, skipping`);
            skippedCount++;
            continue;
          }

          // Migrate to MongoDB
          await this.indexRepository.create(indexData);
          migratedCount++;
          this.logger.debug(`Migrated index: ${indexData.name}`);
        } catch (error) {
          this.logger.warn(`Failed to migrate index for key ${key}: ${error.message}`);
        }
      }

      this.logger.log(
        `Migration completed. Migrated: ${migratedCount}, Skipped: ${skippedCount} indices`,
      );
    } catch (error) {
      this.logger.error(`Error during index migration: ${error.message}`);
      throw error;
    }
  }

  private isValidIndex(data: unknown): data is Index {
    if (typeof data !== 'object' || data === null) return false;
    const index = data as Partial<Index>;
    return (
      typeof index.name === 'string' &&
      typeof index.createdAt === 'string' &&
      typeof index.settings === 'object' &&
      typeof index.mappings === 'object' &&
      typeof index.status === 'string'
    );
  }
}
