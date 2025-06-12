import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { SearchModule } from '../search/search.module';
import { MongoDBModule } from '../storage/mongodb/mongodb.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';

@Module({
  imports: [
    IndexModule,
    DocumentModule,
    SearchModule,
    MongoDBModule,
    StorageModule,
    IndexingModule,
  ],
  controllers: [IndexController, DocumentController, SearchController],
})
export class ApiModule {}
