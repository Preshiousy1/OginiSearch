import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
import { BulkIndexingController } from './controllers/bulk-indexing.controller';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { SearchModule } from '../search/search.module';
import { MongoDBModule } from '../storage/mongodb/mongodb.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { BulkIndexingModule } from '../indexing/bulk-indexing.module';

@Module({
  imports: [
    IndexModule,
    DocumentModule,
    SearchModule,
    MongoDBModule,
    StorageModule,
    IndexingModule,
    BulkIndexingModule,
  ],
  controllers: [IndexController, DocumentController, SearchController, BulkIndexingController],
})
export class ApiModule {}
