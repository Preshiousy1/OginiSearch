import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentService } from '../../src/document/document.service';
import { IndexService } from '../../src/index/index.service';
import { DocumentStorageService } from '../../src/storage/document-storage/document-storage.service';
import { IndexStorageService } from '../../src/storage/index-storage/index-storage.service';
import { IndexingService } from '../../src/indexing/indexing.service';
import { SearchService } from '../../src/search/search.service';
import { InMemoryTermDictionary } from '../../src/index/term-dictionary';
import { DocumentProcessorService } from '../../src/document/document-processor.service';
import { IndexStatsService } from '../../src/index/index-stats.service';
import { IndexDocumentDto } from '../../src/api/dtos/document.dto';
import { BulkIndexingService } from 'src/indexing/services/bulk-indexing.service';

describe('DocumentService Bulk Indexing Integration', () => {
  let app: INestApplication;
  let documentService: DocumentService;
  let bulkIndexingService: BulkIndexingService;
  let indexService: IndexService;
  let termDictionary: InMemoryTermDictionary;

  const testIndexName = 'document-bulk-test';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [
        DocumentService,
        BulkIndexingService,
        IndexService,
        DocumentStorageService,
        IndexStorageService,
        IndexingService,
        SearchService,
        DocumentProcessorService,
        IndexStatsService,
        {
          provide: 'TERM_DICTIONARY',
          useFactory: () => {
            const dict = new InMemoryTermDictionary({ persistToDisk: false });
            return dict;
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    documentService = moduleFixture.get<DocumentService>(DocumentService);
    bulkIndexingService = moduleFixture.get<BulkIndexingService>(BulkIndexingService);
    indexService = moduleFixture.get<IndexService>(IndexService);
    termDictionary = moduleFixture.get<InMemoryTermDictionary>('TERM_DICTIONARY');

    await termDictionary.onModuleInit();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test index if it exists
    try {
      await indexService.deleteIndex(testIndexName);
    } catch (error) {
      // Index might not exist, that's fine
    }

    // Create fresh test index
    await indexService.createIndex({
      name: testIndexName,
      settings: {
        numberOfShards: 1,
      },
      mappings: {
        dynamic: true,
        properties: {
          title: { type: 'text' },
          content: { type: 'text' },
          category: { type: 'keyword' },
        },
      },
    });

    // Clear any pending jobs
    await bulkIndexingService.cleanQueue();
  });

  afterEach(async () => {
    // Clean up
    try {
      await indexService.deleteIndex(testIndexName);
    } catch (error) {
      // Ignore cleanup errors
    }
    // Clear any pending jobs
    await bulkIndexingService.cleanQueue();
  });

  describe('bulkIndexDocuments delegation', () => {
    it('should successfully delegate to BulkIndexingService', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'bulk-doc-1',
          document: {
            title: 'Bulk Document 1',
            content: 'This is the content of bulk document 1',
            category: 'test',
          },
        },
        {
          id: 'bulk-doc-2',
          document: {
            title: 'Bulk Document 2',
            content: 'This is the content of bulk document 2',
            category: 'test',
          },
        },
        {
          id: 'bulk-doc-3',
          document: {
            title: 'Bulk Document 3',
            content: 'This is the content of bulk document 3',
            category: 'integration',
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      expect(result.successCount).toBe(3);
      expect(result.errors).toBe(false);
      expect(result.items).toHaveLength(3);
      expect(result.took).toBeGreaterThan(0);

      // Verify all items are successful
      result.items.forEach((item, index) => {
        expect(item.id).toBe(documents[index].id);
        expect(item.index).toBe(testIndexName);
        expect(item.success).toBe(true);
        expect(item.status).toBe(201);
        expect(item.error).toBeUndefined();
      });

      // Verify documents are actually indexed and retrievable
      for (const doc of documents) {
        const retrieved = await documentService.getDocument(testIndexName, doc.id!);
        expect(retrieved.found).toBe(true);
        expect(retrieved.id).toBe(doc.id);
        expect(retrieved.source.title).toBe(doc.document.title);
      }
    }, 15000);

    it('should handle empty document array', async () => {
      const result = await documentService.bulkIndexDocuments(testIndexName, []);

      expect(result.successCount).toBe(0);
      expect(result.errors).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.took).toBeGreaterThanOrEqual(0);
    });

    it('should auto-generate IDs for documents without IDs', async () => {
      const documents: IndexDocumentDto[] = [
        {
          document: {
            title: 'Auto ID Document 1',
            content: 'Content without explicit ID',
          },
        },
        {
          document: {
            title: 'Auto ID Document 2',
            content: 'Another document without ID',
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      expect(result.successCount).toBe(2);
      expect(result.errors).toBe(false);
      expect(result.items).toHaveLength(2);

      // Verify generated IDs are valid UUIDs
      result.items.forEach(item => {
        expect(item.id).toBeDefined();
        expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(item.success).toBe(true);
      });
    });

    it('should handle mixed ID scenarios', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'explicit-id',
          document: { title: 'Document with explicit ID' },
        },
        {
          document: { title: 'Document without ID' },
        },
        {
          id: 'another-explicit-id',
          document: { title: 'Another document with explicit ID' },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      expect(result.successCount).toBe(3);
      expect(result.items).toHaveLength(3);

      // Verify explicit IDs are preserved
      expect(result.items[0].id).toBe('explicit-id');
      expect(result.items[2].id).toBe('another-explicit-id');

      // Verify auto-generated ID for middle document
      expect(result.items[1].id).toBeDefined();
      expect(result.items[1].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('should handle BulkIndexingService errors gracefully', async () => {
      // Create a scenario that might cause errors (very large documents)
      const largeContent = 'x'.repeat(10000);
      const documents: IndexDocumentDto[] = [
        {
          id: 'large-doc-1',
          document: {
            title: 'Large Document 1',
            content: largeContent,
          },
        },
        {
          id: 'normal-doc',
          document: {
            title: 'Normal Document',
            content: 'Normal content',
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      // Should handle errors gracefully and still process what it can
      expect(result.items).toHaveLength(2);
      expect(result.successCount).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('should fall back to sequential processing on BulkIndexingService failure', async () => {
      // Mock a scenario where BulkIndexingService might fail
      const originalMethod = bulkIndexingService.queueBatchDocuments;

      // Temporarily replace the method to simulate failure
      bulkIndexingService.queueBatchDocuments = jest
        .fn()
        .mockRejectedValue(new Error('BulkIndexingService unavailable'));

      const documents: IndexDocumentDto[] = [
        {
          id: 'fallback-doc-1',
          document: { title: 'Fallback Document 1' },
        },
        {
          id: 'fallback-doc-2',
          document: { title: 'Fallback Document 2' },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      // Should fall back to sequential processing
      expect(result.successCount).toBe(2);
      expect(result.errors).toBe(false);
      expect(result.items).toHaveLength(2);

      // Restore original method
      bulkIndexingService.queueBatchDocuments = originalMethod;

      // Verify documents were still indexed via fallback
      const doc1 = await documentService.getDocument(testIndexName, 'fallback-doc-1');
      const doc2 = await documentService.getDocument(testIndexName, 'fallback-doc-2');
      expect(doc1.found).toBe(true);
      expect(doc2.found).toBe(true);
    }, 15000);
  });

  describe('auto field mapping detection', () => {
    it('should auto-detect field mappings during bulk indexing', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'mapping-test-1',
          document: {
            title: 'Mapping Test Document',
            description: 'This is a longer text that should be detected as text type',
            userId: 'user123',
            email: 'test@example.com',
            score: 95.5,
            rating: 4,
            isActive: true,
            tags: ['test', 'mapping', 'auto-detection'],
            publishedAt: '2023-12-01T10:00:00Z',
            metadata: {
              source: 'integration-test',
              nested: {
                value: 'nested-data',
              },
            },
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      expect(result.successCount).toBe(1);
      expect(result.errors).toBe(false);

      // Verify document is indexed and retrievable with all field types
      const doc = await documentService.getDocument(testIndexName, 'mapping-test-1');
      expect(doc.found).toBe(true);
      expect(doc.source.title).toBe('Mapping Test Document');
      expect(doc.source.score).toBe(95.5);
      expect(doc.source.rating).toBe(4);
      expect(doc.source.isActive).toBe(true);
      expect(doc.source.tags).toEqual(['test', 'mapping', 'auto-detection']);
      expect(doc.source.metadata.source).toBe('integration-test');
    });

    it('should handle complex nested objects in mapping detection', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'nested-test',
          document: {
            title: 'Nested Object Test',
            user: {
              id: 'user123',
              profile: {
                firstName: 'John',
                lastName: 'Doe',
                age: 30,
                preferences: {
                  theme: 'dark',
                  notifications: true,
                },
              },
            },
            metrics: {
              views: 1500,
              likes: 250,
              avgRating: 4.7,
            },
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      expect(result.successCount).toBe(1);

      const doc = await documentService.getDocument(testIndexName, 'nested-test');
      expect(doc.found).toBe(true);
      expect(doc.source.user.profile.firstName).toBe('John');
      expect(doc.source.metrics.views).toBe(1500);
      expect(doc.source.metrics.avgRating).toBe(4.7);
    });
  });

  describe('performance optimization', () => {
    it('should use optimized settings for bulk operations', async () => {
      const startTime = Date.now();

      const documents: IndexDocumentDto[] = Array.from({ length: 100 }, (_, i) => ({
        id: `perf-doc-${i}`,
        document: {
          title: `Performance Document ${i}`,
          content: `Content for performance testing document number ${i}`,
          index: i,
          category: i % 2 === 0 ? 'even' : 'odd',
        },
      }));

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.successCount).toBe(100);
      expect(result.errors).toBe(false);
      expect(duration).toBeLessThan(15000); // Should complete within 15 seconds

      console.log(`Bulk indexed 100 documents in ${duration}ms`);
      console.log(`Average rate: ${(100 / (duration / 1000)).toFixed(2)} docs/second`);
    }, 20000);

    it('should handle large document batches efficiently', async () => {
      const documents: IndexDocumentDto[] = Array.from({ length: 500 }, (_, i) => ({
        id: `large-batch-${i}`,
        document: {
          title: `Large Batch Document ${i}`,
          content: 'Lorem ipsum '.repeat(100), // Larger content per document
          metadata: {
            batchNumber: Math.floor(i / 50),
            position: i,
            timestamp: new Date().toISOString(),
          },
        },
      }));

      const startTime = Date.now();
      const result = await documentService.bulkIndexDocuments(testIndexName, documents);
      const duration = Date.now() - startTime;

      expect(result.successCount).toBe(500);
      expect(result.errors).toBe(false);
      expect(duration).toBeLessThan(60000); // Should complete within 1 minute

      // Verify random sampling of documents
      const sampledDoc = await documentService.getDocument(testIndexName, 'large-batch-250');
      expect(sampledDoc.found).toBe(true);
      expect(sampledDoc.source.metadata.position).toBe(250);

      console.log(`Bulk indexed 500 documents in ${duration}ms`);
      console.log(`Average rate: ${(500 / (duration / 1000)).toFixed(2)} docs/second`);
    }, 70000);
  });

  describe('error handling and recovery', () => {
    it('should handle index not found errors', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'test-doc',
          document: { title: 'Test Document' },
        },
      ];

      await expect(
        documentService.bulkIndexDocuments('non-existent-index', documents),
      ).rejects.toThrow('Index non-existent-index not found');
    });

    it('should handle malformed documents gracefully', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'good-doc',
          document: { title: 'Good Document', content: 'Valid content' },
        },
        {
          id: 'problematic-doc',
          document: {
            title: null as any, // Invalid data type
            content: undefined as any,
          },
        },
        {
          id: 'another-good-doc',
          document: { title: 'Another Good Document' },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      // Should process valid documents and handle invalid ones
      expect(result.items).toHaveLength(3);
      expect(result.successCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('compatibility with existing API', () => {
    it('should maintain backward compatibility with existing bulk API format', async () => {
      const documents: IndexDocumentDto[] = [
        {
          id: 'compat-1',
          document: {
            title: 'Compatibility Document 1',
            content: 'Testing backward compatibility',
          },
        },
        {
          id: 'compat-2',
          document: {
            title: 'Compatibility Document 2',
            content: 'More compatibility testing',
          },
        },
      ];

      const result = await documentService.bulkIndexDocuments(testIndexName, documents);

      // Should return the expected format
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('took');
      expect(result).toHaveProperty('successCount');
      expect(result).toHaveProperty('errors');

      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.took).toBe('number');
      expect(typeof result.successCount).toBe('number');
      expect(typeof result.errors).toBe('boolean');

      // Items should have the expected structure
      result.items.forEach(item => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('index');
        expect(item).toHaveProperty('success');
        expect(item).toHaveProperty('status');
      });
    });

    it('should work with existing single document indexing', async () => {
      // Test that single document indexing still works after bulk enhancements
      const singleDoc: IndexDocumentDto = {
        id: 'single-doc',
        document: {
          title: 'Single Document Test',
          content: 'Testing single document indexing',
        },
      };

      const result = await documentService.indexDocument(testIndexName, singleDoc);

      expect(result.id).toBe('single-doc');
      expect(result.index).toBe(testIndexName);
      expect(result.found).toBe(true);
      expect(result.source.title).toBe('Single Document Test');

      // Verify it's retrievable
      const retrieved = await documentService.getDocument(testIndexName, 'single-doc');
      expect(retrieved.found).toBe(true);
      expect(retrieved.source.title).toBe('Single Document Test');
    });
  });
});
