import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { BulkIndexingService, BulkIndexingOptions } from './bulk-indexing.service';
import { DocumentService } from '../../document/document.service';
import { IndexService } from '../../index/index.service';

// Mock Queue
const mockQueue = {
  add: jest.fn(),
  getWaiting: jest.fn(),
  getActive: jest.fn(),
  getCompleted: jest.fn(),
  getFailed: jest.fn(),
  getDelayed: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  clean: jest.fn(),
  obliterate: jest.fn(),
};

// Mock Job
const mockJob = {
  id: 'job-123',
  data: {},
  opts: {},
  progress: jest.fn(),
  remove: jest.fn(),
} as unknown as Job;

// Mock DocumentService
const mockDocumentService = {
  bulkIndexDocuments: jest.fn(),
  indexDocument: jest.fn(),
};

// Mock IndexService
const mockIndexService = {
  getIndex: jest.fn(),
  createIndex: jest.fn(),
};

// Mock ConfigService
const mockConfigService = {
  get: jest.fn(),
};

describe('BulkIndexingService', () => {
  let service: BulkIndexingService;
  let indexingQueue: jest.Mocked<Queue>;
  let documentService: jest.Mocked<DocumentService>;
  let indexService: jest.Mocked<IndexService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkIndexingService,
        {
          provide: getQueueToken('indexing'),
          useValue: mockQueue,
        },
        {
          provide: DocumentService,
          useValue: mockDocumentService,
        },
        {
          provide: IndexService,
          useValue: mockIndexService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<BulkIndexingService>(BulkIndexingService);
    indexingQueue = module.get(getQueueToken('indexing')) as jest.Mocked<Queue>;
    documentService = module.get(DocumentService) as jest.Mocked<DocumentService>;
    indexService = module.get(IndexService) as jest.Mocked<IndexService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;

    // Setup default mock returns
    indexingQueue.add.mockResolvedValue(mockJob);
    indexingQueue.getWaiting.mockResolvedValue([]);
    indexingQueue.getActive.mockResolvedValue([]);
    indexingQueue.getCompleted.mockResolvedValue([]);
    indexingQueue.getFailed.mockResolvedValue([]);
    indexingQueue.getDelayed.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('queueSingleDocument', () => {
    const indexName = 'test-index';
    const documentId = 'doc-123';
    const document = { title: 'Test Document', content: 'Test content' };

    it('should queue a single document with default options', async () => {
      const jobId = await service.queueSingleDocument(indexName, documentId, document);

      expect(jobId).toMatch(/^single:test-index:doc-123:\d+:[a-z0-9]+$/);
      expect(indexingQueue.add).toHaveBeenCalledWith(
        'single',
        expect.objectContaining({
          indexName,
          documentId,
          document,
          priority: 5,
          metadata: expect.objectContaining({
            queuedAt: expect.any(String),
            source: 'api',
          }),
        }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^single:test-index:doc-123:\d+:[a-z0-9]+$/),
          removeOnComplete: 10,
          removeOnFail: 5,
          attempts: 3,
          priority: 5,
        }),
      );
    });

    it('should queue a single document with custom options', async () => {
      const options: Partial<BulkIndexingOptions> = {
        priority: 10,
        retryAttempts: 5,
      };

      const jobId = await service.queueSingleDocument(indexName, documentId, document, options);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'single',
        expect.objectContaining({
          priority: 10,
        }),
        expect.objectContaining({
          attempts: 5,
          priority: 10,
        }),
      );
    });

    it('should generate unique job IDs for concurrent requests', async () => {
      const jobId1 = await service.queueSingleDocument(indexName, documentId, document);
      const jobId2 = await service.queueSingleDocument(indexName, documentId, document);

      expect(jobId1).not.toBe(jobId2);
      expect(jobId1).toMatch(/^single:test-index:doc-123:\d+:[a-z0-9]+$/);
      expect(jobId2).toMatch(/^single:test-index:doc-123:\d+:[a-z0-9]+$/);
    });
  });

  describe('queueBatchDocuments', () => {
    const indexName = 'test-index';
    const documents = [
      { id: 'doc1', document: { title: 'Document 1' } },
      { id: 'doc2', document: { title: 'Document 2' } },
      { id: 'doc3', document: { title: 'Document 3' } },
    ];

    it('should queue batch documents with default options', async () => {
      const batchId = await service.queueBatchDocuments(indexName, documents);

      expect(batchId).toMatch(/^batch:test-index:\d+:[a-z0-9]+$/);
      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          indexName,
          documents,
          batchId: expect.stringMatching(/^batch:test-index:\d+:[a-z0-9]+:0$/),
          options: {},
          metadata: expect.objectContaining({
            queuedAt: expect.any(String),
            parentBatchId: batchId,
            batchNumber: 1,
            totalBatches: 1,
            source: 'bulk',
          }),
        }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^batch:test-index:\d+:[a-z0-9]+:0$/),
          removeOnComplete: 10,
          removeOnFail: 5,
          attempts: 3,
          priority: 3,
        }),
      );
    });

    it('should split large batches into smaller chunks', async () => {
      const largeDocuments = Array.from({ length: 1500 }, (_, i) => ({
        id: `doc${i}`,
        document: { title: `Document ${i}` },
      }));

      const options: BulkIndexingOptions = {
        batchSize: 500,
      };

      const batchId = await service.queueBatchDocuments(indexName, largeDocuments, options);

      // Should create 3 batches (1500 docs / 500 batch size = 3)
      expect(indexingQueue.add).toHaveBeenCalledTimes(3);

      // Check first batch
      expect(indexingQueue.add).toHaveBeenNthCalledWith(
        1,
        'batch',
        expect.objectContaining({
          documents: expect.arrayContaining([expect.objectContaining({ id: 'doc0' })]),
          metadata: expect.objectContaining({
            batchNumber: 1,
            totalBatches: 3,
          }),
        }),
        expect.any(Object),
      );

      // Check last batch
      expect(indexingQueue.add).toHaveBeenNthCalledWith(
        3,
        'batch',
        expect.objectContaining({
          documents: expect.arrayContaining([expect.objectContaining({ id: 'doc1000' })]),
          metadata: expect.objectContaining({
            batchNumber: 3,
            totalBatches: 3,
          }),
        }),
        expect.any(Object),
      );
    });

    it('should handle empty document array', async () => {
      const batchId = await service.queueBatchDocuments(indexName, []);

      expect(batchId).toBeNull();
      expect(indexingQueue.add).not.toHaveBeenCalled();
    });

    it('should use custom batch size and priority', async () => {
      const options: BulkIndexingOptions = {
        batchSize: 100,
        priority: 8,
        retryAttempts: 5,
      };

      await service.queueBatchDocuments(indexName, documents, options);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          options,
        }),
        expect.objectContaining({
          attempts: 5,
          priority: 8,
        }),
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return comprehensive queue statistics', async () => {
      // Mock queue lengths
      indexingQueue.getWaiting.mockResolvedValue(Array(5).fill(mockJob));
      indexingQueue.getActive.mockResolvedValue(Array(2).fill(mockJob));
      indexingQueue.getCompleted.mockResolvedValue(Array(10).fill(mockJob));
      indexingQueue.getFailed.mockResolvedValue(Array(1).fill(mockJob));
      indexingQueue.getDelayed.mockResolvedValue(Array(3).fill(mockJob));

      const stats = await service.getQueueStats();

      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 10,
        failed: 1,
        delayed: 3,
      });

      expect(indexingQueue.getWaiting).toHaveBeenCalled();
      expect(indexingQueue.getActive).toHaveBeenCalled();
      expect(indexingQueue.getCompleted).toHaveBeenCalled();
      expect(indexingQueue.getFailed).toHaveBeenCalled();
      expect(indexingQueue.getDelayed).toHaveBeenCalled();
    });

    it('should handle queue errors', async () => {
      indexingQueue.getWaiting.mockRejectedValue(new Error('Queue error'));

      await expect(service.getQueueStats()).rejects.toThrow('Queue error');
    });
  });

  describe('getQueueHealth', () => {
    beforeEach(() => {
      indexingQueue.getWaiting.mockResolvedValue(Array(50).fill(mockJob));
      indexingQueue.getActive.mockResolvedValue(Array(10).fill(mockJob));
      indexingQueue.getCompleted.mockResolvedValue(Array(100).fill(mockJob));
      indexingQueue.getFailed.mockResolvedValue(Array(5).fill(mockJob));
      indexingQueue.getDelayed.mockResolvedValue(Array(20).fill(mockJob));
    });

    it('should return healthy status for normal operations', async () => {
      const health = await service.getQueueHealth();

      expect(health.status).toBe('healthy');
      expect(health.message).toBe('Queue operating normally');
      expect(health.stats).toEqual({
        waiting: 50,
        active: 10,
        completed: 100,
        failed: 5,
        delayed: 20,
      });
    });

    it('should return unhealthy status for high failure rate', async () => {
      indexingQueue.getFailed.mockResolvedValue(Array(50).fill(mockJob)); // 50 failures
      indexingQueue.getWaiting.mockResolvedValue(Array(20).fill(mockJob)); // 20 waiting
      indexingQueue.getActive.mockResolvedValue(Array(10).fill(mockJob)); // 10 active

      const health = await service.getQueueHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.message).toBe('High failure rate detected');
    });

    it('should return degraded status for high queue backlog', async () => {
      indexingQueue.getWaiting.mockResolvedValue(Array(1500).fill(mockJob)); // High backlog

      const health = await service.getQueueHealth();

      expect(health.status).toBe('degraded');
      expect(health.message).toBe('High queue backlog');
    });

    it('should return unhealthy status on queue errors', async () => {
      indexingQueue.getWaiting.mockRejectedValue(new Error('Redis connection lost'));

      const health = await service.getQueueHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.message).toBe('Queue error: Redis connection lost');
      expect(health.stats).toBeNull();
    });
  });

  describe('queue management', () => {
    describe('cleanQueue', () => {
      it('should clean completed, failed, active, delayed and remove waiting jobs', async () => {
        indexingQueue.clean.mockResolvedValue([]);
        indexingQueue.getWaiting.mockResolvedValue([]);

        await service.cleanQueue();

        expect(indexingQueue.clean).toHaveBeenCalledWith(1000, 'completed');
        expect(indexingQueue.clean).toHaveBeenCalledWith(1000, 'failed');
        expect(indexingQueue.clean).toHaveBeenCalledWith(0, 'active');
        expect(indexingQueue.clean).toHaveBeenCalledWith(0, 'delayed');
        expect(indexingQueue.getWaiting).toHaveBeenCalled();
        expect(indexingQueue.clean).toHaveBeenCalledTimes(4);
      });

      it('should handle clean errors', async () => {
        indexingQueue.clean.mockRejectedValue(new Error('Clean failed'));

        await expect(service.cleanQueue()).rejects.toThrow('Clean failed');
      });
    });

    describe('drainQueue', () => {
      it('should pause, obliterate with force, and resume', async () => {
        indexingQueue.pause.mockResolvedValue();
        indexingQueue.obliterate.mockResolvedValue();
        indexingQueue.resume.mockResolvedValue();

        await service.drainQueue();

        expect(indexingQueue.pause).toHaveBeenCalledWith(true, true);
        expect(indexingQueue.obliterate).toHaveBeenCalledWith({ force: true });
        expect(indexingQueue.resume).toHaveBeenCalledWith(true);
      });

      it('should resume on obliterate error', async () => {
        indexingQueue.pause.mockResolvedValue();
        indexingQueue.obliterate.mockRejectedValue(new Error('Obliterate failed'));
        indexingQueue.resume.mockResolvedValue();

        await expect(service.drainQueue()).rejects.toThrow('Obliterate failed');
        expect(indexingQueue.resume).toHaveBeenCalledWith(true);
      });
    });

    describe('pauseQueue', () => {
      it('should pause the queue successfully', async () => {
        indexingQueue.pause.mockResolvedValue();

        await service.pauseQueue();

        expect(indexingQueue.pause).toHaveBeenCalled();
      });

      it('should handle pause errors', async () => {
        indexingQueue.pause.mockRejectedValue(new Error('Pause failed'));

        await expect(service.pauseQueue()).rejects.toThrow('Pause failed');
      });
    });

    describe('resumeQueue', () => {
      it('should resume the queue successfully', async () => {
        indexingQueue.resume.mockResolvedValue();

        await service.resumeQueue();

        expect(indexingQueue.resume).toHaveBeenCalled();
      });

      it('should handle resume errors', async () => {
        indexingQueue.resume.mockRejectedValue(new Error('Resume failed'));

        await expect(service.resumeQueue()).rejects.toThrow('Resume failed');
      });
    });
  });

  describe('helper methods', () => {
    describe('chunkArray', () => {
      it('should split array into correct chunks', () => {
        const array = Array.from({ length: 10 }, (_, i) => i);
        const service_any = service as any;

        const chunks = service_any.chunkArray(array, 3);

        expect(chunks).toHaveLength(4); // 10 items / 3 = 3.33, so 4 chunks
        expect(chunks[0]).toEqual([0, 1, 2]);
        expect(chunks[1]).toEqual([3, 4, 5]);
        expect(chunks[2]).toEqual([6, 7, 8]);
        expect(chunks[3]).toEqual([9]);
      });

      it('should handle empty array', () => {
        const service_any = service as any;
        const chunks = service_any.chunkArray([], 5);

        expect(chunks).toEqual([]);
      });

      it('should handle array smaller than chunk size', () => {
        const array = [1, 2];
        const service_any = service as any;

        const chunks = service_any.chunkArray(array, 5);

        expect(chunks).toEqual([[1, 2]]);
      });
    });
  });

  describe('error handling', () => {
    it('should handle queue add failures gracefully', async () => {
      const error = new Error('Queue is full');
      indexingQueue.add.mockRejectedValue(error);

      await expect(
        service.queueSingleDocument('test-index', 'doc-1', { title: 'Test' }),
      ).rejects.toThrow('Queue is full');
    });

    it('should handle batch queue failures gracefully', async () => {
      const error = new Error('Queue is unavailable');
      indexingQueue.add.mockRejectedValue(error);

      const documents = [{ id: 'doc1', document: { title: 'Test' } }];

      await expect(service.queueBatchDocuments('test-index', documents)).rejects.toThrow(
        'Queue is unavailable',
      );
    });
  });

  describe('configuration', () => {
    it('should use default values when config is not available', async () => {
      configService.get.mockReturnValue(undefined);

      const documents = [{ id: 'doc1', document: { title: 'Test' } }];
      await service.queueBatchDocuments('test-index', documents);

      // Should use default batch size of 500
      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          documents,
        }),
        expect.any(Object),
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle concurrent batch queuing', async () => {
      const documents1 = [{ id: 'doc1', document: { title: 'Batch 1 Doc' } }];
      const documents2 = [{ id: 'doc2', document: { title: 'Batch 2 Doc' } }];

      const [batchId1, batchId2] = await Promise.all([
        service.queueBatchDocuments('test-index', documents1),
        service.queueBatchDocuments('test-index', documents2),
      ]);

      expect(batchId1).not.toBe(batchId2);
      expect(indexingQueue.add).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed single and batch operations', async () => {
      const singlePromise = service.queueSingleDocument('test-index', 'single-doc', {
        title: 'Single',
      });
      const batchPromise = service.queueBatchDocuments('test-index', [
        { id: 'batch-doc', document: { title: 'Batch' } },
      ]);

      const [singleJobId, batchId] = await Promise.all([singlePromise, batchPromise]);

      expect(singleJobId).toMatch(/^single:/);
      expect(batchId).toMatch(/^batch:/);
      expect(indexingQueue.add).toHaveBeenCalledTimes(2);
    });
  });
});
