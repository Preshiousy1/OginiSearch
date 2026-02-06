import { Test, TestingModule } from '@nestjs/testing';
import { PersistenceQueueProcessor } from '../queue/persistence-queue.processor';
import { PersistentTermDictionaryService } from '../../storage/index-storage/persistent-term-dictionary.service';
import { BulkOperationTrackerService } from '../services/bulk-operation-tracker.service';
import { Job } from 'bull';
import { PersistenceBatchJob } from '../interfaces/persistence-job.interface';
import { PostingList } from '../../index/posting-list';

/**
 * Unit tests for PersistenceQueueProcessor
 * 
 * Validates that the processor:
 * 1. Reads term postings from RocksDB (not memory)
 * 2. Persists to MongoDB correctly
 * 3. Handles missing terms gracefully
 * 4. Updates bulk operation tracker
 * 5. Processes batches efficiently
 */
describe('PersistenceQueueProcessor', () => {
  let processor: PersistenceQueueProcessor;
  let persistentTermDict: jest.Mocked<PersistentTermDictionaryService>;
  let bulkTracker: jest.Mocked<BulkOperationTrackerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersistenceQueueProcessor,
        {
          provide: PersistentTermDictionaryService,
          useValue: {
            getTermPostings: jest.fn(),
            saveTermPostingsToMongoDB: jest.fn(),
          },
        },
        {
          provide: BulkOperationTrackerService,
          useValue: {
            markBatchPersisted: jest.fn(),
            getOperation: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<PersistenceQueueProcessor>(PersistenceQueueProcessor);
    persistentTermDict = module.get(PersistentTermDictionaryService);
    bulkTracker = module.get(BulkOperationTrackerService);
  });

  describe('processBatchTerms', () => {
    it('should read terms from RocksDB and persist to MongoDB', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '1',
        data: {
          indexName: 'test-index',
          batchId: 'batch-1',
          dirtyTerms: ['test-index:title:test', 'test-index:title:document'],
          bulkOpId: 'bulk-op-1',
          metadata: {},
        },
      };

      // Mock RocksDB returning posting lists
      const mockPostingList1 = new PostingList();
      mockPostingList1.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      const mockPostingList2 = new PostingList();
      mockPostingList2.addPosting({
        docId: 'doc2',
        frequency: 2,
        positions: [0, 5],
        metadata: {},
      });

      persistentTermDict.getTermPostings
        .mockResolvedValueOnce(mockPostingList1)
        .mockResolvedValueOnce(mockPostingList2);

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Verify RocksDB reads
      expect(persistentTermDict.getTermPostings).toHaveBeenCalledTimes(2);
      expect(persistentTermDict.getTermPostings).toHaveBeenCalledWith('test-index:title:test');
      expect(persistentTermDict.getTermPostings).toHaveBeenCalledWith('test-index:title:document');

      // Verify MongoDB writes
      expect(persistentTermDict.saveTermPostingsToMongoDB).toHaveBeenCalledTimes(2);
      expect(persistentTermDict.saveTermPostingsToMongoDB).toHaveBeenCalledWith(
        'test-index:title:test',
        mockPostingList1,
      );

      // Verify bulk tracker update
      expect(bulkTracker.markBatchPersisted).toHaveBeenCalledWith('bulk-op-1', 'batch-1');

      // Verify result
      expect(result.success).toBe(true);
      expect(result.persistedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });

    it('should handle terms not found in RocksDB', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '2',
        data: {
          indexName: 'test-index',
          batchId: 'batch-2',
          dirtyTerms: ['test-index:title:missing'],
          bulkOpId: 'bulk-op-2',
          metadata: {},
        },
      };

      // Mock RocksDB returning null (term evicted or missing)
      persistentTermDict.getTermPostings.mockResolvedValue(null);

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Verify attempt to read from RocksDB
      expect(persistentTermDict.getTermPostings).toHaveBeenCalledWith('test-index:title:missing');

      // Verify MongoDB write was NOT called
      expect(persistentTermDict.saveTermPostingsToMongoDB).not.toHaveBeenCalled();

      // Verify result reflects failure
      expect(result.success).toBe(true); // Job completes even with failures
      expect(result.persistedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failedTerms).toContain('test-index:title:missing');
    });

    it('should handle empty posting lists', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '3',
        data: {
          indexName: 'test-index',
          batchId: 'batch-3',
          dirtyTerms: ['test-index:title:empty'],
          bulkOpId: 'bulk-op-3',
          metadata: {},
        },
      };

      const emptyPostingList = new PostingList();

      persistentTermDict.getTermPostings.mockResolvedValue(emptyPostingList);

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Empty posting lists should not be persisted
      expect(persistentTermDict.saveTermPostingsToMongoDB).not.toHaveBeenCalled();
      expect(result.persistedCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });

    it('should process terms in sub-batches for performance', async () => {
      const dirtyTerms = [];
      for (let i = 0; i < 250; i++) {
        dirtyTerms.push(`test-index:title:term${i}`);
      }

      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '4',
        data: {
          indexName: 'test-index',
          batchId: 'batch-4',
          dirtyTerms,
          bulkOpId: 'bulk-op-4',
          metadata: {},
        },
      };

      // Mock all terms return valid posting lists
      const mockPostingList = new PostingList();
      mockPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings.mockResolvedValue(mockPostingList);

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Verify all terms were processed
      expect(persistentTermDict.getTermPostings).toHaveBeenCalledTimes(250);
      expect(persistentTermDict.saveTermPostingsToMongoDB).toHaveBeenCalledTimes(250);
      expect(result.persistedCount).toBe(250);
    });

    it('should continue processing after individual term failures', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '5',
        data: {
          indexName: 'test-index',
          batchId: 'batch-5',
          dirtyTerms: ['test-index:title:good1', 'test-index:title:bad', 'test-index:title:good2'],
          bulkOpId: 'bulk-op-5',
          metadata: {},
        },
      };

      const goodPostingList = new PostingList();
      goodPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings
        .mockResolvedValueOnce(goodPostingList) // good1
        .mockResolvedValueOnce(null) // bad
        .mockResolvedValueOnce(goodPostingList); // good2

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Verify good terms were persisted
      expect(result.persistedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.failedTerms).toEqual(['test-index:title:bad']);
    });

    it('should handle MongoDB persistence errors', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '6',
        data: {
          indexName: 'test-index',
          batchId: 'batch-6',
          dirtyTerms: ['test-index:title:error'],
          bulkOpId: 'bulk-op-6',
          metadata: {},
        },
      };

      const mockPostingList = new PostingList();
      mockPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings.mockResolvedValue(mockPostingList);
      persistentTermDict.saveTermPostingsToMongoDB.mockRejectedValue(
        new Error('MongoDB connection failed'),
      );

      // Execute
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Job should complete but report failure
      expect(result.success).toBe(true);
      expect(result.persistedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.failedTerms).toContain('test-index:title:error');
    });
  });

  describe('Bulk Operation Tracking', () => {
    it('should update bulk operation tracker on success', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '7',
        data: {
          indexName: 'test-index',
          batchId: 'batch-7',
          dirtyTerms: ['test-index:title:track'],
          bulkOpId: 'bulk-op-7',
          metadata: {},
        },
      };

      const mockPostingList = new PostingList();
      mockPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings.mockResolvedValue(mockPostingList);

      // Execute
      await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);

      // Verify tracker was updated
      expect(bulkTracker.markBatchPersisted).toHaveBeenCalledWith('bulk-op-7', 'batch-7');
    });

    it('should handle missing bulk operation gracefully', async () => {
      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '8',
        data: {
          indexName: 'test-index',
          batchId: 'batch-8',
          dirtyTerms: ['test-index:title:orphan'],
          bulkOpId: 'bulk-op-missing',
          metadata: {},
        },
      };

      const mockPostingList = new PostingList();
      mockPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings.mockResolvedValue(mockPostingList);
      bulkTracker.markBatchPersisted.mockImplementation(() => {
        throw new Error('Bulk operation bulk-op-missing not found');
      });

      // Execute - should not throw
      await expect(
        processor['processBatchTerms'](job as Job<PersistenceBatchJob>),
      ).resolves.not.toThrow();

      // Verify persistence still happened
      expect(persistentTermDict.saveTermPostingsToMongoDB).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    it('should batch process large number of terms efficiently', async () => {
      const largeTermSet = [];
      for (let i = 0; i < 5000; i++) {
        largeTermSet.push(`test-index:field:term${i}`);
      }

      const job: Partial<Job<PersistenceBatchJob>> = {
        id: '9',
        data: {
          indexName: 'test-index',
          batchId: 'batch-large',
          dirtyTerms: largeTermSet,
          bulkOpId: 'bulk-op-large',
          metadata: {},
        },
      };

      const mockPostingList = new PostingList();
      mockPostingList.addPosting({
        docId: 'doc1',
        frequency: 1,
        positions: [0],
        metadata: {},
      });

      persistentTermDict.getTermPostings.mockResolvedValue(mockPostingList);

      const startTime = Date.now();
      const result = await processor['processBatchTerms'](job as Job<PersistenceBatchJob>);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 30 seconds for 5000 terms)
      expect(duration).toBeLessThan(30000);
      expect(result.persistedCount).toBe(5000);
      expect(result.success).toBe(true);
    }, 35000); // 35 second timeout
  });
});
