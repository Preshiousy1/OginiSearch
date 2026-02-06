import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
import { BulkIndexingController } from './controllers/bulk-indexing.controller';
import { WorkerManagementController } from './controllers/worker-management.controller';
import { WorkerManagementService } from './services/worker-management.service';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { SearchModule } from '../search/search.module';
import { MongoDBModule } from '../storage/mongodb/mongodb.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { BulkIndexingModule } from '../indexing/bulk-indexing.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    IndexModule,
    DocumentModule,
    SearchModule,
    MongoDBModule,
    StorageModule,
    IndexingModule, // Registers 'indexing' queue (processor lives here)
    BulkIndexingModule, // Registers 'indexing' queue (Bull reuses same instance)
    // Register both queues here so WorkerManagementService can inject them in ApiModule context
    BullModule.registerQueue({ name: 'indexing' }, { name: 'bulk-indexing' }),
  ],
  controllers: [
    IndexController,
    DocumentController,
    SearchController,
    BulkIndexingController,
    WorkerManagementController,
  ],
  providers: [WorkerManagementService],
})
export class ApiModule {}
