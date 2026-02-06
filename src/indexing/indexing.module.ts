import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IndexingService } from './indexing.service';
import { BulkIndexingService } from './services/bulk-indexing.service';
import { IndexingWorkerService } from './services/indexing-worker.service';
import { DocumentProcessorPool } from './services/document-processor.pool';
import { BulkOperationTrackerService } from './services/bulk-operation-tracker.service';
import { BulkCompletionService } from './services/bulk-completion.service';
import { IndexingQueueProcessor } from './queue/indexing-queue.processor';
import { PersistenceQueueProcessor } from './queue/persistence-queue.processor';
import { DocumentModule } from '../document/document.module';
import { IndexModule } from '../index/index.module';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [
    // Register indexing queue (parallel processing)
    BullModule.registerQueueAsync({
      name: 'indexing',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          redis: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
          // Note: @Process decorator concurrency takes precedence, but set here for consistency
          settings: {
            maxStalledCount: 1,
            stalledInterval: 30000,
          },
        };
      },
      inject: [ConfigService],
    }),
    // Register term-persistence queue (sequential processing)
    BullModule.registerQueueAsync({
      name: 'term-persistence',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          redis: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
          },
          defaultJobOptions: {
            removeOnComplete: 50,
            removeOnFail: false, // Keep failed jobs for debugging
            attempts: 5, // More retries for persistence
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            priority: 10, // Higher priority than indexing jobs
          },
          settings: {
            maxStalledCount: 2,
            stalledInterval: 60000, // Longer stalled interval for persistence
          },
        };
      },
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    forwardRef(() => DocumentModule),
    IndexModule,
    StorageModule,
  ],
  providers: [
    IndexingService,
    BulkIndexingService,
    IndexingWorkerService,
    DocumentProcessorPool,
    BulkOperationTrackerService,
    BulkCompletionService,
    IndexingQueueProcessor, // Processor for 'indexing' queue (concurrency: 12)
    PersistenceQueueProcessor, // Processor for 'term-persistence' queue (concurrency: 1)
  ],
  exports: [
    IndexingService,
    BulkIndexingService,
    IndexingWorkerService,
    DocumentProcessorPool,
    BulkOperationTrackerService,
  ],
})
export class IndexingModule {}
