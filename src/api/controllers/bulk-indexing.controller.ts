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
import {
  BulkIndexingService,
  BulkIndexingOptions,
} from '../../indexing/services/bulk-indexing.service';

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

  @Post('queue/single')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a single document for indexing' })
  @ApiBody({ type: QueueSingleDocumentDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Document queued successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', nullable: true },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid request data' })
  async queueSingleDocument(@Body() dto: QueueSingleDocumentDto) {
    if (!dto.indexName || !dto.documentId || !dto.document) {
      throw new BadRequestException('indexName, documentId, and document are required');
    }

    try {
      const jobId = await this.bulkIndexingService.queueSingleDocument(
        dto.indexName,
        dto.documentId,
        dto.document,
        dto.options || {},
      );

      if (!jobId) {
        return {
          jobId: null,
          message: 'Document was skipped (likely duplicate)',
        };
      }

      return {
        jobId,
        message: 'Document queued successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to queue single document: ${error.message}`);
      throw new BadRequestException(`Failed to queue document: ${error.message}`);
    }
  }

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
      const { batchId, status } = await this.bulkIndexingService.queueBulkIndexing(
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

  @Delete('progress/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear job records for a batch' })
  @ApiParam({ name: 'batchId', description: 'Batch ID to clear records for', type: 'string' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Records cleared successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid batch ID' })
  async clearProgress(@Param('batchId') batchId: string): Promise<void> {
    if (!batchId) {
      throw new BadRequestException('Batch ID is required');
    }

    try {
      // Simplified - could clean specific job records in a full implementation
      await this.bulkIndexingService.cleanQueue();
    } catch (error) {
      this.logger.error(`Failed to clear records for batch ${batchId}: ${error.message}`);
      throw new BadRequestException(`Failed to clear records: ${error.message}`);
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
      const stats = health.stats;

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

  @Post('queue/drain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completely drain the queue',
    description:
      'Pauses the queue, removes ALL jobs (including active), then resumes. Use when you need to clear everything including jobs currently being processed.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue drained successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async drainQueue() {
    try {
      await this.bulkIndexingService.drainQueue();
      return {
        message: 'Queue drained successfully (all jobs removed including active)',
      };
    } catch (error) {
      this.logger.error(`Failed to drain queue: ${error.message}`);
      throw new BadRequestException(`Failed to drain queue: ${error.message}`);
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

  // ----- Persistence queue (term-persistence) status -----

  @Get('persistence/stats')
  @ApiOperation({ summary: 'Get term-persistence queue statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Persistence queue counts (waiting, active, completed, failed, delayed)',
    schema: {
      type: 'object',
      properties: {
        waiting: { type: 'number' },
        active: { type: 'number' },
        completed: { type: 'number' },
        failed: { type: 'number' },
        delayed: { type: 'number' },
      },
    },
  })
  async getPersistenceQueueStats() {
    try {
      return await this.bulkIndexingService.getPersistenceQueueStats();
    } catch (error) {
      this.logger.error(`Failed to get persistence queue stats: ${error.message}`);
      throw new BadRequestException(`Failed to get persistence queue stats: ${error.message}`);
    }
  }

  @Get('persistence/failed-jobs')
  @ApiOperation({ summary: 'Get failed jobs from the term-persistence queue' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of failed persistence jobs with error details',
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
              timestamp: { type: 'number' },
            },
          },
        },
        total: { type: 'number' },
      },
    },
  })
  async getPersistenceFailedJobs() {
    try {
      const failedJobs = await this.bulkIndexingService.getPersistenceFailedJobs();
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
      this.logger.error(`Failed to get persistence failed jobs: ${error.message}`);
      throw new BadRequestException(`Failed to get persistence failed jobs: ${error.message}`);
    }
  }

  @Post('persistence/queue/drain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completely drain the term-persistence queue',
    description:
      'Pauses the term-persistence queue, removes ALL jobs (including active), then resumes. Use when you need to clear all persistence jobs (e.g. before a clean re-index).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Persistence queue drained successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  async drainPersistenceQueue() {
    try {
      await this.bulkIndexingService.drainPersistenceQueue();
      return {
        message: 'Persistence queue drained successfully (all jobs removed including active)',
      };
    } catch (error) {
      this.logger.error(`Failed to drain persistence queue: ${error.message}`);
      throw new BadRequestException(`Failed to drain persistence queue: ${error.message}`);
    }
  }

  @Post('persistence/drain-stale-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Drain stale pending persistence refs from MongoDB',
    description:
      'Pops all refs from persistence_pending_jobs: processes refs that have a payload (merges terms), ' +
      'skips and removes refs with no payload (stale from old runs). Use to clean the collection without waiting for recovery.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Drain completed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        processed: { type: 'number', description: 'Batches processed (terms merged to MongoDB)' },
        skipped: { type: 'number', description: 'Stale refs removed (no payload)' },
      },
    },
  })
  async drainStalePendingRefs() {
    try {
      const { processed, skipped } = await this.bulkIndexingService.drainStalePendingRefs();
      return {
        message: 'Stale pending refs drained',
        processed,
        skipped,
      };
    } catch (error) {
      this.logger.error(`Failed to drain stale pending refs: ${error.message}`);
      throw new BadRequestException(`Failed to drain stale pending refs: ${error.message}`);
    }
  }

  @Get('persistence/verify/:bulkOpId')
  @ApiOperation({
    summary: 'Verify all batches have persistence jobs enqueued (by bulkOpId)',
    description:
      'Checks that every batch in a bulk operation has a corresponding persistence job enqueued. ' +
      'Returns missing batch IDs if any batches are missing persistence jobs.',
  })
  @ApiParam({ name: 'bulkOpId', description: 'Bulk operation ID to verify' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification result',
    schema: {
      type: 'object',
      properties: {
        allEnqueued: { type: 'boolean', description: 'True if all batches have persistence jobs' },
        missingBatches: {
          type: 'array',
          items: { type: 'string' },
          description: 'Batch IDs missing persistence jobs',
        },
        enqueuedCount: { type: 'number', description: 'Number of batches with persistence jobs' },
        totalBatches: { type: 'number', description: 'Total batches in operation' },
        completedIndexingBatches: {
          type: 'number',
          description: 'Number of batches that completed indexing',
        },
        persistedBatches: {
          type: 'number',
          description: 'Number of batches that completed persistence',
        },
      },
    },
  })
  async verifyPersistenceJobs(@Param('bulkOpId') bulkOpId: string) {
    try {
      const result = await this.bulkIndexingService.verifyPersistenceJobs(bulkOpId);
      if (!result.allEnqueued && result.missingBatches.length > 0) {
        const missingCount = result.missingBatches.length;
        this.logger.warn(
          `Bulk operation ${bulkOpId}: ${missingCount} batches missing persistence jobs: ${result.missingBatches.join(
            ', ',
          )}`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(`Failed to verify persistence jobs: ${error.message}`);
      throw new BadRequestException(`Failed to verify persistence jobs: ${error.message}`);
    }
  }

  @Get('persistence/verify-index/:indexName')
  @ApiOperation({
    summary: 'Verify all batches have persistence jobs enqueued (by indexName)',
    description:
      'Checks ALL bulk operations for an index and verifies that every batch has a persistence job enqueued. ' +
      'Returns aggregated results showing total batches, missing batches, and per-operation details. ' +
      'Use this to verify completeness after bulk indexing completes.',
  })
  @ApiParam({ name: 'indexName', description: 'Index name to verify' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Aggregated verification result for all operations',
    schema: {
      type: 'object',
      properties: {
        indexName: { type: 'string' },
        totalOperations: { type: 'number', description: 'Number of bulk operations found' },
        totalBatches: { type: 'number', description: 'Total batches across all operations' },
        totalBatchesWithPersistenceJobs: {
          type: 'number',
          description: 'Total batches that have persistence jobs enqueued',
        },
        totalBatchesIndexed: {
          type: 'number',
          description: 'Total batches that completed indexing',
        },
        totalBatchesPersisted: {
          type: 'number',
          description: 'Total batches that completed persistence',
        },
        missingBatches: {
          type: 'array',
          items: { type: 'string' },
          description: 'All batch IDs missing persistence jobs (across all operations)',
        },
        operations: {
          type: 'array',
          description: 'Per-operation verification details',
          items: {
            type: 'object',
            properties: {
              bulkOpId: { type: 'string' },
              status: { type: 'string' },
              totalBatches: { type: 'number' },
              enqueuedCount: { type: 'number' },
              completedIndexing: { type: 'number' },
              persisted: { type: 'number' },
              missingBatches: { type: 'array', items: { type: 'string' } },
              allEnqueued: { type: 'boolean' },
            },
          },
        },
      },
    },
  })
  async verifyPersistenceJobsByIndex(@Param('indexName') indexName: string) {
    try {
      const result = await this.bulkIndexingService.verifyPersistenceJobsByIndex(indexName);
      if (result.missingBatches.length > 0) {
        this.logger.warn(
          `Index ${indexName}: ${result.missingBatches.length} batches missing persistence jobs across ${result.totalOperations} operations. ` +
            `Expected ${result.totalBatches} persistence jobs, got ${result.totalBatchesWithPersistenceJobs}.`,
        );
      } else if (result.totalBatches > 0) {
        this.logger.log(
          `✅ Index ${indexName}: All ${result.totalBatches} batches have persistence jobs enqueued (${result.totalOperations} operations)`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(`Failed to verify persistence jobs for index: ${error.message}`);
      throw new BadRequestException(`Failed to verify persistence jobs: ${error.message}`);
    }
  }

  @Post('persistence/recover/:indexName')
  @ApiOperation({
    summary: 'Recover missing persistence jobs for an index',
    description:
      'Queries MongoDB for persistence payloads. Any payload that exists was indexed but not yet persisted. ' +
      'Re-enqueues those batches for persistence. Use when verify shows completedIndexing > persisted.',
  })
  @ApiParam({
    name: 'indexName',
    description: 'Index name to recover missing persistence jobs for',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Recovery results',
    schema: {
      type: 'object',
      properties: {
        indexName: { type: 'string' },
        payloadsFound: { type: 'number', description: 'Persistence payloads found in MongoDB' },
        batchesRecovered: { type: 'number', description: 'Batches re-enqueued for persistence' },
        batchesUnrecoverable: {
          type: 'number',
          description: 'Payloads that could not be recovered (invalid format or error)',
        },
        recoveredBatches: {
          type: 'array',
          description: 'List of batches that were recovered',
          items: {
            type: 'object',
            properties: {
              bulkOpId: { type: 'string' },
              batchId: { type: 'string' },
              payloadKey: { type: 'string' },
            },
          },
        },
        unrecoverableBatches: {
          type: 'array',
          description: 'Batches that could not be recovered (invalid format or error)',
          items: {
            type: 'object',
            properties: {
              bulkOpId: { type: 'string' },
              batchId: { type: 'string' },
              payloadKey: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
        documentCount: {
          type: 'number',
          description: 'Current document count in the index (for reference)',
        },
        totalOperations: { type: 'number', description: 'Operations from verify/tracker' },
        batchesChecked: { type: 'number', description: 'Total batchIds checked across operations' },
        diagnostic: {
          type: 'object',
          description: 'Present when payloadsFound=0; helps debug why recovery found nothing',
          properties: {
            totalPayloadsInCollection: { type: 'number' },
            sampleKeys: { type: 'array', items: { type: 'string' } },
            persistPayloadPrefix: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
  })
  async recoverMissingPersistenceJobs(@Param('indexName') indexName: string) {
    try {
      this.logger.log(`Starting recovery of missing persistence jobs for index: ${indexName}`);
      const result = await this.bulkIndexingService.recoverMissingPersistenceJobs(indexName);
      if (result.batchesRecovered > 0) {
        this.logger.log(
          `✅ Successfully recovered ${result.batchesRecovered} persistence jobs for index ${indexName}`,
        );
      }
      if (result.batchesUnrecoverable > 0) {
        this.logger.warn(
          `⚠️ ${result.batchesUnrecoverable} batches could not be recovered for index ${indexName}. ` +
            `These batches may need to be re-indexed.`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(`Failed to recover missing persistence jobs: ${error.message}`);
      throw new BadRequestException(`Failed to recover missing persistence jobs: ${error.message}`);
    }
  }
}
