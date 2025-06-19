import { OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';

@Injectable()
export abstract class BaseProcessor {
  protected readonly logger = new Logger(this.constructor.name);

  @OnQueueFailed()
  async onQueueFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} of type ${job.name} failed: ${error.message}`, error.stack);
  }

  @OnQueueCompleted()
  async onQueueCompleted(job: Job, result: any) {
    this.logger.debug(`Job ${job.id} of type ${job.name} completed successfully`);
  }
}
