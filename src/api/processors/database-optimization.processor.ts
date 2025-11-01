import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DatabaseOptimizationService } from '../services/database-optimization.service';

@Processor('database-optimization')
export class DatabaseOptimizationProcessor {
  private readonly logger = new Logger(DatabaseOptimizationProcessor.name);

  constructor(private readonly optimizationService: DatabaseOptimizationService) {}

  @Process('run-optimization')
  async handleOptimization(job: Job): Promise<any> {
    this.logger.log(`Processing database optimization job ${job.id}`);

    try {
      const result = await this.optimizationService.processOptimization(job);
      this.logger.log(`Database optimization completed: ${job.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Database optimization failed: ${job.id}`, error.stack);
      throw error;
    }
  }
}
