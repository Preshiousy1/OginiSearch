import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { BulkIndexingService } from '../../indexing/services/bulk-indexing.service';
import { BulkIndexingOptions } from '../../indexing/interfaces/bulk-indexing.interface';

class QueueSingleDocumentDto {
  indexName: string;
  documentId: string;
  document: any;
  options?: Partial<BulkIndexingOptions>;
}

class QueueBatchDocumentsDto {
  indexName: string;
  documents: Array<{ id: string; document: any }>;
  options?: BulkIndexingOptions;
}

class BulkIndexingProgressDto {
  processed: number;
  total: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  documentsPerSecond: number;
  estimatedTimeRemaining: number;
  errors: number;
  skipped: number;
}

class QueueStatsDto {
  singleJobs: number;
  batchJobs: number;
  failedSingleJobs: number;
  failedBatchJobs: number;
}

@ApiTags('Bulk Indexing')
@Controller('bulk-indexing')
export class BulkIndexingController {
  private readonly logger = new Logger(BulkIndexingController.name);

  constructor(private readonly bulkIndexingService: BulkIndexingService) {}

  @Post('queue/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a batch of documents for indexing' })
  @ApiBody({ type: QueueBatchDocumentsDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Batch queued successfully',
    schema: {
      type: 'object',
      properties: {
        batchId: { type: 'string', nullable: true },
        message: { type: 'string' },
        totalDocuments: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid request data' })
  async queueBatchDocuments(@Body() dto: QueueBatchDocumentsDto) {
    if (!dto.indexName || !dto.documents || !Array.isArray(dto.documents)) {
      throw new BadRequestException('indexName and documents array are required');
    }

    if (dto.documents.length === 0) {
      throw new BadRequestException('Documents array cannot be empty');
    }

    // Validate document structure
    for (const doc of dto.documents) {
      if (!doc.id || !doc.document) {
        throw new BadRequestException('Each document must have id and document properties');
      }
    }

    try {
      const { batchId } = await this.bulkIndexingService.queueBulkIndexing(
        dto.indexName,
        dto.documents,
        dto.options || {},
      );

      if (!batchId) {
        return {
          batchId: null,
          message: 'No documents to process (all duplicates)',
          totalDocuments: 0,
        };
      }

      return {
        batchId,
        message: 'Batch queued successfully',
        totalDocuments: dto.documents.length,
      };
    } catch (error) {
      this.logger.error(`Failed to queue batch: ${error.message}`);
      throw new BadRequestException(`Failed to queue batch: ${error.message}`);
    }
  }

  @Get('progress/:batchId')
  @ApiOperation({ summary: 'Get job status for a batch' })
  @ApiParam({ name: 'batchId', description: 'Batch ID to check status for', type: 'string' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Job status information',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Batch not found' })
  async getProgress(@Param('batchId') batchId: string) {
    if (!batchId) {
      throw new BadRequestException('Batch ID is required');
    }

    try {
      // For now, return a simplified status - in a full implementation
      // you could store job metadata in Redis or database
      return {
        batchId,
        status: 'processing',
        message: 'Use /bulk-indexing/stats for detailed queue information',
      };
    } catch (error) {
      this.logger.error(`Failed to get status for batch ${batchId}: ${error.message}`);
      throw new BadRequestException(`Failed to get status: ${error.message}`);
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get queue statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue statistics',
    type: QueueStatsDto,
  })
  async getQueueStats(): Promise<QueueStatsDto> {
    try {
      // Get detailed queue information
      const stats = await this.bulkIndexingService.getQueueStats();

      // Get the actual Bull queue to inspect job types
      const queueStats = await this.bulkIndexingService.getDetailedQueueStats();

      this.logger.debug(`Stats endpoint - Basic stats: ${JSON.stringify(stats)}`);
      this.logger.debug(`Stats endpoint - Detailed stats: ${JSON.stringify(queueStats)}`);

      return {
        singleJobs: queueStats.singleJobs || 0,
        batchJobs: queueStats.batchJobs || 0,
        failedSingleJobs: queueStats.failedSingleJobs || 0,
        failedBatchJobs: queueStats.failedBatchJobs || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get queue stats: ${error.message}`);
      throw new BadRequestException(`Failed to get queue stats: ${error.message}`);
    }
  }

  @Post('workers/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume indexing queue' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue resumed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async startWorkers() {
    try {
      await this.bulkIndexingService.resumeQueue();
      return {
        message: 'Indexing queue resumed successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to resume queue: ${error.message}`);
      throw new BadRequestException(`Failed to resume queue: ${error.message}`);
    }
  }

  @Get('health')
  @ApiOperation({ summary: 'Check bulk indexing service health' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service health information',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        queues: { type: 'object' },
        timestamp: { type: 'string' },
      },
    },
  })
  async getHealth() {
    try {
      const health = await this.bulkIndexingService.getQueueHealth();
      const stats = health.queues;

      // Get detailed stats to properly categorize job types
      const detailedStats = await this.bulkIndexingService.getDetailedQueueStats();

      this.logger.debug(`Health endpoint - Basic stats: ${JSON.stringify(stats)}`);
      this.logger.debug(`Health endpoint - Detailed stats: ${JSON.stringify(detailedStats)}`);

      return {
        status: health.status,
        queues: {
          singleJobs: detailedStats.singleJobs || 0,
          batchJobs: detailedStats.batchJobs || 0,
          failedSingleJobs: detailedStats.failedSingleJobs || 0,
          failedBatchJobs: detailedStats.failedBatchJobs || 0,
          totalActive: detailedStats.singleJobs + detailedStats.batchJobs,
          totalFailed: detailedStats.failedSingleJobs + detailedStats.failedBatchJobs,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('queue/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause the indexing queue' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue paused successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async pauseQueue() {
    try {
      await this.bulkIndexingService.pauseQueue();
      return {
        message: 'Indexing queue paused successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to pause queue: ${error.message}`);
      throw new BadRequestException(`Failed to pause queue: ${error.message}`);
    }
  }

  @Post('queue/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume the indexing queue' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue resumed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async resumeQueue() {
    try {
      await this.bulkIndexingService.resumeQueue();
      return {
        message: 'Indexing queue resumed successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to resume queue: ${error.message}`);
      throw new BadRequestException(`Failed to resume queue: ${error.message}`);
    }
  }

  @Post('queue/clean')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clean completed and failed jobs from queue' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue cleaned successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async cleanQueue() {
    try {
      await this.bulkIndexingService.cleanQueue();
      return {
        message: 'Queue cleaned successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to clean queue: ${error.message}`);
      throw new BadRequestException(`Failed to clean queue: ${error.message}`);
    }
  }

  @Get('failed-jobs')
  @ApiOperation({ summary: 'Get failed jobs with error details' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of failed jobs with error details',
    schema: {
      type: 'object',
      properties: {
        failedJobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              failedReason: { type: 'string' },
              attemptsMade: { type: 'number' },
              data: { type: 'object' },
              timestamp: { type: 'string' },
            },
          },
        },
        total: { type: 'number' },
      },
    },
  })
  async getFailedJobs() {
    try {
      const failedJobs = await this.bulkIndexingService.getFailedJobs();
      return {
        failedJobs: failedJobs.map(job => ({
          id: job.id,
          type: job.name,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          data: job.data,
          timestamp: job.finishedOn,
        })),
        total: failedJobs.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get failed jobs: ${error.message}`);
      throw new BadRequestException(`Failed to get failed jobs: ${error.message}`);
    }
  }
}
