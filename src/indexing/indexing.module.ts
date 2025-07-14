import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IndexingService } from './indexing.service';
import { IndexingWorkerService } from './services/indexing-worker.service';
import { DocumentProcessorPool } from './services/document-processor.pool';
import { DocumentModule } from '../document/document.module';
import { IndexModule } from '../index/index.module';
import { StorageModule } from '../storage/storage.module';
import { BulkIndexingModule } from './bulk-indexing.module';

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
    forwardRef(() => IndexModule),
    forwardRef(() => StorageModule),
    forwardRef(() => BulkIndexingModule),
  ],
  providers: [IndexingService, IndexingWorkerService, DocumentProcessorPool],
  exports: [IndexingService, IndexingWorkerService, DocumentProcessorPool],
})
export class IndexingModule {}
