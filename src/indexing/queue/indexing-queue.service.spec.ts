import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { IndexingQueueService } from './indexing-queue.service';
import { Job, Queue } from 'bull';

// Mock Bull Queue
const mockQueue = {
  add: jest.fn(),
  getWaiting: jest.fn(),
  getActive: jest.fn(),
  getCompleted: jest.fn(),
  getFailed: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  clean: jest.fn(),
};

// Mock Job
const mockJob = {
  id: 'job-123',
  data: {},
  opts: {},
  progress: jest.fn(),
  remove: jest.fn(),
} as unknown as Job;

describe('IndexingQueueService', () => {
  let service: IndexingQueueService;
  let indexingQueue: jest.Mocked<Queue>;
  let bulkIndexingQueue: jest.Mocked<Queue>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexingQueueService,
        {
          provide: getQueueToken('indexing'),
          useValue: mockQueue,
        },
        {
          provide: getQueueToken('bulk-indexing'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useFactory: () => ({
            get: jest.fn().mockReturnValue(500), // Default batch size
          }),
        },
      ],
    }).compile();

    service = module.get<IndexingQueueService>(IndexingQueueService);
    indexingQueue = module.get(getQueueToken('indexing')) as jest.Mocked<Queue>;
    bulkIndexingQueue = module.get(getQueueToken('bulk-indexing')) as jest.Mocked<Queue>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;

    // Setup default mock returns
    indexingQueue.add.mockResolvedValue(mockJob);
    bulkIndexingQueue.add.mockResolvedValue(mockJob);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addBatch', () => {
    const indexName = 'test-index';
    const documents = [
      { id: 'doc1', title: 'Document 1' },
      { id: 'doc2', title: 'Document 2' },
    ];

    it('should add batch to indexing queue with default options', async () => {
      const result = await service.addBatch(indexName, documents);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          indexName,
          documents: expect.arrayContaining([
            expect.objectContaining({ id: 'doc1', document: expect.any(Object) }),
            expect.objectContaining({ id: 'doc2', document: expect.any(Object) }),
          ]),
          priority: 0,
          batchId: expect.stringMatching(/^batch-\d+-[a-z0-9]+$/),
        }),
        expect.objectContaining({
          priority: 0,
          delay: 0,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        }),
      );

      expect(result).toBe(mockJob);
    });

    it('should add batch with custom options', async () => {
      const options = {
        priority: 5,
        delay: 1000,
        batchId: 'custom-batch-id',
        metadata: {
          source: 'api',
          userId: 'user123',
        },
      };

      await service.addBatch(indexName, documents, options);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          indexName,
          documents: expect.arrayContaining([
            expect.objectContaining({ id: expect.any(String), document: expect.any(Object) }),
          ]),
          priority: 5,
          batchId: 'custom-batch-id',
          metadata: options.metadata,
        }),
        expect.objectContaining({
          priority: 5,
          delay: 1000,
        }),
      );
    });

    it('should generate unique batch IDs when not provided', async () => {
      const job1 = await service.addBatch(indexName, documents);
      const job2 = await service.addBatch(indexName, documents);

      // Extract batch IDs from the calls
      const call1 = indexingQueue.add.mock.calls[0][1];
      const call2 = indexingQueue.add.mock.calls[1][1];

      expect(call1.batchId).not.toBe(call2.batchId);
      expect(call1.batchId).toMatch(/^batch-\d+-[a-z0-9]+$/);
      expect(call2.batchId).toMatch(/^batch-\d+-[a-z0-9]+$/);
    });
  });

  describe('addBulkIndexing', () => {
    const indexName = 'test-index';

    it('should add bulk indexing job with default options', async () => {
      const options = {
        source: 'database' as const,
        totalDocuments: 1000,
      };

      const result = await service.addBulkIndexing(indexName, options);

      expect(bulkIndexingQueue.add).toHaveBeenCalledWith(
        'process-bulk',
        expect.objectContaining({
          indexName,
          documentIds: [],
          source: 'database',
          batchSize: 500, // Default from config
          totalDocuments: 1000,
        }),
        expect.objectContaining({
          priority: 5,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }),
      );

      expect(result).toBe(mockJob);
    });

    it('should add bulk indexing job with custom batch size', async () => {
      const options = {
        source: 'file' as const,
        batchSize: 250,
        filters: { status: 'active' },
        priority: 10,
      };

      await service.addBulkIndexing(indexName, options);

      expect(bulkIndexingQueue.add).toHaveBeenCalledWith(
        'process-bulk',
        expect.objectContaining({
          indexName,
          source: 'file',
          batchSize: 250,
          filters: { status: 'active' },
        }),
        expect.objectContaining({
          priority: 10,
        }),
      );
    });

    it('should handle all source types', async () => {
      const sources = ['database', 'file', 'api'] as const;

      for (const source of sources) {
        await service.addBulkIndexing(indexName, { source });

        expect(bulkIndexingQueue.add).toHaveBeenCalledWith(
          'process-bulk',
          expect.objectContaining({
            source,
          }),
          expect.any(Object),
        );
      }

      expect(bulkIndexingQueue.add).toHaveBeenCalledTimes(3);
    });
  });

  describe('addSingleDocument', () => {
    const indexName = 'test-index';
    const document = { id: 'doc1', title: 'Single Document' };

    it('should add single document with high priority', async () => {
      await service.addSingleDocument(indexName, document);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          indexName,
          documents: [{ id: 'doc1', document: { id: 'doc1', title: 'Single Document' } }],
          priority: 10,
          batchId: expect.stringMatching(/^single-doc1$/),
        }),
        expect.objectContaining({
          priority: 10,
        }),
      );
    });

    it('should handle document without ID', async () => {
      const docWithoutId = { title: 'Document without ID' };

      await service.addSingleDocument(indexName, docWithoutId);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          documents: [
            expect.objectContaining({
              id: expect.stringMatching(/^doc-\d+(-[a-z0-9]+)?$/),
              document: docWithoutId,
            }),
          ],
          batchId: expect.stringMatching(/^single-doc-\d+(-[a-z0-9]+)?$/),
        }),
        expect.any(Object),
      );
    });

    it('should allow custom priority and delay', async () => {
      const options = {
        priority: 15,
        delay: 500,
      };

      await service.addSingleDocument(indexName, document, options);

      expect(indexingQueue.add).toHaveBeenCalledWith(
        'batch',
        expect.objectContaining({
          priority: 15,
        }),
        expect.objectContaining({
          priority: 15,
          delay: 500,
        }),
      );
    });
  });

  describe('getQueueStats', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      indexingQueue.getWaiting.mockResolvedValue([mockJob, mockJob]);
      indexingQueue.getActive.mockResolvedValue([mockJob]);
      indexingQueue.getCompleted.mockResolvedValue([mockJob, mockJob, mockJob]);
      indexingQueue.getFailed.mockResolvedValue([]);

      bulkIndexingQueue.getWaiting.mockResolvedValue([mockJob]);
      bulkIndexingQueue.getActive.mockResolvedValue([mockJob, mockJob]);
      bulkIndexingQueue.getCompleted.mockResolvedValue([mockJob]);
      bulkIndexingQueue.getFailed.mockResolvedValue([mockJob]);
    });

    it('should return comprehensive queue statistics', async () => {
      indexingQueue.getWaiting.mockResolvedValueOnce([mockJob, mockJob]);
      indexingQueue.getActive.mockResolvedValueOnce([mockJob]);
      indexingQueue.getCompleted.mockResolvedValueOnce([mockJob, mockJob, mockJob]);
      indexingQueue.getFailed.mockResolvedValueOnce([]);
      bulkIndexingQueue.getWaiting.mockResolvedValueOnce([mockJob]);
      bulkIndexingQueue.getActive.mockResolvedValueOnce([mockJob, mockJob]);
      bulkIndexingQueue.getCompleted.mockResolvedValueOnce([mockJob]);
      bulkIndexingQueue.getFailed.mockResolvedValueOnce([mockJob]);

      const stats = await service.getQueueStats();

      expect(stats).toMatchObject({
        indexing: { waiting: 2, active: 1, completed: 3, failed: 0 },
        bulkIndexing: { waiting: 1, active: 2, completed: 1, failed: 1 },
      });

      expect(indexingQueue.getWaiting).toHaveBeenCalled();
      expect(indexingQueue.getActive).toHaveBeenCalled();
      expect(indexingQueue.getCompleted).toHaveBeenCalled();
      expect(indexingQueue.getFailed).toHaveBeenCalled();
      expect(bulkIndexingQueue.getWaiting).toHaveBeenCalled();
      expect(bulkIndexingQueue.getActive).toHaveBeenCalled();
      expect(bulkIndexingQueue.getCompleted).toHaveBeenCalled();
      expect(bulkIndexingQueue.getFailed).toHaveBeenCalled();
    });

    it('should handle queue errors gracefully', async () => {
      indexingQueue.getWaiting.mockRejectedValue(new Error('Queue error'));

      await expect(service.getQueueStats()).rejects.toThrow('Queue error');
    });
  });

  describe('queue control', () => {
    describe('pauseQueues', () => {
      beforeEach(() => {
        indexingQueue.pause.mockResolvedValue();
        bulkIndexingQueue.pause.mockResolvedValue();
      });

      it('should pause all queues', async () => {
        await service.pauseQueues();

        expect(indexingQueue.pause).toHaveBeenCalled();
        expect(bulkIndexingQueue.pause).toHaveBeenCalled();
      });

      it('should handle pause errors', async () => {
        indexingQueue.pause.mockRejectedValue(new Error('Pause failed'));

        await expect(service.pauseQueues()).rejects.toThrow('Pause failed');
      });
    });

    describe('resumeQueues', () => {
      beforeEach(() => {
        indexingQueue.resume.mockResolvedValue();
        bulkIndexingQueue.resume.mockResolvedValue();
      });

      it('should resume all queues', async () => {
        await service.resumeQueues();

        expect(indexingQueue.resume).toHaveBeenCalled();
        expect(bulkIndexingQueue.resume).toHaveBeenCalled();
      });

      it('should handle resume errors', async () => {
        bulkIndexingQueue.resume.mockRejectedValue(new Error('Resume failed'));

        await expect(service.resumeQueues()).rejects.toThrow('Resume failed');
      });
    });
  });

  describe('cleanOldJobs', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      indexingQueue.clean.mockResolvedValue([]);
      bulkIndexingQueue.clean.mockResolvedValue([]);
    });

    it('should clean old jobs from both queues', async () => {
      const expectedOlderThan = 24 * 60 * 60 * 1000; // 24 hours

      await service.cleanOldJobs();

      expect(indexingQueue.clean).toHaveBeenCalledWith(expectedOlderThan, 'completed');
      expect(indexingQueue.clean).toHaveBeenCalledWith(expectedOlderThan, 'failed');
      expect(bulkIndexingQueue.clean).toHaveBeenCalledWith(expectedOlderThan, 'completed');
      expect(bulkIndexingQueue.clean).toHaveBeenCalledWith(expectedOlderThan, 'failed');
    });

    it('should handle clean errors gracefully', async () => {
      indexingQueue.clean.mockRejectedValue(new Error('Clean failed'));

      await expect(service.cleanOldJobs()).rejects.toThrow('Clean failed');
    });
  });

  describe('configuration', () => {
    it('should use custom batch size from config', async () => {
      configService.get.mockReturnValue(750);

      await service.addBulkIndexing('test-index', { source: 'database' });

      expect(bulkIndexingQueue.add).toHaveBeenCalledWith(
        'process-bulk',
        expect.objectContaining({
          batchSize: 750,
        }),
        expect.any(Object),
      );
    });

    it('should fallback to default when config is not available', async () => {
      configService.get.mockReturnValue(undefined);

      await service.addBulkIndexing('test-index', { source: 'database' });

      expect(bulkIndexingQueue.add).toHaveBeenCalledWith(
        'process-bulk',
        expect.objectContaining({
          batchSize: 500, // Default fallback
        }),
        expect.any(Object),
      );
    });
  });

  describe('error handling', () => {
    it('should handle queue add failures', async () => {
      const error = new Error('Queue is full');
      indexingQueue.add.mockRejectedValue(error);

      await expect(service.addBatch('test-index', [{ id: 'doc1' }])).rejects.toThrow(
        'Queue is full',
      );
    });

    it('should handle bulk queue add failures', async () => {
      const error = new Error('Bulk queue error');
      bulkIndexingQueue.add.mockRejectedValue(error);

      await expect(service.addBulkIndexing('test-index', { source: 'database' })).rejects.toThrow(
        'Bulk queue error',
      );
    });

    it('should handle partial queue control failures', async () => {
      indexingQueue.pause.mockResolvedValue();
      bulkIndexingQueue.pause.mockRejectedValue(new Error('Bulk pause failed'));

      await expect(service.pauseQueues()).rejects.toThrow('Bulk pause failed');

      // First queue should still have been called
      expect(indexingQueue.pause).toHaveBeenCalled();
    });
  });

  describe('batch ID generation', () => {
    it('should generate unique batch IDs', () => {
      // Access private method through service instance
      const service_any = service as any;

      const id1 = service_any.generateBatchId();
      const id2 = service_any.generateBatchId();

      expect(id1).toMatch(/^batch-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^batch-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should include timestamp in batch ID', () => {
      const service_any = service as any;
      const beforeTime = Date.now();

      const batchId = service_any.generateBatchId();

      const afterTime = Date.now();
      const timestampMatch = batchId.match(/^batch-(\d+)-/);

      expect(timestampMatch).toBeTruthy();

      if (timestampMatch) {
        const timestamp = parseInt(timestampMatch[1]);
        expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(timestamp).toBeLessThanOrEqual(afterTime);
      }
    });
  });
});
