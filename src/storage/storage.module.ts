import { Module } from '@nestjs/common';
import { RocksDBService } from './rocksdb/rocksdb.service';
import { IndexStorageService } from './index-storage/index-storage.service';
import { MongoDBModule } from './mongodb/mongodb.module';
import { DocumentModule } from './mongodb/document.module';
import { DocumentStorageService } from './document-storage/document-storage.service';

@Module({
  imports: [MongoDBModule, DocumentModule],
  controllers: [],
  providers: [RocksDBService, IndexStorageService, DocumentStorageService],
  exports: [RocksDBService, IndexStorageService, DocumentStorageService],
})
export class StorageModule {}
