import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IndexingQueueProcessor } from './indexing-queue.processor';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';
import { Job } from 'bull';
import { Redis } from 'ioredis';
import { IndexingJob, BulkIndexingJob } from './indexing-queue.service';
import { BulkIndexingService } from '../services/bulk-indexing.service';

// Mock Redis
const mockRedis = {
  pipeline: jest.fn(),
  sismember: jest.fn(),
  sadd: jest.fn(),
  expire: jest.fn(),
  hgetall: jest.fn(),
  hmset: jest.fn(),
  del: jest.fn(),
  exec: jest.fn(),
};

// Mock Pipeline
const mockPipeline = {
  sismember: jest.fn(),
  sadd: jest.fn(),
  expire: jest.fn(),
  exec: jest.fn(),
};

describe('IndexingQueueProcessor', () => {
  let processor: IndexingQueueProcessor;
  let documentService: jest.Mocked<DocumentService>;
  let bulkIndexingService: jest.Mocked<BulkIndexingService>;
  let indexService: jest.Mocked<IndexService>;
  let configService: jest.Mocked<ConfigService>;
  let redis: jest.Mocked<Redis>;

  const mockIndexingJob = {
    id: 'job-123',
    data: {
      indexName: 'test-index',
      documents: [
        { id: 'doc1', document: { title: 'Document 1', content: 'Content 1' } },
        { id: 'doc2', document: { title: 'Document 2', content: 'Content 2' } },
      ],
      batchId: 'batch-123',
      priority: 5,
      metadata: {
        source: 'api',
        uploadId: 'upload-456',
        userId: 'user-789',
      },
    } as IndexingJob,
    progress: jest.fn(),
    attemptsMade: 0,
  } as unknown as Job<IndexingJob>;

  const mockBulkIndexingJob = {
    id: 'bulk-job-456',
    data: {
      indexName: 'test-index',
      documentIds: [],
      source: 'database',
      batchSize: 500,
      totalDocuments: 1000,
      filters: { status: 'active' },
    } as BulkIndexingJob,
    progress: jest.fn(),
    attemptsMade: 0,
  } as unknown as Job<BulkIndexingJob>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup pipeline mock
    mockRedis.pipeline.mockReturnValue(mockPipeline);
    mockPipeline.exec.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexingQueueProcessor,
        {
          provide: DocumentService,
          useFactory: () => ({
            bulkIndexDocuments: jest.fn(),
            listDocuments: jest.fn(),
          }),
        },
        {
          provide: BulkIndexingService,
          useFactory: () => ({
            bulkIndexFromDatabase: jest.fn(),
            getIndexingProgress: jest.fn(),
            clearIndexingProgress: jest.fn(),
          }),
        },
        {
          provide: IndexService,
          useFactory: () => ({
            getIndex: jest.fn(),
          }),
        },
        {
          provide: ConfigService,
          useFactory: () => ({
            get: jest.fn(),
          }),
        },
        {
          provide: 'default',
          useValue: mockRedis,
        },
      ],
    }).compile();

    processor = module.get<IndexingQueueProcessor>(IndexingQueueProcessor);
    documentService = module.get(DocumentService) as jest.Mocked<DocumentService>;
    bulkIndexingService = module.get(BulkIndexingService) as jest.Mocked<BulkIndexingService>;
    indexService = module.get(IndexService) as jest.Mocked<IndexService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
    redis = mockRedis as unknown as jest.Mocked<Redis>;
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processBatch', () => {
    beforeEach(() => {
      indexService.getIndex.mockResolvedValue({
        name: 'test-index',
        documentCount: 0,
        settings: {},
        mappings: {},
        status: 'open',
      });

      documentService.bulkIndexDocuments.mockResolvedValue({
        items: [
          { id: 'doc1', index: 'test-index', success: true, status: 201 },
          { id: 'doc2', index: 'test-index', success: true, status: 201 },
        ],
        took: 150,
        successCount: 2,
        errors: false,
      });

      mockPipeline.exec.mockResolvedValue([
        [null, 0], // doc1 not duplicate
        [null, 0], // doc2 not duplicate
      ]);
    });

    it('should process batch successfully', async () => {
      const result = await processor.processBatch(mockIndexingJob);

      expect(indexService.getIndex).toHaveBeenCalledWith('test-index');
      expect(documentService.bulkIndexDocuments).toHaveBeenCalledWith('test-index', [
        { id: 'doc1', document: { title: 'Document 1', content: 'Content 1' } },
        { id: 'doc2', document: { title: 'Document 2', content: 'Content 2' } },
      ]);

      expect(result).toEqual({
        batchId: 'batch-123',
        indexed: 2,
        errors: [],
        processingTime: expect.any(Number),
        duplicatesSkipped: 0,
      });
    });

    it('should handle index not found error', async () => {
      indexService.getIndex.mockRejectedValue(new Error('Index not found'));

      await expect(processor.processBatch(mockIndexingJob)).rejects.toThrow('Index not found');
    });

    it('should handle duplicate detection', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 1], // doc1 is duplicate
        [null, 0], // doc2 not duplicate
      ]);

      documentService.bulkIndexDocuments.mockResolvedValue({
        items: [
          { id: 'doc2', index: 'test-index', success: true, status: 201 },
        ],
        took: 100,
        successCount: 1,
        errors: false,
      });

      const result = await processor.processBatch(mockIndexingJob);

      expect(result.indexed).toBe(1);
      expect(result.duplicatesSkipped).toBe(1);
      expect(documentService.bulkIndexDocuments).toHaveBeenCalledWith('test-index', [
        { id: 'doc2', document: { title: 'Document 2', content: 'Content 2' } },
      ]);
    });

    it('should handle indexing errors', async () => {
      documentService.bulkIndexDocuments.mockResolvedValue({
        items: [
          { id: 'doc1', index: 'test-index', success: true, status: 201 },
          { id: 'doc2', index: 'test-index', success: false, status: 400, error: 'Validation failed' },
        ],
        took: 150,
        successCount: 1,
        errors: true,
      });

      const result = await processor.processBatch(mockIndexingJob);

      expect(result.indexed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        documentId: 'doc2',
        error: 'Validation failed',
      });
    });

    it('should update job progress', async () => {
      await processor.processBatch(mockIndexingJob);

      expect(mockIndexingJob.progress).toHaveBeenCalledWith(50); // 1/2 documents processed
      expect(mockIndexingJob.progress).toHaveBeenCalledWith(100); // 2/2 documents processed
    });

    it('should handle empty document batch', async () => {
      const emptyJob = {
        ...mockIndexingJob,
        data: {
          ...mockIndexingJob.data,
          documents: [],
        },
      } as Job<IndexingJob>;

      const result = await processor.processBatch(emptyJob);

      expect(result.indexed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(documentService.bulkIndexDocuments).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis connection error'));

      // Should continue processing without duplicate detection
      const result = await processor.processBatch(mockIndexingJob);

      expect(result.indexed).toBe(2);
      expect(result.duplicatesSkipped).toBe(0);
      expect(documentService.bulkIndexDocuments).toHaveBeenCalledWith('test-index', [
        { id: 'doc1', document: { title: 'Document 1', content: 'Content 1' } },
        { id: 'doc2', document: { title: 'Document 2', content: 'Content 2' } },
      ]);
    });

    it('should handle service errors', async () => {
      documentService.bulkIndexDocuments.mockRejectedValue(new Error('Service unavailable'));

      await expect(processor.processBatch(mockIndexingJob)).rejects.toThrow('Service unavailable');
    });
  });

  describe('processBulk', () => {
    beforeEach(() => {
      indexService.getIndex.mockResolvedValue({
        name: 'test-index',
        documentCount: 1000,
        settings: {},
        mappings: {},
        status: 'open',
      });

      bulkIndexingService.bulkIndexFromDatabase.mockResolvedValue({
        success: true,
        totalProcessed: 1000,
        totalErrors: 0,
        totalDuplicatesSkipped: 5,
        totalTime: 30000,
        averageRate: 33.33,
        batches: [],
      });
    });

    it('should process bulk indexing successfully', async () => {
      const result = await processor.processBulk(mockBulkIndexingJob);

      expect(indexService.getIndex).toHaveBeenCalledWith('test-index');
      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index', // table name defaults to index name
        {
          batchSize: 500,
          concurrency: expect.any(Number),
          skipDuplicates: true,
          onProgress: expect.any(Function),
          onBatchComplete: expect.any(Function),
        },
      );

      expect(result).toEqual({
        indexName: 'test-index',
        processed: 1000,
        errors: 0,
        duplicatesSkipped: 5,
        totalTime: 30000,
        averageRate: 33.33,
      });
    });

    it('should handle database source correctly', async () => {
      await processor.processBulk(mockBulkIndexingJob);

      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index',
        expect.any(Object),
      );
    });

    it('should use Railway-optimized settings', async () => {
      configService.get.mockReturnValue('railway');

      await processor.processBulk(mockBulkIndexingJob);

      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index',
        expect.objectContaining({
          batchSize: 250, // Railway-optimized
          concurrency: 2, // Railway-optimized
        }),
      );
    });

    it('should use default settings for non-Railway environments', async () => {
      configService.get.mockReturnValue('local');

      await processor.processBulk(mockBulkIndexingJob);

      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index',
        expect.objectContaining({
          batchSize: 500,
          concurrency: 3,
        }),
      );
    });

    it('should update job progress during processing', async () => {
      let progressCallback: (progress: any) => void = () => {};

      bulkIndexingService.bulkIndexFromDatabase.mockImplementation(
        async (indexName, tableName, options) => {
          if (options?.onProgress) {
            progressCallback = options.onProgress;
            // Simulate progress updates
            progressCallback({
              processed: 250,
              total: 1000,
              percentage: 25,
              rate: 10,
            });
            progressCallback({
              processed: 500,
              total: 1000,
              percentage: 50,
              rate: 15,
            });
          }
          return {
            success: true,
            totalProcessed: 1000,
            totalErrors: 0,
            totalDuplicatesSkipped: 0,
            totalTime: 30000,
            averageRate: 33.33,
            batches: [],
          };
        },
      );

      await processor.processBulk(mockBulkIndexingJob);

      expect(mockBulkIndexingJob.progress).toHaveBeenCalledWith(25);
      expect(mockBulkIndexingJob.progress).toHaveBeenCalledWith(50);
    });

    it('should handle batch completion callbacks', async () => {
      let batchCallback: (batch: any) => void = () => {};

      bulkIndexingService.bulkIndexFromDatabase.mockImplementation(
        async (indexName, tableName, options) => {
          if (options?.onBatchComplete) {
            batchCallback = options.onBatchComplete;
            // Simulate batch completion
            batchCallback({
              batchNumber: 0,
              processed: 500,
              errors: 2,
              duplicatesSkipped: 1,
              processingTime: 5000,
            });
          }
          return {
            success: true,
            totalProcessed: 1000,
            totalErrors: 2,
            totalDuplicatesSkipped: 1,
            totalTime: 30000,
            averageRate: 33.33,
            batches: [],
          };
        },
      );

      await processor.processBulk(mockBulkIndexingJob);

      // Progress should be updated based on batch completion
      expect(mockBulkIndexingJob.progress).toHaveBeenCalled();
    });

    it('should handle index not found error', async () => {
      indexService.getIndex.mockRejectedValue(new Error('Index not found'));

      await expect(processor.processBulk(mockBulkIndexingJob)).rejects.toThrow('Index not found');
    });

    it('should handle bulk indexing service errors', async () => {
      bulkIndexingService.bulkIndexFromDatabase.mockRejectedValue(
        new Error('Bulk indexing failed'),
      );

      await expect(processor.processBulk(mockBulkIndexingJob)).rejects.toThrow(
        'Bulk indexing failed',
      );
    });

    it('should handle non-database sources', async () => {
      const fileJob = {
        ...mockBulkIndexingJob,
        data: {
          ...mockBulkIndexingJob.data,
          source: 'file' as const,
        },
      } as Job<BulkIndexingJob>;

      // For now, non-database sources should throw
      await expect(processor.processBulk(fileJob)).rejects.toThrow(
        'Source file is not supported yet',
      );
    });
  });

  describe('Redis operations', () => {
    describe('isDuplicate', () => {
      it('should detect duplicates correctly', async () => {
        mockPipeline.exec.mockResolvedValue([
          [null, 1], // doc1 is duplicate
          [null, 0], // doc2 is not duplicate
        ]);

        const processor_any = processor as any;
        const results = await processor_any.checkDuplicates('test-index', ['doc1', 'doc2']);

        expect(results).toEqual([true, false]);
        expect(mockPipeline.sismember).toHaveBeenCalledWith('duplicates:test-index', 'doc1');
        expect(mockPipeline.sismember).toHaveBeenCalledWith('duplicates:test-index', 'doc2');
      });

      it('should handle Redis errors', async () => {
        mockPipeline.exec.mockRejectedValue(new Error('Redis error'));

        const processor_any = processor as any;
        const results = await processor_any.checkDuplicates('test-index', ['doc1', 'doc2']);

        // Should return false for all documents on error
        expect(results).toEqual([false, false]);
      });
    });

    describe('markProcessed', () => {
      it('should mark documents as processed', async () => {
        const processor_any = processor as any;
        await processor_any.markDocumentsProcessed('test-index', ['doc1', 'doc2']);

        expect(mockPipeline.sadd).toHaveBeenCalledWith('duplicates:test-index', 'doc1');
        expect(mockPipeline.sadd).toHaveBeenCalledWith('duplicates:test-index', 'doc2');
        expect(mockPipeline.expire).toHaveBeenCalledWith('duplicates:test-index', 3600);
        expect(mockPipeline.exec).toHaveBeenCalled();
      });

      it('should handle marking errors gracefully', async () => {
        mockPipeline.exec.mockRejectedValue(new Error('Redis error'));

        const processor_any = processor as any;
        // Should not throw
        await expect(
          processor_any.markDocumentsProcessed('test-index', ['doc1']),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('error handling and retries', () => {
    it('should handle job with high attempt count', async () => {
      const highAttemptJob = {
        ...mockIndexingJob,
        attemptsMade: 2,
      } as Job<IndexingJob>;

      indexService.getIndex.mockResolvedValue({
        name: 'test-index',
        documentCount: 0,
        settings: {},
        mappings: {},
        status: 'open',
      });

      documentService.bulkIndexDocuments.mockResolvedValue({
        items: [
          { id: 'doc1', index: 'test-index', success: true, status: 201 },
          { id: 'doc2', index: 'test-index', success: true, status: 201 },
        ],
        took: 150,
        successCount: 2,
        errors: false,
      });

      // Should still process successfully
      const result = await processor.processBatch(highAttemptJob);
      expect(result.indexed).toBe(2);
    });

    it('should handle bulk job errors appropriately', async () => {
      const errorJob = {
        ...mockBulkIndexingJob,
        attemptsMade: 4,
      } as Job<BulkIndexingJob>;

      indexService.getIndex.mockRejectedValue(new Error('Critical index error'));

      await expect(processor.processBulk(errorJob)).rejects.toThrow('Critical index error');
    });
  });

  describe('configuration handling', () => {
    it('should handle missing configuration gracefully', async () => {
      configService.get.mockReturnValue(undefined);

      await processor.processBulk(mockBulkIndexingJob);

      // Should use default settings
      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index',
        expect.objectContaining({
          batchSize: 500,
          concurrency: 3,
        }),
      );
    });

    it('should respect custom batch size from job data', async () => {
      const customBatchJob = {
        ...mockBulkIndexingJob,
        data: {
          ...mockBulkIndexingJob.data,
          batchSize: 1000,
        },
      } as Job<BulkIndexingJob>;

      await processor.processBulk(customBatchJob);

      expect(bulkIndexingService.bulkIndexFromDatabase).toHaveBeenCalledWith(
        'test-index',
        'test-index',
        expect.objectContaining({
          batchSize: 1000,
        }),
      );
    });
  });

  describe('job data validation', () => {
    it('should handle malformed job data', async () => {
      const malformedJob = {
        ...mockIndexingJob,
        data: {
          indexName: '', // Invalid index name
          documents: [],
          batchId: 'batch-123',
          priority: 0,
        },
      } as Job<IndexingJob>;

      await expect(processor.processBatch(malformedJob)).rejects.toThrow();
    });

    it('should handle missing required fields', async () => {
      const incompleteJob = {
        ...mockBulkIndexingJob,
        data: {
          // Missing indexName
          documentIds: [],
          source: 'database',
          batchSize: 500,
        } as any,
      } as Job<BulkIndexingJob>;

      await expect(processor.processBulk(incompleteJob)).rejects.toThrow();
    });
  });
}); 