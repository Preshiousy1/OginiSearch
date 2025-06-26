import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IndexingService } from './indexing.service';
import { BulkIndexingService } from './services/bulk-indexing.service';
import { IndexingWorkerService } from './services/indexing-worker.service';
import { DocumentProcessorPool } from './services/document-processor.pool';
import { DocumentModule } from '../document/document.module';
import { IndexModule } from '../index/index.module';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: 'indexing',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => DocumentModule),
    IndexModule,
    StorageModule,
  ],
  providers: [IndexingService, BulkIndexingService, IndexingWorkerService, DocumentProcessorPool],
  exports: [IndexingService, BulkIndexingService, IndexingWorkerService],
})
export class IndexingModule {}
