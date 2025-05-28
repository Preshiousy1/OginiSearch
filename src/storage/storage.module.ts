import { forwardRef, Module } from '@nestjs/common';
import { RocksDBService } from './rocksdb/rocksdb.service';
import { IndexStorageService } from './index-storage/index-storage.service';
import { MongoDBModule } from './mongodb/mongodb.module';
import { DocumentModule } from './mongodb/document.module';
import { DocumentStorageService } from './document-storage/document-storage.service';
import { SchemaModule } from '../schema/schema.module';
import { ConfigService } from '@nestjs/config';
import { IndexRepository } from './mongodb/repositories/index.repository';
import { MongooseModule } from '@nestjs/mongoose';
import { IndexMetadata, IndexMetadataSchema } from './mongodb/schemas/index.schema';
import { IndexRestorationService } from './index-storage/index-restoration.service';
import { IndexMigrationService } from './index-storage/index-migration.service';
import { PersistentTermDictionaryService } from './index-storage/persistent-term-dictionary.service';

@Module({
  imports: [
    MongoDBModule,
    DocumentModule,
    forwardRef(() => SchemaModule), // Prevent circular dependency
    MongooseModule.forFeature([{ name: IndexMetadata.name, schema: IndexMetadataSchema }]),
  ],
  controllers: [],
  providers: [
    RocksDBService,
    IndexStorageService,
    DocumentStorageService,
    ConfigService,
    IndexRepository,
    IndexRestorationService,
    IndexMigrationService,
    PersistentTermDictionaryService,
  ],
  exports: [
    RocksDBService,
    IndexStorageService,
    DocumentStorageService,
    IndexRepository,
    PersistentTermDictionaryService,
  ],
})
export class StorageModule {}
