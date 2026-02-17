import { Test, TestingModule } from '@nestjs/testing';
import { SearchExecutorService } from './search-executor.service';
import { PostingList } from '../index/interfaces/posting.interface';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexStatsService } from '../index/index-stats.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { TermPostingsRepository } from '../storage/mongodb/repositories/term-postings.repository';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { QueryExecutionPlan, TermQueryStep } from './interfaces/query-processor.interface';
import { InMemoryTermDictionary } from 'src/index/term-dictionary';

describe('SearchExecutorService', () => {
  let service: SearchExecutorService;
  let mockTermDictionary: Partial<InMemoryTermDictionary>;
  let mockDocumentStorage: Partial<DocumentStorageService>;
  let mockIndexStats: Partial<IndexStatsService>;

  beforeEach(async () => {
    // Mock posting entries
    const createPosting = (docId: string, freq: number, positions: number[]) => ({
      documentId: docId,
      docId: docId,
      frequency: freq,
      positions,
    });

    // Create mock posting lists
    const createPostingList = (postings: any[]) => ({
      size: () => postings.length,
      getAll: () => postings,
      getEntry: (docId: string) => postings.find(p => p.documentId === docId),
      has: (docId: string) => postings.some(p => p.documentId === docId),
      getEntries: () => postings,
      addEntry: jest.fn(),
      removeEntry: jest.fn(),
      serialize: jest.fn(),
      deserialize: jest.fn(),
    });

    // Sample postings for testing
    const titleSearchPostings = [
      createPosting('doc1', 2, [1, 5]),
      createPosting('doc2', 1, [1]),
      createPosting('doc5', 3, [1, 4, 7]),
    ];

    const contentSearchPostings = [
      createPosting('doc1', 1, [10]),
      createPosting('doc3', 2, [3, 15]),
      createPosting('doc4', 4, [2, 7, 12, 18]),
    ];

    const titleEnginePostings = [createPosting('doc1', 1, [2]), createPosting('doc5', 1, [2])];

    // Create mock term dictionary (executor uses getPostingListForIndex(indexName, term))
    const getListForTerm = (term: string) => {
      const postings = {
        'title:search': titleSearchPostings,
        'content:search': contentSearchPostings,
        'title:engine': titleEnginePostings,
      }[term];
      return postings ? createPostingList(postings) : null;
    };
    mockTermDictionary = {
      getTerms: jest.fn(() => ['title:search', 'content:search', 'title:engine']),
      getPostingList: jest.fn(async (term: string) => getListForTerm(term)),
      getPostingListForIndex: jest.fn(async (_indexName: string, term: string) => getListForTerm(term)),
      serialize: jest.fn(),
      deserialize: jest.fn(),
    };

    // Create mock document storage
    mockDocumentStorage = {
      getDocuments: jest.fn(async (indexName: string, options: any = {}) => {
        const docs = {
          doc1: { title: 'Search Engine', content: 'A document about search' },
          doc2: { title: 'Search Techniques', content: 'Various search methods' },
          doc3: { title: 'Algorithms', content: 'Includes search algorithms' },
          doc4: { title: 'Data Structures', content: 'Ways to search data efficiently' },
          doc5: { title: 'Modern Search Engine', content: 'Current search technology' },
        };

        // Get docIds from filter if provided, or use all keys
        const docIds = options.filter?.ids || Object.keys(docs);

        const documents = docIds.map(id => ({
          indexName,
          documentId: id,
          content: docs[id] || { title: 'Unknown', content: 'Not found' },
          metadata: {},
        }));

        return {
          documents,
          total: documents.length,
        };
      }),
      storeDocument: jest.fn(),
      updateDocument: jest.fn(),
      deleteDocument: jest.fn(),
      bulkStoreDocuments: jest.fn(),
      bulkDeleteDocuments: jest.fn(),
      deleteAllDocumentsInIndex: jest.fn(),
    };

    // Create mock index stats
    mockIndexStats = {
      totalDocuments: 100,
      getDocumentFrequency: jest.fn((term: string) => {
        const freqs = {
          'title:search': 3,
          'content:search': 3,
          'title:engine': 2,
        };
        return freqs[term] || 0;
      }),
      getAverageFieldLength: jest.fn((field: string) => (field === 'title' ? 3 : 50)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchExecutorService,
        {
          provide: 'TERM_DICTIONARY',
          useValue: mockTermDictionary,
        },
        {
          provide: DocumentStorageService,
          useValue: mockDocumentStorage,
        },
        {
          provide: IndexStatsService,
          useValue: mockIndexStats,
        },
        {
          provide: AnalyzerRegistryService,
          useValue: {
            getAnalyzer: jest.fn(() => ({
              analyze: jest.fn((text: string) => {
                if (!text) return [];
                // "title:search" -> ["search"] so fieldTerm becomes "title:search"
                if (text.includes(':')) return [text.split(':').pop()!];
                return text.split(/\s+/).filter(Boolean);
              }),
            })),
          },
        },
        {
          provide: TermPostingsRepository,
          useValue: { findByIndexAwareTerm: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: IndexStorageService,
          useValue: {
            getIndex: jest.fn(),
            listIndices: jest.fn(),
            getProcessedDocument: jest.fn().mockResolvedValue(null),
            termPostingsRepository: { findByIndexAwareTerm: jest.fn().mockResolvedValue(null) },
          },
        },
      ],
    }).compile();

    service = module.get<SearchExecutorService>(SearchExecutorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeQuery', () => {
    it('should execute a simple term query plan', async () => {
      // Create a simple term query execution plan
      const queryPlan: QueryExecutionPlan = {
        steps: [
          {
            type: 'term',
            term: 'title:search',
            field: 'title',
            value: 'search',
            cost: 1,
            estimatedResults: 3,
          } as TermQueryStep,
        ],
        cost: 1,
        estimatedResults: 3,
      };

      const result = await service.executeQuery('test-index', queryPlan);

      // Verify results
      expect(result).toBeDefined();
      expect(result.totalHits).toBe(3);
      expect(result.hits.length).toBe(3);
      expect(mockTermDictionary.getPostingListForIndex).toHaveBeenCalledWith('test-index', 'title:search');
      expect(mockDocumentStorage.getDocuments).toHaveBeenCalled();
    });

    it('should apply pagination options', async () => {
      // Create a simple term query execution plan
      const queryPlan: QueryExecutionPlan = {
        steps: [
          {
            type: 'term',
            term: 'title:search',
            field: 'title',
            value: 'search',
            cost: 1,
            estimatedResults: 3,
          } as TermQueryStep,
        ],
        cost: 1,
        estimatedResults: 3,
      };

      const result = await service.executeQuery('test-index', queryPlan, { from: 1, size: 1 });

      // Verify pagination
      expect(result.totalHits).toBe(3); // Total hits still includes all matches
      expect(result.hits.length).toBe(1); // But only returns requested size
    });

    it('should handle an empty result set', async () => {
      // Override the mock to return an empty posting list
      jest.spyOn(mockTermDictionary, 'getPostingList').mockResolvedValue({
        size: () => 0,
        getAll: () => [],
        getEntries: () => [],
        getEntry: () => null,
        has: () => false,
        addEntry: jest.fn(),
        removeEntry: jest.fn(),
        serialize: jest.fn(),
        deserialize: jest.fn(),
      } as unknown as PostingList);

      const queryPlan: QueryExecutionPlan = {
        steps: [
          {
            type: 'term',
            term: 'title:nonexistent',
            field: 'title',
            value: 'nonexistent',
            cost: 1,
            estimatedResults: 0,
          } as TermQueryStep,
        ],
        cost: 1,
        estimatedResults: 0,
      };

      const result = await service.executeQuery('test-index', queryPlan);

      // Verify empty results handling
      expect(result.totalHits).toBe(0);
      expect(result.hits.length).toBe(0);
    });
  });

  describe('Chunked term postings (MongoDB fallback)', () => {
    it('should build PostingList from merged chunks when in-memory is empty', async () => {
      const largeEntryCount = 2000;
      const postings: Record<string, { docId: string; frequency: number; positions: number[] }> = {};
      for (let i = 0; i < largeEntryCount; i++) {
        postings[`doc-${i}`] = { docId: `doc-${i}`, frequency: 1, positions: [0] };
      }
      const mockMerged = {
        indexName: 'poc-index',
        term: 'poc-index:name:limited',
        postings,
        documentCount: largeEntryCount,
      };
      const mockTermPostingsRepo = {
        findByIndexAwareTerm: jest.fn().mockResolvedValue(mockMerged),
      };
      const emptyList = {
        size: () => 0,
        getEntries: () => [],
        getEntry: () => undefined,
        addEntry: jest.fn(),
        removeEntry: jest.fn(),
        serialize: jest.fn(),
        deserialize: jest.fn(),
      };
      const termDict = {
        getPostingListForIndex: jest.fn().mockResolvedValue(emptyList),
        getTerms: jest.fn().mockReturnValue([]),
      };

      const mod = await Test.createTestingModule({
        providers: [
          SearchExecutorService,
          { provide: 'TERM_DICTIONARY', useValue: termDict },
          { provide: DocumentStorageService, useValue: mockDocumentStorage },
          { provide: IndexStatsService, useValue: mockIndexStats },
          {
            provide: AnalyzerRegistryService,
            useValue: {
              getAnalyzer: jest.fn(() => ({
                analyze: jest.fn((t: string) => (t.includes(':') ? [t.split(':').pop()] : [t])),
              })),
            },
          },
          { provide: TermPostingsRepository, useValue: mockTermPostingsRepo },
          {
            provide: IndexStorageService,
            useValue: {
              getIndex: jest.fn(),
              listIndices: jest.fn(),
              getProcessedDocument: jest.fn().mockImplementation(async (_index: string, id: string) => ({
                source: { name: 'Limited', documentId: id },
              })),
              termPostingsRepository: { findByIndexAwareTerm: jest.fn().mockResolvedValue(null) },
            },
          },
        ],
      }).compile();

      const svc = mod.get<SearchExecutorService>(SearchExecutorService);
      (mockDocumentStorage.getDocuments as jest.Mock).mockImplementation(
        async (_index: string, opts: { filter?: { ids?: string[] } }) => {
          const ids = opts?.filter?.ids ?? [];
          return {
            documents: ids.map((id: string) => ({
              indexName: _index,
              documentId: id,
              content: { name: 'Limited' },
              metadata: {},
            })),
            total: ids.length,
          };
        },
      );

      const queryPlan: QueryExecutionPlan = {
        steps: [
          { type: 'term', term: 'name:limited', field: 'name', value: 'limited', cost: 1, estimatedResults: largeEntryCount } as TermQueryStep,
        ],
        cost: 1,
        estimatedResults: largeEntryCount,
      };

      const result = await svc.executeQuery('poc-index', queryPlan, { size: 10, from: 0 });

      expect(mockTermPostingsRepo.findByIndexAwareTerm).toHaveBeenCalledWith('poc-index:name:limited');
      expect(result.totalHits).toBe(largeEntryCount);
      expect(result.hits.length).toBeLessThanOrEqual(10);
    });
  });
});
