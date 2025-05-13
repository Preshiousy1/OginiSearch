import { Test, TestingModule } from '@nestjs/testing';
import { IndexingService } from './indexing.service';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { DocumentProcessorService } from '../document/document-processor.service';
import { IndexStatsService } from '../index/index-stats.service';
import {
  ProcessedDocument,
  ProcessedField,
} from '../document/interfaces/document-processor.interface';
import { InMemoryTermDictionary } from '../index/term-dictionary';

describe('IndexingService', () => {
  let service: IndexingService;
  let indexStorage: jest.Mocked<IndexStorageService>;
  let documentProcessor: jest.Mocked<DocumentProcessorService>;
  let indexStats: jest.Mocked<IndexStatsService>;
  let termDictionary: InMemoryTermDictionary;

  const mockProcessedDoc: ProcessedDocument = {
    id: 'doc123',
    source: { title: 'Test Document', content: 'This is a test' },
    fields: {
      title: {
        original: 'Test Document',
        terms: ['test', 'document'],
        termFrequencies: { test: 1, document: 1 },
        length: 2,
        positions: { test: [0], document: [1] },
      } as ProcessedField,
      content: {
        original: 'This is a test',
        terms: ['this', 'is', 'a', 'test'],
        termFrequencies: { this: 1, is: 1, a: 1, test: 1 },
        length: 4,
        positions: { this: [0], is: [1], a: [2], test: [3] },
      } as ProcessedField,
    },
    fieldLengths: { title: 2, content: 4 },
  };

  beforeEach(async () => {
    termDictionary = new InMemoryTermDictionary({ persistToDisk: false });
    await termDictionary.onModuleInit();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexingService,
        {
          provide: IndexStorageService,
          useFactory: () => ({
            storeProcessedDocument: jest.fn(),
            getProcessedDocument: jest.fn(),
            deleteProcessedDocument: jest.fn(),
            getTermPostings: jest.fn(),
            storeTermPostings: jest.fn(),
            deleteTermPostings: jest.fn(),
            getAllDocuments: jest.fn(),
            clearIndex: jest.fn(),
            getIndex: jest.fn().mockImplementation(name => ({
              name,
              documentCount: 0,
              settings: {},
              mappings: {},
              status: 'open',
            })),
            updateIndex: jest.fn(),
          }),
        },
        {
          provide: DocumentProcessorService,
          useFactory: () => ({
            processDocument: jest.fn(),
          }),
        },
        {
          provide: IndexStatsService,
          useFactory: () => ({
            updateDocumentStats: jest.fn(),
            updateTermStats: jest.fn(),
          }),
        },
        {
          provide: 'TERM_DICTIONARY',
          useValue: termDictionary,
        },
      ],
    }).compile();

    service = module.get<IndexingService>(IndexingService);
    indexStorage = module.get(IndexStorageService) as jest.Mocked<IndexStorageService>;
    documentProcessor = module.get(
      DocumentProcessorService,
    ) as jest.Mocked<DocumentProcessorService>;
    indexStats = module.get(IndexStatsService) as jest.Mocked<IndexStatsService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('indexDocument', () => {
    const indexName = 'test-index';
    const documentId = 'doc123';
    const document = { title: 'Test Document', content: 'This is a test' };

    beforeEach(() => {
      // Set up mocks
      documentProcessor.processDocument.mockReturnValue(mockProcessedDoc);
      indexStorage.getTermPostings.mockResolvedValue(new Map());
    });

    it('should process document and store it', async () => {
      await service.indexDocument(indexName, documentId, document);

      // Check document was processed
      expect(documentProcessor.processDocument).toHaveBeenCalledWith({
        id: documentId,
        source: document,
      });

      // Check processed document was stored
      expect(indexStorage.storeProcessedDocument).toHaveBeenCalledWith(indexName, mockProcessedDoc);
    });

    it('should update the inverted index for each term', async () => {
      await service.indexDocument(indexName, documentId, document);

      // Check term postings for title:test
      expect(indexStorage.storeTermPostings).toHaveBeenCalledWith(
        indexName,
        'title:test',
        expect.any(Map),
      );

      // Check term postings for title:document
      expect(indexStorage.storeTermPostings).toHaveBeenCalledWith(
        indexName,
        'title:document',
        expect.any(Map),
      );

      // Check total number of terms indexed (6 unique terms + 6 _all field terms = 12)
      expect(indexStorage.storeTermPostings).toHaveBeenCalledTimes(12);
    });

    it('should update index statistics', async () => {
      await service.indexDocument(indexName, documentId, document);

      // Check document stats are updated
      expect(indexStats.updateDocumentStats).toHaveBeenCalledWith(
        documentId,
        mockProcessedDoc.fieldLengths,
      );

      // Check term stats are updated for each term
      expect(indexStats.updateTermStats).toHaveBeenCalledTimes(6); // 6 unique terms

      // Verify at least one specific term stat update
      expect(indexStats.updateTermStats).toHaveBeenCalledWith('title:test', documentId);
    });
  });

  describe('removeDocument', () => {
    const indexName = 'test-index';
    const documentId = 'doc123';

    beforeEach(() => {
      // Set up mocks for removal
      indexStorage.getProcessedDocument.mockResolvedValue(mockProcessedDoc);

      // This setup ensures all postings will be empty after removal
      indexStorage.getTermPostings.mockImplementation(async (index, fieldTerm) => {
        const map = new Map();
        map.set(documentId, [0]); // Mock position
        return map;
      });
    });

    it('should remove document from all term posting lists', async () => {
      await service.removeDocument(indexName, documentId);

      // Check all terms were retrieved (6 unique terms + 6 _all field terms = 12)
      expect(indexStorage.getTermPostings).toHaveBeenCalledTimes(12);

      // All postings should be deleted because they're all empty after removal
      expect(indexStorage.deleteTermPostings).toHaveBeenCalledTimes(12);
    });

    it('should remove processed document from storage', async () => {
      await service.removeDocument(indexName, documentId);

      expect(indexStorage.deleteProcessedDocument).toHaveBeenCalledWith(indexName, documentId);
    });

    it('should update index statistics', async () => {
      await service.removeDocument(indexName, documentId);

      // Check document stats are updated with removal flag
      expect(indexStats.updateDocumentStats).toHaveBeenCalledWith(documentId, {}, true);
    });

    it('should handle non-existent documents gracefully', async () => {
      indexStorage.getProcessedDocument.mockResolvedValue(null);

      await service.removeDocument(indexName, 'nonexistent-doc');

      // Should not attempt to remove terms or update stats
      expect(indexStorage.getTermPostings).not.toHaveBeenCalled();
      expect(indexStorage.deleteProcessedDocument).not.toHaveBeenCalled();
      expect(indexStats.updateDocumentStats).not.toHaveBeenCalled();
    });

    it('should update the posting list if other documents still contain the term', async () => {
      // Setup: Make one term appear in multiple documents
      let allFieldCallCount = 0;
      indexStorage.getTermPostings.mockImplementation(async (index, fieldTerm) => {
        const map = new Map();
        map.set(documentId, [0]); // Doc being removed

        // Only add another document to the first term and its _all field version
        if (
          fieldTerm === 'title:test' ||
          fieldTerm === 'content:test' ||
          (fieldTerm === '_all:test' && allFieldCallCount++ === 0) // Only return other doc on first _all:test call
        ) {
          map.set('otherDoc', [1, 2]); // Another doc with the same term
        }

        return map;
      });

      await service.removeDocument(indexName, documentId);

      // Should have deleted 9 terms completely (4 field terms - title:test, content:test + 4 _all terms - _all:test)
      // and updated 3 (title:test, content:test, _all:test)
      expect(indexStorage.deleteTermPostings).toHaveBeenCalledTimes(9);
      expect(indexStorage.storeTermPostings).toHaveBeenCalledTimes(3);
      expect(indexStorage.storeTermPostings).toHaveBeenCalledWith(
        indexName,
        'title:test',
        expect.any(Map),
      );
      expect(indexStorage.storeTermPostings).toHaveBeenCalledWith(
        indexName,
        'content:test',
        expect.any(Map),
      );
      expect(indexStorage.storeTermPostings).toHaveBeenCalledWith(
        indexName,
        '_all:test',
        expect.any(Map),
      );
    });
  });

  describe('updateAll', () => {
    const indexName = 'test-index';
    const documents = [
      { id: 'doc1', source: { title: 'Doc 1' } },
      { id: 'doc2', source: { title: 'Doc 2' } },
    ];

    beforeEach(() => {
      indexStorage.getAllDocuments.mockResolvedValue(documents);
      documentProcessor.processDocument.mockReturnValue({
        ...mockProcessedDoc,
        id: 'mock-id', // Will be overridden in the actual call
      });
    });

    it('should rebuild the entire index', async () => {
      await service.updateAll(indexName);

      // Check index was cleared first
      expect(indexStorage.clearIndex).toHaveBeenCalledWith(indexName);

      // Check all documents were reindexed
      expect(indexStorage.getAllDocuments).toHaveBeenCalledWith(indexName);

      // Should have called indexDocument for each document
      expect(documentProcessor.processDocument).toHaveBeenCalledTimes(2);

      // Verify specific document indexing
      expect(documentProcessor.processDocument).toHaveBeenCalledWith({
        id: 'doc1',
        source: { title: 'Doc 1' },
      });
      expect(documentProcessor.processDocument).toHaveBeenCalledWith({
        id: 'doc2',
        source: { title: 'Doc 2' },
      });
    });
  });
});
