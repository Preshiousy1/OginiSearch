import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
// import { StreamingSearchController } from './controllers/streaming-search.controller';
import { BulkIndexingController } from './controllers/bulk-indexing.controller';
import { WorkerManagementController } from './controllers/worker-management.controller';
import { IntelligentSearchController } from './controllers/intelligent-search.controller';
import { WorkerManagementService } from './services/worker-management.service';
import { MetricsController } from './controllers/metrics.controller';
import { DebugController } from './controllers/debug.controller';
import { DatabaseOptimizationService } from './services/database-optimization.service';
import { DatabaseOptimizationProcessor } from './processors/database-optimization.processor';

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
    BullModule.registerQueue({
      name: 'database-optimization',
    }),
  ],
  controllers: [
    IndexController,
    DocumentController,
    SearchController,
    // StreamingSearchController,
    BulkIndexingController,
    WorkerManagementController,
    IntelligentSearchController,
    MetricsController,
    DebugController,
  ],
  providers: [WorkerManagementService, DatabaseOptimizationService, DatabaseOptimizationProcessor],
})
export class ApiModule {}
