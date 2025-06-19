import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BulkIndexingService } from './services/bulk-indexing.service';
import { IndexingWorkerService } from './services/indexing-worker.service';
import { IndexingQueueProcessor } from './queue/indexing-queue.processor';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    IndexModule,
    StorageModule,
    forwardRef(() => DocumentModule),
    ConfigModule,
    BullModule.registerQueue({
      name: 'indexing',
    }),
  ],
  providers: [BulkIndexingService, IndexingWorkerService, IndexingQueueProcessor],
  exports: [BulkIndexingService],
})
export class BulkIndexingModule {}
