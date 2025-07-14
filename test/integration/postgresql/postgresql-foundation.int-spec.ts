import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PostgreSQLModule } from '../../../src/storage/postgresql/postgresql.module';
import { PostgreSQLService } from '../../../src/storage/postgresql/postgresql.service';
import { PostgreSQLAnalysisAdapter } from '../../../src/storage/postgresql/postgresql-analysis.adapter';
import { PostgreSQLDocumentProcessor } from '../../../src/storage/postgresql/postgresql-document-processor';
import { PostgreSQLSearchEngine } from '../../../src/storage/postgresql/postgresql-search-engine';
import { AnalysisModule } from '../../../src/analysis/analysis.module';
import { SearchModule } from '../../../src/search/search.module';
import { IndexConfig } from '../../../src/common/interfaces/index.interface';
import { SearchEngineModule } from '../../../src/search-engine/search-engine.module';

describe('PostgreSQL Foundation Integration (Tasks 1.3, 1.4, 1.5)', () => {
  let module: TestingModule;
  let postgresService: PostgreSQLService;
  let analysisAdapter: PostgreSQLAnalysisAdapter;
  let documentProcessor: PostgreSQLDocumentProcessor;
  let searchEngine: PostgreSQLSearchEngine;
  let injectedSearchEngine: any;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.test',
          isGlobal: true,
        }),
        PostgreSQLModule,
        AnalysisModule,
        SearchModule,
        SearchEngineModule,
      ],
      providers: [PostgreSQLAnalysisAdapter, PostgreSQLDocumentProcessor, PostgreSQLSearchEngine],
    }).compile();

    postgresService = module.get<PostgreSQLService>(PostgreSQLService);
    analysisAdapter = module.get<PostgreSQLAnalysisAdapter>(PostgreSQLAnalysisAdapter);
    documentProcessor = module.get<PostgreSQLDocumentProcessor>(PostgreSQLDocumentProcessor);
    searchEngine = module.get<PostgreSQLSearchEngine>(PostgreSQLSearchEngine);
    injectedSearchEngine = module.get<any>('SEARCH_ENGINE');
  });

  afterAll(async () => {
    await module.close();
  });

  describe('Task 1.2: PostgreSQL Analysis Adapter', () => {
    it('should generate business-optimized tsvector', () => {
      const testDocument = {
        name: 'Tech Solutions Nigeria Ltd',
        category_name: 'Information Technology',
        description: 'Leading provider of enterprise software solutions in Lagos',
        tags: 'software, enterprise, technology',
        location: 'Lagos, Nigeria',
      };

      const mockIndexConfig: IndexConfig = {
        searchableAttributes: ['name', 'category_name', 'description', 'tags'],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {
          tags: 'keyword',
          category_name: 'keyword',
        },
      };

      const tsvector = analysisAdapter.generateTsVector(testDocument, mockIndexConfig);

      expect(tsvector).toContain("setweight(to_tsvector('english'");
      expect(tsvector).toContain("'A')");
      expect(tsvector).toContain("'B')");
      expect(tsvector).toContain("'C')");
      expect(tsvector.length).toBeGreaterThan(100);
    });

    it('should calculate field lengths for BM25', () => {
      const testDocument = {
        name: 'Tech Solutions Nigeria Ltd',
        category_name: 'Information Technology',
        description: 'Leading provider of enterprise software solutions in Lagos',
        tags: 'software, enterprise, technology',
      };

      const fieldLengths = analysisAdapter.calculateFieldLengths(testDocument);

      expect(fieldLengths).toHaveProperty('name');
      expect(fieldLengths).toHaveProperty('category_name');
      expect(fieldLengths).toHaveProperty('description');
      expect(fieldLengths).toHaveProperty('tags');

      expect(fieldLengths.name).toBe(4);
      expect(fieldLengths.category_name).toBe(2);
      expect(fieldLengths.description).toBeGreaterThan(5);
      expect(fieldLengths.tags).toBe(3);
    });

    it('should generate proper tsquery for search terms', () => {
      const terms = ['tech', 'solutions'];
      const tsquery = analysisAdapter.generateTsQuery(terms);

      expect(tsquery).toContain("to_tsquery('english'");
      expect(tsquery).toContain('tech');
      expect(tsquery).toContain('solutions');
      expect(tsquery).toContain('&');
      expect(tsquery).toContain('|');
    });

    it('should provide business field weights', () => {
      const weights = analysisAdapter.getDefaultBusinessWeights();

      expect(weights.name).toBe(3.0);
      expect(weights.category_name).toBe(2.0);
      expect(weights.description).toBe(1.5);
      expect(weights.tags).toBe(1.5);
      expect(weights.content).toBe(1.0);
      expect(weights.location).toBe(1.0);
    });
  });

  describe('Task 1.3: PostgreSQL Document Processor', () => {
    it('should process documents for PostgreSQL storage', async () => {
      const testDocument = {
        id: 'test-doc-1',
        source: {
          name: 'ConnectNigeria Business Directory',
          category_name: 'Business Services',
          description: 'Comprehensive business directory for Nigerian companies',
          tags: 'business, directory, nigeria',
          location: 'Lagos, Nigeria',
        },
      };

      const options = {
        indexName: 'test-businesses',
        boostFactor: 1.2,
      };

      const processed = await documentProcessor.processForPostgreSQL(testDocument, options);

      expect(processed).toHaveProperty('searchVector');
      expect(processed).toHaveProperty('fieldLengths');
      expect(processed).toHaveProperty('boostFactor');
      expect(processed.boostFactor).toBe(1.2);

      expect(processed.id).toBe('test-doc-1');
      expect(processed.source).toEqual(testDocument.source);
      expect(processed.fields).toBeDefined();

      expect(processed.searchVector).toContain("setweight(to_tsvector('english'");
      expect(processed.searchVector.length).toBeGreaterThan(100);

      expect(Object.keys(processed.fieldLengths).length).toBeGreaterThan(3);
      expect(processed.fieldLengths.name).toBeGreaterThan(0);
      expect(processed.fieldLengths.description).toBeGreaterThan(0);
    });

    it('should create search document entity for database storage', async () => {
      const testDocument = {
        id: 'test-doc-2',
        source: {
          name: 'Lagos Tech Hub',
          category_name: 'Technology',
          description: 'Innovation center for tech startups',
        },
      };

      const options = {
        indexName: 'test-businesses',
      };

      const processed = await documentProcessor.processForPostgreSQL(testDocument, options);
      const entity = documentProcessor.createSearchDocumentEntity(processed, options);

      expect(entity).toHaveProperty('indexName', 'test-businesses');
      expect(entity).toHaveProperty('docId', 'test-doc-2');
      expect(entity).toHaveProperty('content');
      expect(entity).toHaveProperty('searchVector');
      expect(entity).toHaveProperty('fieldLengths');
      expect(entity).toHaveProperty('boostFactor');

      expect(entity.content).toEqual(testDocument.source);
      expect(typeof entity.fieldLengths).toBe('object');
      expect(entity.boostFactor).toBe(1.0);
    });

    it('should use business-optimized field mapping', () => {
      const mapping = documentProcessor.getMapping();

      expect(mapping.defaultAnalyzer).toBe('standard');
      expect(mapping.fields.name.weight).toBe(3.0);
      expect(mapping.fields.category_name.weight).toBe(2.0);
      expect(mapping.fields.description.weight).toBe(1.5);
      expect(mapping.fields.tags.weight).toBe(1.5);

      expect(mapping.fields.name.analyzer).toBe('standard');
      expect(mapping.fields.category_name.analyzer).toBe('keyword');
      expect(mapping.fields.tags.analyzer).toBe('keyword');
    });
  });

  describe('Task 1.4: PostgreSQL Search Engine', () => {
    it('should create PostgreSQL index with business configuration', async () => {
      const createIndexDto = {
        name: 'test-business-index',
        settings: { numberOfShards: 1 },
        mappings: { properties: { name: { type: 'text' as const } } },
      };

      const result = await searchEngine.createIndex(createIndexDto);

      expect(result.name).toBe('test-business-index');
      expect(result.status).toBe('open');
      expect(result.documentCount).toBe(0);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.settings).toEqual(createIndexDto.settings);
      expect(result.mappings).toEqual(createIndexDto.mappings);
    });

    it('should get index information', async () => {
      await searchEngine.createIndex({
        name: 'test-info-index',
        settings: {},
        mappings: { properties: {} },
      });

      const indexInfo = await searchEngine.getIndex('test-info-index');

      expect(indexInfo.name).toBe('test-info-index');
      expect(indexInfo.status).toBe('open');
      expect(indexInfo.documentCount).toBe(0);
      expect(indexInfo.createdAt).toBeInstanceOf(Date);
    });

    it('should handle search engine interface methods', async () => {
      const indexName = 'test-interface-index';

      await searchEngine.createIndex({
        name: indexName,
        settings: {},
        mappings: { properties: {} },
      });

      expect(typeof searchEngine.search).toBe('function');
      expect(typeof searchEngine.addDocument).toBe('function');
      expect(typeof searchEngine.addDocuments).toBe('function');
      expect(typeof searchEngine.deleteDocument).toBe('function');
      expect(typeof searchEngine.createIndex).toBe('function');
      expect(typeof searchEngine.getIndex).toBe('function');
    });

    it('should throw error for non-existent index operations', async () => {
      await expect(searchEngine.getIndex('non-existent')).rejects.toThrow('not found');

      await expect(searchEngine.search('non-existent', { query: 'test' })).rejects.toThrow(
        'not found',
      );

      await expect(
        searchEngine.addDocument('non-existent', 'doc1', { title: 'test' }),
      ).rejects.toThrow('not found');
    });

    it('should prevent duplicate index creation', async () => {
      const indexDto = {
        name: 'duplicate-test-index',
        settings: {},
        mappings: { properties: {} },
      };

      await searchEngine.createIndex(indexDto);

      await expect(searchEngine.createIndex(indexDto)).rejects.toThrow('already exists');
    });
  });

  describe('Integration: Complete Document Processing Flow', () => {
    it('should process business document through complete PostgreSQL pipeline', async () => {
      const businessDocument = {
        id: 'business-123',
        source: {
          name: 'Konga Online Shopping Ltd',
          category_name: 'E-commerce',
          sub_category_name: 'Online Retail',
          description: 'Leading e-commerce platform in Nigeria offering wide range of products',
          tags: 'ecommerce, online, shopping, retail, nigeria',
          location: 'Lagos, Nigeria',
          phone: '+234-800-KONGA',
          website: 'https://konga.com',
          email: 'info@konga.com',
        },
      };

      const indexName = 'integration-test-businesses';
      await searchEngine.createIndex({
        name: indexName,
        settings: { numberOfShards: 1 },
        mappings: {
          properties: {
            name: { type: 'text' as const },
            category_name: { type: 'keyword' as const },
            description: { type: 'text' as const },
          },
        },
      });

      const processed = await documentProcessor.processForPostgreSQL(businessDocument, {
        indexName,
        boostFactor: 1.5,
      });

      const entity = documentProcessor.createSearchDocumentEntity(processed, { indexName });

      expect(entity.indexName).toBe(indexName);
      expect(entity.docId).toBe('business-123');
      expect(entity.searchVector).toContain('konga');
      expect(entity.searchVector).toContain('ecommerce');
      expect(entity.searchVector).toContain('nigeria');
      expect(entity.fieldLengths.name).toBe(4);
      expect(entity.fieldLengths.description).toBeGreaterThan(10);
      expect(entity.boostFactor).toBe(1.5);

      expect(entity.searchVector).toMatch(/setweight\(to_tsvector\('english',.*\), 'A'\)/);
      expect(entity.searchVector).toMatch(/setweight\(to_tsvector\('english',.*\), 'B'\)/);
      expect(entity.searchVector).toMatch(/setweight\(to_tsvector\('english',.*\), 'C'\)/);
    });
  });

  describe('Task 1.5: Dependency Injection Update', () => {
    it('should provide PostgreSQL search engine through dependency injection', () => {
      expect(searchEngine).toBeDefined();
      expect(searchEngine).toBeInstanceOf(PostgreSQLSearchEngine);
    });

    it('should inject PostgreSQL search engine as SEARCH_ENGINE token', () => {
      expect(injectedSearchEngine).toBeDefined();
      expect(injectedSearchEngine).toBeInstanceOf(PostgreSQLSearchEngine);
      expect(injectedSearchEngine).toBe(searchEngine);
    });

    it('should have all required methods from SearchEngine interface', () => {
      expect(typeof searchEngine.search).toBe('function');
      expect(typeof searchEngine.suggest).toBe('function');
      expect(typeof searchEngine.createIndex).toBe('function');
      expect(typeof searchEngine.deleteIndex).toBe('function');
      expect(typeof searchEngine.indexExists).toBe('function');
      expect(typeof searchEngine.getIndex).toBe('function');
      expect(typeof searchEngine.indexDocument).toBe('function');
      expect(typeof searchEngine.deleteDocument).toBe('function');
      expect(typeof searchEngine.bulkIndexDocuments).toBe('function');
      expect(typeof searchEngine.clearDictionary).toBe('function');
      expect(typeof searchEngine.getTermStats).toBe('function');
    });

    it('should be properly configured in SearchEngineModule', () => {
      // Verify that the search engine is properly configured
      expect(searchEngine.constructor.name).toBe('PostgreSQLSearchEngine');
      expect(injectedSearchEngine.constructor.name).toBe('PostgreSQLSearchEngine');
    });

    it('should have PostgreSQL components properly wired together', () => {
      // Verify the dependency injection chain is working
      expect(searchEngine).toBeDefined();
      expect(searchEngine['dataSource']).toBeDefined();
      expect(searchEngine['documentProcessor']).toBeDefined();
      expect(searchEngine['analysisAdapter']).toBeDefined();
      expect(searchEngine['queryProcessor']).toBeDefined();
    });
  });
});
