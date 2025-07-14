import { Test, TestingModule } from '@nestjs/testing';
import { PostgreSQLAnalysisAdapter } from './postgresql-analysis.adapter';
import { AnalyzerRegistryService } from '../../analysis/analyzer-registry.service';
import { IndexConfig } from '../../common/interfaces/index.interface';

describe('PostgreSQLAnalysisAdapter', () => {
  let adapter: PostgreSQLAnalysisAdapter;
  let mockAnalyzerRegistry: Partial<AnalyzerRegistryService>;

  beforeEach(async () => {
    mockAnalyzerRegistry = {
      getAnalyzer: jest.fn().mockReturnValue({
        analyze: jest.fn().mockImplementation((text: string) =>
          text
            .toLowerCase()
            .split(/\s+/)
            .filter(t => t.length > 0),
        ),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostgreSQLAnalysisAdapter,
        {
          provide: AnalyzerRegistryService,
          useValue: mockAnalyzerRegistry,
        },
      ],
    }).compile();

    adapter = module.get<PostgreSQLAnalysisAdapter>(PostgreSQLAnalysisAdapter);
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  describe('generateTsVector', () => {
    it('should generate business-optimized tsvector with weighted fields', () => {
      const testDocument = {
        name: 'ConnectNigeria Business Directory',
        category_name: 'Business Services',
        description: 'Comprehensive business directory for Nigerian companies',
        tags: 'business, directory, nigeria',
        location: 'Lagos, Nigeria',
      };

      const indexConfig: IndexConfig = {
        searchableAttributes: ['name', 'category_name', 'description', 'tags'],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {
          tags: 'keyword',
          category_name: 'keyword',
        },
      };

      const tsvector = adapter.generateTsVector(testDocument, indexConfig);

      expect(tsvector).toContain("setweight(to_tsvector('english'");
      expect(tsvector).toContain("'A')");
      expect(tsvector).toContain("'B')");
      expect(tsvector).toContain("'C')");
      expect(tsvector).toContain('||');

      expect(tsvector).toContain('connectnigeria');
      expect(tsvector).toContain('business');
      expect(tsvector).toContain('services');

      expect(tsvector.length).toBeGreaterThan(200);
    });

    it('should handle empty documents gracefully', () => {
      const emptyDocument = {};
      const indexConfig: IndexConfig = {
        searchableAttributes: ['name'],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {},
      };

      const tsvector = adapter.generateTsVector(emptyDocument, indexConfig);
      expect(tsvector).toBe('');
    });
  });

  describe('calculateFieldLengths', () => {
    it('should calculate field lengths correctly for BM25 scoring', () => {
      const testDocument = {
        name: 'Tech Solutions Nigeria Ltd',
        category_name: 'Information Technology',
        description: 'Leading provider of enterprise software solutions in Lagos',
        tags: 'software, enterprise, technology',
      };

      const fieldLengths = adapter.calculateFieldLengths(testDocument);

      expect(fieldLengths).toHaveProperty('name');
      expect(fieldLengths).toHaveProperty('category_name');
      expect(fieldLengths).toHaveProperty('description');
      expect(fieldLengths).toHaveProperty('tags');

      expect(fieldLengths.name).toBe(4);
      expect(fieldLengths.category_name).toBe(2);
      expect(fieldLengths.description).toBe(8); // Actual count: "Leading provider of enterprise software solutions in Lagos"
      expect(fieldLengths.tags).toBe(3);
    });

    it('should handle non-string fields', () => {
      const testDocument = {
        name: 'Test Business',
        price: 100,
        active: true,
        metadata: { type: 'business' },
      };

      const fieldLengths = adapter.calculateFieldLengths(testDocument);

      expect(fieldLengths.name).toBe(2);
      expect(fieldLengths.price).toBe(1);
      expect(fieldLengths.active).toBe(1);
      expect(fieldLengths.metadata).toBe(2); // "[object Object]" becomes 2 words when split
    });
  });

  describe('generateTsQuery', () => {
    it('should generate proper tsquery for PostgreSQL search', () => {
      const terms = ['tech', 'solutions', 'nigeria'];
      const tsquery = adapter.generateTsQuery(terms);

      expect(tsquery).toContain('tech & solutions & nigeria');
      expect(tsquery).toContain('|');
      expect(tsquery).toContain('tech | solutions | nigeria');
    });

    it('should handle empty terms array', () => {
      const emptyTerms: string[] = [];
      const emptyQuery = adapter.generateTsQuery(emptyTerms);
      expect(emptyQuery).toBe('');
    });

    it('should handle single term', () => {
      const singleTerm = ['business'];
      const query = adapter.generateTsQuery(singleTerm);
      expect(query).toBe("to_tsquery('english', 'business')");
    });

    it('should escape special characters', () => {
      const specialTerms = ['test&query', 'search|term'];
      const query = adapter.generateTsQuery(specialTerms);
      expect(query).toContain('test');
      expect(query).toContain('query');
      expect(query).toContain('search');
      expect(query).toContain('term');
    });
  });

  describe('getDefaultBusinessWeights', () => {
    it('should provide correct business field weights', () => {
      const weights = adapter.getDefaultBusinessWeights();

      expect(weights.name).toBe(3.0);
      expect(weights.category_name).toBe(2.0);
      expect(weights.description).toBe(1.5);
      expect(weights.tags).toBe(1.5);
      expect(weights.content).toBe(1.0);
      expect(weights.location).toBe(1.0);

      const weightValues = Object.values(weights).filter(w => w !== undefined);
      expect(weightValues.every(w => w >= 1.0 && w <= 3.0)).toBe(true);
    });

    it('should return consistent weights', () => {
      const weights1 = adapter.getDefaultBusinessWeights();
      const weights2 = adapter.getDefaultBusinessWeights();

      expect(weights1).toEqual(weights2);
    });
  });

  describe('Business-specific optimizations', () => {
    it('should prioritize business name fields', () => {
      const businessDoc = {
        name: 'Konga Nigeria',
        title: 'Konga Nigeria',
        company_name: 'Konga Nigeria Limited',
      };

      const indexConfig: IndexConfig = {
        searchableAttributes: ['name', 'title', 'company_name'],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {},
      };

      const tsvector = adapter.generateTsVector(businessDoc, indexConfig);

      expect(tsvector).toContain("'A')");
      expect(tsvector).toContain('konga');
      expect(tsvector).toContain('nigeria');
    });

    it('should handle Nigerian business context', () => {
      const nigerianBusiness = {
        name: 'Dangote Group',
        location: 'Lagos, Nigeria',
        category_name: 'Conglomerate',
        description: 'Leading Nigerian multinational industrial conglomerate',
      };

      const indexConfig: IndexConfig = {
        searchableAttributes: ['name', 'location', 'category_name', 'description'],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: { category_name: 'keyword' },
      };

      const tsvector = adapter.generateTsVector(nigerianBusiness, indexConfig);

      expect(tsvector).toContain('dangote');
      expect(tsvector).toContain('lagos');
      expect(tsvector).toContain('nigeria');
      expect(tsvector).toContain('conglomerate');
    });
  });
});
