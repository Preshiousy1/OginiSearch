import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { BulkIndexingService } from './services/bulk-indexing.service';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from './indexing.module';
// Note: DocumentProcessorPool is provided in IndexingModule

@Module({
  imports: [
    IndexModule,
    StorageModule,
    forwardRef(() => DocumentModule),
    forwardRef(() => IndexingModule), // Import IndexingModule to access IndexingService
    ConfigModule,
    // Register 'indexing' queue here so BulkIndexingService can inject it
    // Bull will reuse the same queue instance if registered elsewhere
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
            backoff: { type: 'exponential', delay: 2000 },
          },
          settings: { maxStalledCount: 1, stalledInterval: 30000 },
        };
      },
      inject: [ConfigService],
    }),
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
            removeOnFail: false,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            priority: 10,
          },
          settings: { maxStalledCount: 2, stalledInterval: 60000 },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    BulkIndexingService,
    // Note: IndexingQueueProcessor and DocumentProcessorPool are provided in IndexingModule
  ],
  exports: [BulkIndexingService],
})
export class BulkIndexingModule {}
