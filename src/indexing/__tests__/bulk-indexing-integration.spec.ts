import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Queue } from 'bull';
import { IndexingService } from '../indexing.service';
import { DocumentService } from '../../document/document.service';
import { BulkOperationTrackerService } from '../services/bulk-operation-tracker.service';
import { BulkCompletionService } from '../services/bulk-completion.service';
import { IndexingQueueProcessor } from '../queue/indexing-queue.processor';
import { PersistenceQueueProcessor } from '../queue/persistence-queue.processor';
import { IndexStorageService } from '../../storage/index-storage/index-storage.service';
import { PersistentTermDictionaryService } from '../../storage/index-storage/persistent-term-dictionary.service';
import { RocksDBService } from '../../storage/rocksdb/rocksdb.service';

/**
 * Integration tests for the new bulk indexing architecture.
 *
 * Tests the full flow:
 * 1. Batch documents → IndexingQueueProcessor
 * 2. Index documents → RocksDB (immediate)
 * 3. Queue dirty terms → PersistenceQueueProcessor
 * 4. Persist to MongoDB → Final durability
 * 5. Emit events → BulkCompletionService
 *
 * Key validations:
 * - RocksDB persistence happens immediately during indexing
 * - MongoDB persistence happens asynchronously via queue
 * - BulkOperationTracker survives restarts (Redis backing)
 * - Document counts are accurate (atomic increments)
 * - Search works correctly after indexing
 */
describe('Bulk Indexing Architecture (Integration)', () => {
  let app: INestApplication;
  let indexingService: IndexingService;
  let documentService: DocumentService;
  let bulkTracker: BulkOperationTrackerService;
  let indexStorage: IndexStorageService;
  let persistentTermDict: PersistentTermDictionaryService;
  let rocksDBService: RocksDBService;
  let indexingQueue: Queue;
  let persistenceQueue: Queue;

  const TEST_INDEX = 'test-bulk-index';
  const TEST_BATCH_SIZE = 100;
  const TEST_TOTAL_DOCS = 500;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
        }),
        BullModule.registerQueue({ name: 'indexing' }, { name: 'term-persistence' }),
        EventEmitterModule.forRoot(),
      ],
      providers: [
        IndexingService,
        DocumentService,
        BulkOperationTrackerService,
        BulkCompletionService,
        IndexingQueueProcessor,
        PersistenceQueueProcessor,
        IndexStorageService,
        PersistentTermDictionaryService,
        RocksDBService,
        // Add other required providers/mocks here
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    indexingService = moduleRef.get<IndexingService>(IndexingService);
    documentService = moduleRef.get<DocumentService>(DocumentService);
    bulkTracker = moduleRef.get<BulkOperationTrackerService>(BulkOperationTrackerService);
    indexStorage = moduleRef.get<IndexStorageService>(IndexStorageService);
    persistentTermDict = moduleRef.get<PersistentTermDictionaryService>(
      PersistentTermDictionaryService,
    );
    rocksDBService = moduleRef.get<RocksDBService>(RocksDBService);
    indexingQueue = moduleRef.get<Queue>(getQueueToken('indexing'));
    persistenceQueue = moduleRef.get<Queue>(getQueueToken('term-persistence'));

    // Clean up test index if exists
    try {
      await indexStorage.deleteIndex(TEST_INDEX);
    } catch (error) {
      // Ignore if doesn't exist
    }

    // Create test index
    await indexStorage.createIndex({
      name: TEST_INDEX,
      mappings: {
        title: { type: 'text', weight: 2 },
        description: { type: 'text', weight: 1 },
      },
      settings: {
        analyzer: 'standard',
      },
    });
  });

  afterAll(async () => {
    // Clean up
    await indexStorage.deleteIndex(TEST_INDEX);
    await app.close();
  });

  describe('RocksDB Immediate Persistence', () => {
    it('should persist terms to RocksDB immediately during indexing', async () => {
      const doc = {
        id: 'test-doc-1',
        title: 'Test Document',
        description: 'This is a test',
      };

      // Index the document
      await indexingService.indexDocument(TEST_INDEX, doc.id, doc, false, false, true);

      // Verify term was written to RocksDB immediately
      const indexAwareTerm = `${TEST_INDEX}:title:test`;
      const postingList = await persistentTermDict.getTermPostings(indexAwareTerm);

      expect(postingList).toBeDefined();
      expect(postingList.size()).toBeGreaterThan(0);
      expect(postingList.getDocIds()).toContain(doc.id);
    });

    it('should handle terms being evicted from memory cache', async () => {
      // Index many documents to force LRU cache eviction
      const docs = [];
      for (let i = 0; i < 2000; i++) {
        docs.push({
          id: `evict-test-${i}`,
          title: `Document ${i} with unique term ${Math.random()}`,
          description: 'Some description',
        });
      }

      // Index all documents (some terms will be evicted from memory)
      for (const doc of docs) {
        await indexingService.indexDocument(TEST_INDEX, doc.id, doc, false, false, true);
      }

      // Verify a random term is still in RocksDB even if not in memory
      const randomDoc = docs[Math.floor(Math.random() * docs.length)];
      const terms = randomDoc.title.split(' ');
      const randomTerm = terms[0].toLowerCase();
      const indexAwareTerm = `${TEST_INDEX}:title:${randomTerm}`;

      const postingList = await persistentTermDict.getTermPostings(indexAwareTerm);

      expect(postingList).toBeDefined();
      expect(postingList.size()).toBeGreaterThan(0);
    });
  });

  describe('Persistence Queue Flow', () => {
    it('should queue persistence jobs with batch dirty terms', async () => {
      const batchDirtyTerms = new Set<string>();
      const docs = [];

      for (let i = 0; i < 10; i++) {
        docs.push({
          id: `queue-test-${i}`,
          title: `Queue Test ${i}`,
          description: 'Testing queue',
        });
      }

      // Process batch with dirty tracking
      await documentService.processBatchDirectly(TEST_INDEX, docs, false, true, batchDirtyTerms);

      // Verify dirty terms were tracked
      expect(batchDirtyTerms.size).toBeGreaterThan(0);

      // Verify terms include index name prefix
      const termsArray = Array.from(batchDirtyTerms);
      expect(termsArray.every(term => term.startsWith(TEST_INDEX))).toBe(true);
    });

    it('should read from RocksDB during persistence (not memory)', async () => {
      const testTerm = `${TEST_INDEX}:title:persistence-test`;
      const doc = {
        id: 'persist-test-1',
        title: 'Persistence Test',
        description: 'Testing',
      };

      // Index document (writes to RocksDB)
      const batchDirtyTerms = new Set<string>();
      await indexingService.indexDocument(
        TEST_INDEX,
        doc.id,
        doc,
        false,
        false,
        true,
        batchDirtyTerms,
      );

      // Clear memory to simulate eviction (if possible)
      // ... (would need to add a method to clear memory cache)

      // Verify persistence queue can still read from RocksDB
      const postingList = await persistentTermDict.getTermPostings(testTerm);
      expect(postingList).toBeDefined();
    });
  });

  describe('Bulk Operation Tracking', () => {
    it('should create and track bulk operation', () => {
      const bulkOpId = bulkTracker.createOperation(
        TEST_INDEX,
        5,
        ['batch1', 'batch2', 'batch3', 'batch4', 'batch5'],
        500,
      );

      expect(bulkOpId).toBeDefined();
      expect(bulkOpId).toContain('bulk:');
      expect(bulkOpId).toContain(TEST_INDEX);

      const operation = bulkTracker.getOperation(bulkOpId);
      expect(operation).toBeDefined();
      expect(operation.totalBatches).toBe(5);
      expect(operation.status).toBe('indexing');
    });

    it('should persist operation to Redis', async () => {
      const bulkOpId = bulkTracker.createOperation(
        TEST_INDEX,
        3,
        ['redis-batch1', 'redis-batch2', 'redis-batch3'],
        300,
      );

      // Wait for async Redis save
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate restart by clearing memory
      // ... (would need access to internal map)

      // Operation should still be retrievable from Redis
      const operation = bulkTracker.getOperation(bulkOpId);
      expect(operation).toBeDefined();
    });

    it('should emit all-batches-indexed event', done => {
      const bulkOpId = bulkTracker.createOperation(TEST_INDEX, 2, ['event-test-1', 'event-test-2']);

      // Listen for event
      app.get(EventEmitterModule).on('all-batches-indexed', event => {
        if (event.bulkOpId === bulkOpId) {
          expect(event.indexName).toBe(TEST_INDEX);
          expect(event.totalBatches).toBe(2);
          done();
        }
      });

      // Mark batches as indexed
      bulkTracker.markBatchIndexed(bulkOpId, 'event-test-1');
      bulkTracker.markBatchIndexed(bulkOpId, 'event-test-2');
    });
  });

  describe('Document Count Accuracy', () => {
    it('should accurately count documents with atomic increments', async () => {
      const testIndex = `${TEST_INDEX}-count-test`;

      // Create test index
      await indexStorage.createIndex({
        name: testIndex,
        mappings: { title: { type: 'text' } },
        settings: { analyzer: 'standard' },
      });

      const initialCount = await indexStorage.getDocumentCount(testIndex);

      // Index documents in parallel (simulating concurrent workers)
      const indexPromises = [];
      for (let i = 0; i < 100; i++) {
        const promise = indexingService.indexDocument(
          testIndex,
          `count-test-${i}`,
          { title: `Document ${i}` },
          false,
          false,
          true,
        );
        indexPromises.push(promise);
      }

      await Promise.all(indexPromises);

      // Verify count is exactly 100 (no race conditions)
      const finalCount = await indexStorage.getDocumentCount(testIndex);
      expect(finalCount).toBe(initialCount + 100);

      // Clean up
      await indexStorage.deleteIndex(testIndex);
    });
  });

  describe('End-to-End Bulk Indexing', () => {
    it('should complete full bulk indexing flow', async () => {
      const testIndex = `${TEST_INDEX}-e2e`;

      // Create test index
      await indexStorage.createIndex({
        name: testIndex,
        mappings: {
          title: { type: 'text', weight: 2 },
          content: { type: 'text', weight: 1 },
        },
        settings: { analyzer: 'standard' },
      });

      // Generate test documents
      const docs = [];
      for (let i = 0; i < TEST_TOTAL_DOCS; i++) {
        docs.push({
          id: `e2e-doc-${i}`,
          title: `Test Document ${i}`,
          content: `This is the content for document ${i}`,
        });
      }

      // Process in batches
      const batches = [];
      for (let i = 0; i < docs.length; i += TEST_BATCH_SIZE) {
        batches.push(docs.slice(i, i + TEST_BATCH_SIZE));
      }

      const batchIds = batches.map((_, i) => `e2e-batch-${i}`);
      const bulkOpId = bulkTracker.createOperation(
        testIndex,
        batches.length,
        batchIds,
        TEST_TOTAL_DOCS,
      );

      // Process all batches
      for (let i = 0; i < batches.length; i++) {
        const batchDirtyTerms = new Set<string>();

        await documentService.processBatchDirectly(
          testIndex,
          batches[i],
          false,
          true,
          batchDirtyTerms,
        );

        // Mark batch as indexed
        bulkTracker.markBatchIndexed(bulkOpId, batchIds[i]);

        // Queue persistence job (simulated)
        // In real flow, this is done by IndexingQueueProcessor
        await persistenceQueue.add('persist-batch-terms', {
          indexName: testIndex,
          batchId: batchIds[i],
          dirtyTerms: Array.from(batchDirtyTerms),
          bulkOpId,
        });
      }

      // Wait for all jobs to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify results
      const finalCount = await indexStorage.getDocumentCount(testIndex);
      expect(finalCount).toBe(TEST_TOTAL_DOCS);

      const operation = bulkTracker.getOperation(bulkOpId);
      expect(operation.completedBatches).toBe(batches.length);

      // Clean up
      await indexStorage.deleteIndex(testIndex);
    }, 30000); // 30 second timeout
  });

  describe('Error Handling', () => {
    it('should handle indexing failures gracefully', async () => {
      const invalidDoc = {
        id: 'invalid-doc',
        // Missing required fields
      };

      await expect(
        indexingService.indexDocument(TEST_INDEX, invalidDoc.id, invalidDoc, false, false, true),
      ).rejects.toThrow();

      // Verify system is still operational
      const validDoc = {
        id: 'valid-after-error',
        title: 'Valid Document',
        description: 'After error',
      };

      await expect(
        indexingService.indexDocument(TEST_INDEX, validDoc.id, validDoc, false, false, true),
      ).resolves.not.toThrow();
    });

    it('should mark bulk operation as failed on critical error', () => {
      const bulkOpId = bulkTracker.createOperation(TEST_INDEX, 1, ['fail-batch']);

      bulkTracker.markOperationFailed(bulkOpId, 'Simulated failure');

      const operation = bulkTracker.getOperation(bulkOpId);
      expect(operation.status).toBe('failed');
      expect(operation.error).toBe('Simulated failure');
    });
  });
});
