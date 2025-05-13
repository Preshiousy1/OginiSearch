import { Test, TestingModule } from '@nestjs/testing';
import { QueryPlannerService } from './query-planner.service';
import { IndexStatsService } from '../index/index-stats.service';
import { TermQuery, BooleanQuery, PhraseQuery } from './interfaces/query-processor.interface';
import { TermDictionary } from '../index/interfaces/posting.interface';

describe('QueryPlannerService', () => {
  let service: QueryPlannerService;
  let mockTermDictionary: Partial<TermDictionary>;
  let mockIndexStats: Partial<IndexStatsService>;

  beforeEach(async () => {
    // Create mock term dictionary with the correct interface
    mockTermDictionary = {
      getTerms: jest.fn(() => ['title:search', 'title:engine', 'content:search']),
      getPostingList: jest.fn(term =>
        Promise.resolve({
          size: () => (term === 'title:search' ? 5 : term === 'title:engine' ? 10 : 20),
          getEntries: () => [],
          addEntry: jest.fn(),
          removeEntry: jest.fn(),
          getEntry: jest.fn(),
          serialize: () => Buffer.from([]),
          deserialize: jest.fn(),
        }),
      ),
    };

    // Create mock index stats service
    mockIndexStats = {
      totalDocuments: 100,
      getDocumentFrequency: jest.fn(term => {
        const termFreqs = {
          'title:search': 5,
          'title:engine': 10,
          'content:search': 20,
          'content:javascript': 15,
          'title:javascript': 8,
          'title:nonexistent': 0,
        };
        return termFreqs[term] || 0;
      }),
      getAverageFieldLength: jest.fn(() => 50),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryPlannerService,
        {
          provide: 'TermDictionary',
          useValue: mockTermDictionary,
        },
        {
          provide: IndexStatsService,
          useValue: mockIndexStats,
        },
      ],
    }).compile();

    service = module.get<QueryPlannerService>(QueryPlannerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create plan for term query', () => {
    const termQuery: TermQuery = {
      type: 'term',
      field: 'title',
      value: 'search',
    };

    const plan = service.createPlan(termQuery);

    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].type).toBe('term');

    const termStep = plan.steps[0] as any;
    expect(termStep.field).toBe('title');
    expect(termStep.term).toBe('title:search');
    expect(termStep.estimatedResults).toBe(5);
  });

  it('should create plan for boolean query', () => {
    const boolQuery: BooleanQuery = {
      type: 'boolean',
      operator: 'and',
      clauses: [
        {
          type: 'term',
          field: 'title',
          value: 'search',
        } as TermQuery,
        {
          type: 'term',
          field: 'title',
          value: 'engine',
        } as TermQuery,
      ],
    };

    const plan = service.createPlan(boolQuery);

    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].type).toBe('boolean');

    const boolStep = plan.steps[0] as any;
    expect(boolStep.operator).toBe('and');
    expect(boolStep.steps.length).toBe(2);

    // The most selective term should be first
    expect((boolStep.steps[0] as any).term).toBe('title:search');
    expect((boolStep.steps[1] as any).term).toBe('title:engine');

    // For AND, estimated results should be the minimum
    expect(boolStep.estimatedResults).toBe(5);
  });

  it('should create plan for phrase query', () => {
    const phraseQuery: PhraseQuery = {
      type: 'phrase',
      field: 'title',
      terms: ['search', 'engine'],
    };

    const plan = service.createPlan(phraseQuery);

    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].type).toBe('phrase');

    const phraseStep = plan.steps[0] as any;
    expect(phraseStep.steps.length).toBe(2);

    // The steps within phrase should be ordered by selectivity
    expect((phraseStep.steps[0] as any).term).toBe('title:search');
    expect((phraseStep.steps[1] as any).term).toBe('title:engine');
  });

  it('should optimize boolean queries by ordering terms', () => {
    const boolQuery: BooleanQuery = {
      type: 'boolean',
      operator: 'or',
      clauses: [
        // Order these intentionally from least to most selective
        {
          type: 'term',
          field: 'content',
          value: 'search',
        } as TermQuery,
        {
          type: 'term',
          field: 'title',
          value: 'engine',
        } as TermQuery,
        {
          type: 'term',
          field: 'title',
          value: 'search',
        } as TermQuery,
      ],
    };

    const plan = service.createPlan(boolQuery);
    const boolStep = plan.steps[0] as any;

    // Steps should be reordered by selectivity (lowest doc frequency first)
    expect((boolStep.steps[0] as any).term).toBe('title:search'); // title:search (5 docs)
    expect((boolStep.steps[1] as any).term).toBe('title:engine'); // title:engine (10 docs)
    expect((boolStep.steps[2] as any).term).toBe('content:search'); // content:search (20 docs)
  });

  it('should handle nonexistent terms', () => {
    const termQuery: TermQuery = {
      type: 'term',
      field: 'title',
      value: 'nonexistent',
    };

    const plan = service.createPlan(termQuery);
    const termStep = plan.steps[0] as any;

    // Term doesn't exist, so we expect 0 results but high cost
    expect(termStep.estimatedResults).toBe(0);
    expect(termStep.cost).toBe(1000); // High cost for non-existent terms
  });
});
