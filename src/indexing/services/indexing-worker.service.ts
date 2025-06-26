import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BulkIndexingService } from './bulk-indexing.service';
import { DocumentProcessorPool } from './document-processor.pool';
import {
  InjectQueue,
  Process,
  OnQueueCompleted,
  OnQueueFailed,
  OnGlobalQueueCompleted,
} from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';

@Injectable()
export class IndexingWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IndexingWorkerService.name);

  private workerMetrics = {
    processedDocuments: 0,
    totalProcessingTime: 0,
    failedDocuments: 0,
    lastProcessingSpeed: 0,
    averageProcessingSpeed: 0,
  };

  constructor(
    private readonly bulkIndexingService: BulkIndexingService,
    private readonly documentProcessorPool: DocumentProcessorPool,
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    @InjectQueue('indexing') private readonly indexingQueue: Queue,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Indexing worker service initialized');
  }

  async onModuleDestroy() {
    // Cleanup will be handled by NestJS
  }

  @Process('single')
  async processSingleDocument(job: Job<any>) {
    const { indexName, documentId, document } = job.data;
    this.logger.debug(`Processing single document ${documentId} for index ${indexName}`);

    try {
      // Process document using worker pool
      const processedDoc = await this.documentProcessorPool.processDocument(
        documentId,
        document.content,
        'standard',
      );

      // Store document
      await this.documentService.storeDocument(indexName, documentId, document);

      // Update term dictionary and postings
      await this.documentService.updateTermDictionary(indexName, processedDoc.terms);

      return { success: true, documentId };
    } catch (error) {
      this.logger.error(`Error processing document ${documentId}: ${error.message}`);
      throw error;
    }
  }

  @Process('batch')
  async processBatch(job: Job<any>) {
    const startTime = Date.now();
    const { indexName, documents, batchId } = job.data;
    this.logger.debug(`Processing batch ${batchId} with ${documents.length} documents`);

    const results = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
      metrics: {
        processingTimeMs: 0,
        docsPerSecond: 0,
      },
    };

    const CHUNK_SIZE = 100;
    const chunks = [];

    for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
      chunks.push(documents.slice(i, i + CHUNK_SIZE));
    }

    try {
      for (const chunk of chunks) {
        const chunkStartTime = Date.now();
        const chunkPromises = chunk.map(async doc => {
          try {
            const processedDoc = await this.documentProcessorPool.processDocument(
              doc.id,
              doc.document.content,
              'standard',
            );

            await this.documentService.storeDocument(indexName, doc.id, doc.document);
            await this.documentService.updateTermDictionary(indexName, processedDoc.terms);

            results.processed++;
            this.workerMetrics.processedDocuments++;
            return { success: true, documentId: doc.id };
          } catch (error) {
            results.failed++;
            this.workerMetrics.failedDocuments++;
            results.errors.push({
              documentId: doc.id,
              error: error.message,
              stack: error.stack,
            });
            this.logger.error(
              `Failed to process document ${doc.id} in batch ${batchId}: ${error.message}`,
              error.stack,
            );
            return { success: false, documentId: doc.id, error };
          }
        });

        await Promise.all(chunkPromises);
        const chunkEndTime = Date.now();
        const chunkProcessingTime = chunkEndTime - chunkStartTime;
        this.workerMetrics.totalProcessingTime += chunkProcessingTime;
      }

      const endTime = Date.now();
      const totalProcessingTime = endTime - startTime;
      const docsPerSecond = (results.processed / totalProcessingTime) * 1000;

      // Update worker metrics
      this.workerMetrics.lastProcessingSpeed = docsPerSecond;
      this.workerMetrics.averageProcessingSpeed =
        this.workerMetrics.processedDocuments / (this.workerMetrics.totalProcessingTime / 1000);

      // Add metrics to results
      results.metrics = {
        processingTimeMs: totalProcessingTime,
        docsPerSecond,
      };

      if (results.failed > 0) {
        results.success = false;
      }

      this.logger.log(
        `Completed batch ${batchId}: ${results.processed} processed, ${
          results.failed
        } failed, ${docsPerSecond.toFixed(2)} docs/sec`,
      );

      return results;
    } catch (error) {
      this.logger.error(`Error processing batch ${batchId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnQueueCompleted()
  async onJobCompleted(job: Job, result: any) {
    this.logger.debug(
      `Completed job ${job.id} of type ${job.name}. Processed: ${result.processed}, Failed: ${result.failed}`,
    );
  }

  @OnQueueFailed()
  async onJobFailed(job: Job, error: Error) {
    this.logger.error(`Failed job ${job.id} of type ${job.name}: ${error.message}`);
  }

  @OnGlobalQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(
      `Worker metrics - Processed: ${this.workerMetrics.processedDocuments}, ` +
        `Failed: ${this.workerMetrics.failedDocuments}, ` +
        `Avg Speed: ${this.workerMetrics.averageProcessingSpeed.toFixed(2)} docs/sec, ` +
        `Last Speed: ${this.workerMetrics.lastProcessingSpeed.toFixed(2)} docs/sec`,
    );
  }

  async getWorkerStatus() {
    return {
      status: 'running',
      queueHealth: await this.bulkIndexingService.getQueueHealth(),
      stats: await this.bulkIndexingService.getQueueStats(),
    };
  }
}
