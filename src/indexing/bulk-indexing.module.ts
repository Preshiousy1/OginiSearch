import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { BulkIndexingService } from './services/bulk-indexing.service';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { IndexModule } from '../index/index.module';
import { IndexingQueueProcessor } from './queue/indexing-queue.processor';
import { IndexingModule } from './indexing.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'bulk-indexing',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 10,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        attempts: 3,
      },
      settings: {
        maxStalledCount: 2,
        stalledInterval: 300000, // 5 minutes
        lockDuration: 600000, // 10 minutes
        drainDelay: 5,
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        username: process.env.REDIS_USERNAME || 'default',
        password: process.env.REDIS_PASSWORD || undefined,
        // Connection pool settings for high throughput
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: true,
        // Connection pool
        family: 0,
        keepAlive: 1,
      },
      limiter: {
        max: 1000, // Maximum number of jobs processed within duration
        duration: 5000, // Duration in milliseconds
        bounceBack: true, // Queue jobs that exceed the limit
      },
    }),
    forwardRef(() => DocumentModule),
    forwardRef(() => StorageModule),
    forwardRef(() => IndexModule),
    forwardRef(() => IndexingModule),
    ConfigModule,
  ],
  providers: [BulkIndexingService, IndexingQueueProcessor],
  exports: [BulkIndexingService],
})
export class BulkIndexingModule {}
