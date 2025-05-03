import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { IndexService } from '../index/index.service';
import { QueryProcessorService } from './query-processor.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SearchExecutorService } from './search-executor.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';

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
      processQuery: jest.fn().mockResolvedValue({
        indexName: 'test-index',
        parsedQuery: { type: 'term', field: 'title', value: 'test' },
        executionPlan: {
          steps: [
            {
              type: 'term',
              term: 'title:test',
              field: 'title',
              value: 'test',
            },
          ],
        },
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
