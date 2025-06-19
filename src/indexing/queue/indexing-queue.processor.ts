import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';
import { ConfigService } from '@nestjs/config';
import { SingleIndexingJob, BatchIndexingJob } from '../services/bulk-indexing.service';

@Injectable()
@Processor('indexing')
export class IndexingQueueProcessor {
  private readonly logger = new Logger(IndexingQueueProcessor.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    private readonly configService: ConfigService,
  ) {
    this.logger.log('IndexingQueueProcessor initialized and ready to process jobs');
  }

  @Process('single')
  async processSingleDocument(job: Job<SingleIndexingJob>) {
    const { indexName, documentId, document } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `🔄 Processing single document job ${job.id}: ${documentId} in index ${indexName}`,
    );

    try {
      // Check if index exists
      const indexExists = await this.indexService.getIndex(indexName);
      if (!indexExists) {
        throw new Error(`Index ${indexName} does not exist`);
      }

      this.logger.debug(`✅ Index ${indexName} exists, proceeding with document indexing`);

      // Index the document
      const result = await this.documentService.indexDocument(indexName, {
        id: documentId,
        document,
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Successfully processed single document ${documentId} in ${duration}ms`);

      return { success: true, documentId, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to process single document ${documentId} after ${duration}ms:`,
        error.message,
      );
      throw error; // Let Bull handle retries
    }
  }

  @Process('batch')
  async processBatchDocuments(job: Job<BatchIndexingJob>) {
    const { indexName, documents, batchId, options } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `🔄 Processing batch job ${job.id}: ${batchId} with ${documents.length} documents in index ${indexName}`,
    );

    try {
      // Check if index exists
      const indexExists = await this.indexService.getIndex(indexName);
      if (!indexExists) {
        throw new Error(`Index ${indexName} does not exist`);
      }

      this.logger.debug(`✅ Index ${indexName} exists, proceeding with batch indexing`);

      // Convert to the format expected by processBatchDirectly
      const documentsWithIds = documents.map(doc => ({
        id: doc.id,
        document: doc.document,
      }));

      this.logger.debug(`📦 Processing ${documentsWithIds.length} documents in batch ${batchId}`);

      // Use the direct processing method to avoid infinite queue loops
      const result = await this.documentService.processBatchDirectly(indexName, documentsWithIds);

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Successfully processed batch ${batchId} with ${result.successCount}/${documents.length} documents in ${duration}ms`,
      );

      return {
        success: true,
        batchId,
        documentsProcessed: result.successCount,
        documentsTotal: documents.length,
        duration,
        result,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to process batch ${batchId} after ${duration}ms:`,
        error.message,
      );
      throw error; // Let Bull handle retries
    }
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`🚀 Job ${job.id} of type '${job.name}' is now ACTIVE`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`✅ Job ${job.id} of type '${job.name}' COMPLETED successfully`);
    this.logger.debug(`Result:`, result);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Job ${job.id} of type '${job.name}' FAILED:`, error.message);
    this.logger.error(`Job data:`, job.data);
    this.logger.error(`Attempt ${job.attemptsMade}/${job.opts.attempts}`);
  }
}
