import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { BulkIndexingService } from './bulk-indexing.service';

@Injectable()
export class IndexingWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingWorkerService.name);

  constructor(private readonly bulkIndexingService: BulkIndexingService) {}

  async onApplicationBootstrap() {
    this.logger.log('Indexing worker service initialized');
    // Bull automatically handles workers, no need to manually start them
  }

  async getWorkerStatus() {
    return {
      status: 'running',
      queueHealth: await this.bulkIndexingService.getQueueHealth(),
      stats: await this.bulkIndexingService.getQueueStats(),
    };
  }
}
