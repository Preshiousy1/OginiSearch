import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
// import { StreamingSearchController } from './controllers/streaming-search.controller';
import { BulkIndexingController } from './controllers/bulk-indexing.controller';
import { WorkerManagementController } from './controllers/worker-management.controller';
import { WorkerManagementService } from './services/worker-management.service';
import { MetricsController } from './controllers/metrics.controller';

import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { SearchModule } from '../search/search.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { BulkIndexingModule } from '../indexing/bulk-indexing.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    IndexModule,
    DocumentModule,
    SearchModule,
    StorageModule,
    IndexingModule,
    BulkIndexingModule,
    BullModule.registerQueue({
      name: 'indexing',
    }),
    BullModule.registerQueue({
      name: 'bulk-indexing',
    }),
  ],
  controllers: [
    IndexController,
    DocumentController,
    SearchController,
    // StreamingSearchController,
    BulkIndexingController,
    WorkerManagementController,
    MetricsController,
  ],
  providers: [WorkerManagementService],
})
export class ApiModule {}
