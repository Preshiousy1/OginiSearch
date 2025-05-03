import { Test, TestingModule } from '@nestjs/testing';
import { QueryProcessorService } from './query-processor.service';
import { QueryPlannerService } from './query-planner.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { Analyzer } from '../analysis/interfaces/analyzer.interface';
import { TermQuery, PhraseQuery } from './interfaces/query-processor.interface';

// Mock analyzer for testing
class MockAnalyzer implements Analyzer {
  analyze(text: string): string[] {
    return text
      .toLowerCase()
      .split(' ')
      .filter(t => t.length > 0);
  }

  getName(): string {
    return 'standard';
  }

  getTokenizer(): any {
    return { type: 'whitespace' };
  }

  getFilters(): any[] {
    return [{ type: 'lowercase' }];
  }
}

describe('QueryProcessorService', () => {
  let service: QueryProcessorService;
  let mockAnalyzerRegistryService: Partial<AnalyzerRegistryService>;
  let mockQueryPlanner: Partial<QueryPlannerService>;

  beforeEach(async () => {
    // Create mock analyzer registry
    mockAnalyzerRegistryService = {
      getAnalyzer: jest.fn((name: string) => {
        return new MockAnalyzer();
      }),
      hasAnalyzer: jest.fn((name: string) => true),
    };

    // Create mock query planner
    mockQueryPlanner = {
      createPlan: jest.fn(query => ({
        steps: [
          {
            type: 'boolean',
            operator: 'or',
            steps: [],
            cost: 10,
            estimatedResults: 100,
          },
        ],
        totalCost: 10,
        estimatedResults: 100,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryProcessorService,
        {
          provide: AnalyzerRegistryService,
          useValue: mockAnalyzerRegistryService,
        },
        {
          provide: QueryPlannerService,
          useValue: mockQueryPlanner,
        },
      ],
    }).compile();

    service = module.get<QueryProcessorService>(QueryProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should normalize query text', () => {
    const result = service.processQuery({ query: '  Hello  WORLD  ' });

    // Query text should be normalized
    expect(result.original.query).toBe('  Hello  WORLD  ');
    expect(result.parsedQuery.type).toBe('boolean');

    if (result.parsedQuery.type === 'boolean') {
      expect(result.parsedQuery.clauses.length).toBe(2);
      expect(result.parsedQuery.clauses[0].type).toBe('term');

      if (result.parsedQuery.clauses[0].type === 'term') {
        const termQuery = result.parsedQuery.clauses[0] as TermQuery;
        expect(termQuery.value).toBe('hello');
      }

      if (result.parsedQuery.clauses[1].type === 'term') {
        const termQuery = result.parsedQuery.clauses[1] as TermQuery;
        expect(termQuery.value).toBe('world');
      }
    }
  });

  it('should process a single term query', () => {
    const result = service.processQuery({ query: 'search', fields: ['title'] });

    expect(result.parsedQuery.type).toBe('term');

    if (result.parsedQuery.type === 'term') {
      const termQuery = result.parsedQuery as TermQuery;
      expect(termQuery.field).toBe('title');
      expect(termQuery.value).toBe('search');
    }
  });

  it('should process a multiple term query', () => {
    const result = service.processQuery({ query: 'search engine', fields: ['title'] });

    expect(result.parsedQuery.type).toBe('boolean');

    if (result.parsedQuery.type === 'boolean') {
      const clauses = result.parsedQuery.clauses;
      expect(clauses.length).toBe(2);

      const firstClause = clauses[0] as TermQuery;
      const secondClause = clauses[1] as TermQuery;

      expect(firstClause.type).toBe('term');
      expect(firstClause.value).toBe('search');

      expect(secondClause.type).toBe('term');
      expect(secondClause.value).toBe('engine');
    }
  });

  it('should extract phrases from query', () => {
    const result = service.processQuery({
      query: 'title "search engine" functionality',
      fields: ['content'],
    });

    expect(result.parsedQuery.type).toBe('boolean');

    if (result.parsedQuery.type === 'boolean') {
      const clauses = result.parsedQuery.clauses;
      expect(clauses.length).toBe(3); // 2 terms + 1 phrase

      // Find the phrase query
      const phraseQuery = clauses.find(clause => clause.type === 'phrase');
      expect(phraseQuery).toBeDefined();

      if (phraseQuery && phraseQuery.type === 'phrase') {
        const typedPhraseQuery = phraseQuery as PhraseQuery;
        expect(typedPhraseQuery.field).toBe('content');
        expect(typedPhraseQuery.terms).toEqual(['search', 'engine']);
      }

      // Check term queries
      const termQueries = clauses.filter(clause => clause.type === 'term') as TermQuery[];
      expect(termQueries.length).toBe(2);

      const termValues = termQueries.map(q => q.value);
      expect(termValues).toContain('title');
      expect(termValues).toContain('functionality');
    }
  });

  it('should search across multiple fields', () => {
    const result = service.processQuery({ query: 'search', fields: ['title', 'content'] });

    expect(result.parsedQuery.type).toBe('boolean');

    if (result.parsedQuery.type === 'boolean') {
      const clauses = result.parsedQuery.clauses;
      expect(clauses.length).toBe(2); // same term in 2 fields

      if (clauses[0].type === 'term' && clauses[1].type === 'term') {
        const firstClause = clauses[0] as TermQuery;
        const secondClause = clauses[1] as TermQuery;

        expect(firstClause.field).toBe('title');
        expect(firstClause.value).toBe('search');

        expect(secondClause.field).toBe('content');
        expect(secondClause.value).toBe('search');
      }
    }
  });

  it('should apply analyzer to query terms', () => {
    // Verify analyzer was called
    service.processQuery({ query: 'SEARCH', fields: ['title'] });

    expect(mockAnalyzerRegistryService.getAnalyzer).toHaveBeenCalledWith('standard');
  });

  it('should create execution plan', () => {
    service.processQuery({ query: 'search', fields: ['title'] });

    // Verify that query planner was called
    expect(mockQueryPlanner.createPlan).toHaveBeenCalled();
  });
});
