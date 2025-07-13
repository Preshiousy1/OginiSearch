import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';
import { ConfigService } from '@nestjs/config';
import { DocumentStorageService } from '../../storage/document-storage/document-storage.service';
import { IndexingService } from '../indexing.service';

export interface SingleIndexingJob {
  indexName: string;
  documentId: string;
  document: any;
  priority?: number;
  metadata?: Record<string, any>;
}

export interface BatchIndexingJob {
  indexName: string;
  documents: Array<{ id: string; document: any }>;
  batchId: string;
  batchNumber: number;
  totalBatches: number;
  options: {
    skipDuplicates?: boolean;
    enableProgress?: boolean;
  };
  metadata?: Record<string, any>;
}

@Injectable()
@Processor('bulk-indexing')
export class IndexingQueueProcessor {
  private readonly logger = new Logger(IndexingQueueProcessor.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly indexService: IndexService,
    private readonly configService: ConfigService,
    private readonly documentStorageService: DocumentStorageService,
    private readonly indexingService: IndexingService,
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

      // Store document
      await this.documentStorageService.storeDocument(indexName, {
        documentId,
        content: document,
        metadata: document.metadata,
      });

      // Index the document
      await this.documentService.indexDocument(indexName, {
        id: documentId,
        document,
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Successfully processed single document ${documentId} in ${duration}ms`);

      return { success: true, documentId, duration };
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
    const { indexName, documents, batchId, batchNumber, totalBatches, options } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `🔄 Processing batch ${batchNumber}/${totalBatches} (${documents.length} documents) in index ${indexName}`,
    );

    try {
      // Check if index exists
      const indexExists = await this.indexService.getIndex(indexName);
      if (!indexExists) {
        throw new Error(`Index ${indexName} does not exist`);
      }

      // Store documents in PostgreSQL
      const storageResult = await this.documentStorageService.bulkStoreDocuments(
        indexName,
        documents.map(doc => ({
          documentId: doc.id,
          content: doc.document,
          metadata: doc.document.metadata,
        })),
        {
          skipDuplicates: options.skipDuplicates,
          batchSize: 1000, // Use smaller batches for PostgreSQL
        },
      );

      // Process documents for search indexing
      const successfulDocs = documents.filter(
        doc => !storageResult.errors.find(err => err.documentId === doc.id),
      );

      let processedCount = 0;
      const indexingErrors: Array<{ documentId: string; error: string }> = [];

      // Process in smaller sub-batches for search indexing
      const subBatchSize = 100;
      for (let i = 0; i < successfulDocs.length; i += subBatchSize) {
        const subBatch = successfulDocs.slice(i, i + subBatchSize);

        try {
          // Process each document in the sub-batch directly
          await Promise.all(
            subBatch.map(doc =>
              this.indexingService.indexDocument(indexName, doc.id, doc.document, true),
            ),
          );
          processedCount += subBatch.length;

          // Report progress
          const progress = (processedCount / documents.length) * 100;
          await job.progress(progress);

          // Update document count after each sub-batch
          await this.indexService.rebuildDocumentCount(indexName);
        } catch (error) {
          this.logger.error(`Error processing sub-batch: ${error.message}`);
          subBatch.forEach(doc => {
            indexingErrors.push({
              documentId: doc.id,
              error: error.message,
            });
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Batch ${batchNumber}/${totalBatches} completed in ${duration}ms. Success: ${processedCount}, Failures: ${
          documents.length - processedCount
        }`,
      );

      return {
        success: true,
        batchId,
        batchNumber,
        totalBatches,
        successCount: processedCount,
        failureCount: documents.length - processedCount,
        duration,
        errors: [...storageResult.errors, ...indexingErrors],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Failed to process batch ${batchNumber}/${totalBatches} after ${duration}ms:`,
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
