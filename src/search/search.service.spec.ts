import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { IndexService } from '../index/index.service';
import { QueryProcessorService } from './query-processor.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SearchExecutorService } from './search-executor.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { QueryProcessor, RawQuery } from './interfaces/query-processor.interface';
import { IndexStorageService } from 'src/storage/index-storage/index-storage.service';
import { DocumentStorageService } from 'src/storage/document-storage/document-storage.service';

describe('SearchService', () => {
  let service: SearchService;
  let indexService: Partial<IndexService>;
  let queryProcessor: Partial<QueryProcessorService>;
  let searchExecutor: Partial<SearchExecutorService>;
  let mockTermDictionary: Partial<InMemoryTermDictionary>;

  beforeEach(async () => {
    // Mock for IndexService
    indexService = {
      getIndex: jest.fn().mockImplementation(name => {
        if (name === 'test-index') {
          return {
            name,
            createdAt: new Date(),
            documentCount: 10,
            settings: {},
            mappings: { properties: {} },
            status: 'open',
          };
        }
        throw new NotFoundException(`Index ${name} not found`);
      }),
    };

    // Mock for QueryProcessorService
    queryProcessor = {
      processQuery: jest.fn().mockImplementation((rawQuery: RawQuery) => {
        return {
          original: rawQuery,
          parsedQuery: {
            type: 'term',
            field: 'title',
            value: 'test',
            text:
              typeof rawQuery.query === 'string'
                ? rawQuery.query
                : rawQuery.query.match?.value || '',
          },
          executionPlan: {
            steps: [
              {
                type: 'term',
                term: 'title:test',
                field: 'title',
                value: 'test',
                cost: 1,
                estimatedResults: 2,
              },
            ],
            totalCost: 1,
            estimatedResults: 2,
          },
        };
      }),
    };

    // Mock for SearchExecutorService
    searchExecutor = {
      executeQuery: jest.fn().mockResolvedValue({
        totalHits: 2,
        maxScore: 1.5,
        hits: [
          {
            id: 'doc1',
            score: 1.5,
            document: { title: 'Test Document 1', content: 'This is a test document' },
          },
          {
            id: 'doc2',
            score: 1.0,
            document: { title: 'Test Document 2', content: 'Another test document' },
          },
        ],
      }),
    };

    // Mock for TermDictionary
    mockTermDictionary = {
      getTerms: jest
        .fn()
        .mockReturnValue(['title:test', 'title:document', 'content:test', 'title:another']),
      getPostingList: jest.fn().mockImplementation(term => ({
        size: () => (term === 'title:test' ? 2 : term === 'content:test' ? 3 : 1),
        getAll: () => [],
      })),
      addTerm: jest.fn(),
      hasTerm: jest.fn(),
      removeTerm: jest.fn(),
      serialize: jest.fn(),
      deserialize: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: IndexService,
          useValue: indexService,
        },
        {
          provide: QueryProcessorService,
          useValue: queryProcessor,
        },
        {
          provide: SearchExecutorService,
          useValue: searchExecutor,
        },
        {
          provide: 'TERM_DICTIONARY',
          useValue: mockTermDictionary,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    queryProcessor = module.get<QueryProcessorService>(QueryProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should search documents in an index', async () => {
      const searchQuery = {
        query: 'test',
        fields: ['title', 'content'],
        from: 0,
        size: 10,
      };

      const result = await service.search('test-index', searchQuery);

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.data.total).toBe(2);
      expect(result.data.maxScore).toBe(1.5);
      expect(result.data.hits).toHaveLength(2);
      expect(queryProcessor.processQuery).toHaveBeenCalledWith({
        query: 'test',
        fields: ['title', 'content'],
        offset: 0,
        limit: 10,
        filters: undefined,
      });
      expect(searchExecutor.executeQuery).toHaveBeenCalled();
    });

    it('should include highlights when requested', async () => {
      const searchQuery = {
        query: 'test',
        fields: ['title'],
        highlight: true,
      };

      const result = await service.search('test-index', searchQuery);

      expect(result.data.hits[0].highlight).toBeDefined();
    });

    it('should throw if index does not exist', async () => {
      const searchQuery = {
        query: 'test',
      };

      await expect(service.search('non-existent-index', searchQuery)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should process object query format', async () => {
      const indexName = 'test-index';
      const searchQuery = {
        query: {
          match: {
            field: 'title',
            value: 'test',
          },
        },
        fields: ['title', 'description'],
      };

      // Execute
      const result = await service.search(indexName, searchQuery);

      // Verify
      expect(queryProcessor.processQuery).toHaveBeenCalledWith({
        query: searchQuery.query,
        fields: searchQuery.fields,
        offset: undefined,
        limit: undefined,
        filters: undefined,
      });
      expect(result.data.hits.length).toBe(2);
    });

    it('should handle string query format for backward compatibility', async () => {
      const indexName = 'test-index';
      const searchQuery = {
        query: 'test',
        fields: ['title', 'description'],
      };

      // Execute
      const result = await service.search(indexName, searchQuery);

      // Verify
      expect(queryProcessor.processQuery).toHaveBeenCalledWith({
        query: 'test',
        fields: ['title', 'description'],
        offset: undefined,
        limit: undefined,
        filters: undefined,
      });
      expect(result.data.hits.length).toBe(2);
    });
  });

  describe('suggest', () => {
    it('should return suggestions for a prefix', async () => {
      const suggestQuery = {
        text: 'te',
        field: 'title',
        size: 5,
      };

      const result = await service.suggest('test-index', suggestQuery);

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Array);
      expect(mockTermDictionary.getTerms).toHaveBeenCalled();
    });

    it('should throw if index does not exist', async () => {
      const suggestQuery = {
        text: 'test',
      };

      await expect(service.suggest('non-existent-index', suggestQuery)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
