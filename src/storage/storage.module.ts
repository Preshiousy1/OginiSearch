import { Module } from '@nestjs/common';
import { RocksDBService } from './rocksdb/rocksdb.service';
import { IndexStorageService } from './index-storage/index-storage.service';

@Module({
  imports: [],
  controllers: [],
  providers: [RocksDBService, IndexStorageService],
  exports: [RocksDBService, IndexStorageService],
})
export class StorageModule {}
