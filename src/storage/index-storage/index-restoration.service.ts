import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IndexRepository } from '../mongodb/repositories/index.repository';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { SerializationUtils } from '../rocksdb/serialization.utils';
import { Index } from '../../index/interfaces/index.interface';
import { PersistentTermDictionaryService } from './persistent-term-dictionary.service';

@Injectable()
export class IndexRestorationService implements OnModuleInit {
  private readonly logger = new Logger(IndexRestorationService.name);

  constructor(
    private readonly indexRepository: IndexRepository,
    private readonly rocksDBService: RocksDBService,
    private readonly persistentTermDictionaryService: PersistentTermDictionaryService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting comprehensive index restoration (metadata + term postings)...');

    try {
      // Step 1: Migrate any RocksDB-only indices to MongoDB (one-time migration)
      await this.migrateRocksDBIndicesToMongoDB();

      // Step 2: Restore MongoDB indices to RocksDB (for performance)
      await this.restoreMongoDBIndicesToRocksDB();

      // Step 3: Restore term postings for all indices
      await this.restoreAllTermPostings();
    } catch (error) {
      this.logger.error(`Error during comprehensive index restoration: ${error.message}`);
      // Don't throw - let the application start even if restoration fails
    }
  }

  private async migrateRocksDBIndicesToMongoDB(): Promise<void> {
    try {
      const rocksDBKeys = await this.rocksDBService.getKeysWithPrefix('index:');

      if (rocksDBKeys.length === 0) {
        this.logger.debug('No indices found in RocksDB to migrate');
        return;
      }

      let migratedCount = 0;
      let skippedCount = 0;

      for (const key of rocksDBKeys) {
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
            skippedCount++;
            continue;
          }

          // Migrate to MongoDB
          await this.indexRepository.create(indexData);
          migratedCount++;
          this.logger.debug(`Migrated index from RocksDB to MongoDB: ${indexData.name}`);

          // Also migrate term postings for this index
          await this.persistentTermDictionaryService.migrateTermPostings(indexData.name);
        } catch (error) {
          this.logger.warn(`Failed to migrate index for key ${key}: ${error.message}`);
        }
      }

      if (migratedCount > 0) {
        this.logger.log(
          `Migration completed. Migrated: ${migratedCount}, Skipped: ${skippedCount} indices from RocksDB to MongoDB`,
        );
      }
    } catch (error) {
      this.logger.warn(`Error during RocksDB to MongoDB migration: ${error.message}`);
    }
  }

  private async restoreMongoDBIndicesToRocksDB(): Promise<void> {
    try {
      const mongoIndices = await this.indexRepository.findAll();

      if (mongoIndices.length === 0) {
        this.logger.debug('No indices found in MongoDB to restore');
        return;
      }

      let restoredCount = 0;
      for (const mongoIndex of mongoIndices) {
        try {
          const indexData = mongoIndex.toObject();
          const key = SerializationUtils.createIndexMetadataKey(indexData.name);

          // Check if already exists in RocksDB
          const existingData = await this.rocksDBService.get(key);
          if (!existingData) {
            await this.rocksDBService.put(key, indexData);
            restoredCount++;
            this.logger.debug(`Restored index from MongoDB to RocksDB: ${indexData.name}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to restore index ${mongoIndex.name}: ${error.message}`);
        }
      }

      if (restoredCount > 0) {
        this.logger.log(
          `Index metadata restoration completed. Restored ${restoredCount} indices from MongoDB to RocksDB`,
        );
      }
    } catch (error) {
      this.logger.warn(`Error during MongoDB to RocksDB restoration: ${error.message}`);
    }
  }

  private async restoreAllTermPostings(): Promise<void> {
    try {
      this.logger.log('Starting term postings restoration...');

      const mongoIndices = await this.indexRepository.findAll();

      if (mongoIndices.length === 0) {
        this.logger.debug('No indices found for term postings restoration');
        return;
      }

      let totalRestoredTerms = 0;

      for (const mongoIndex of mongoIndices) {
        try {
          const restoredTerms = await this.persistentTermDictionaryService.restoreTermPostings(
            mongoIndex.name,
          );
          totalRestoredTerms += restoredTerms;
        } catch (error) {
          this.logger.warn(
            `Failed to restore term postings for index ${mongoIndex.name}: ${error.message}`,
          );
        }
      }

      if (totalRestoredTerms > 0) {
        this.logger.log(
          `Term postings restoration completed. Restored ${totalRestoredTerms} term postings across all indices`,
        );
      } else {
        this.logger.debug('No term postings needed restoration');
      }
    } catch (error) {
      this.logger.warn(`Error during term postings restoration: ${error.message}`);
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
