import { Test, TestingModule } from '@nestjs/testing';
import { PostgreSQLDocumentProcessor } from './postgresql-document-processor';
import { PostgreSQLAnalysisAdapter } from './postgresql-analysis.adapter';
import { AnalyzerRegistryService } from '../../analysis/analyzer-registry.service';

describe('PostgreSQLDocumentProcessor', () => {
  let processor: PostgreSQLDocumentProcessor;
  let mockAnalysisAdapter: Partial<PostgreSQLAnalysisAdapter>;
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

    mockAnalysisAdapter = {
      generateTsVector: jest
        .fn()
        .mockReturnValue(
          "setweight(to_tsvector('english', 'test business'), 'A') || setweight(to_tsvector('english', 'technology'), 'B')",
        ),
      calculateFieldLengths: jest.fn().mockReturnValue({
        name: 2,
        category_name: 1,
        description: 5,
      }),
      getDefaultBusinessWeights: jest.fn().mockReturnValue({
        name: 3.0,
        category_name: 2.0,
        description: 1.5,
        tags: 1.5,
        content: 1.0,
        location: 1.0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostgreSQLDocumentProcessor,
        {
          provide: PostgreSQLAnalysisAdapter,
          useValue: mockAnalysisAdapter,
        },
        {
          provide: AnalyzerRegistryService,
          useValue: mockAnalyzerRegistry,
        },
      ],
    }).compile();

    processor = module.get<PostgreSQLDocumentProcessor>(PostgreSQLDocumentProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processForPostgreSQL', () => {
    it('should process documents for PostgreSQL storage with all enhancements', async () => {
      const testDocument = {
        id: 'business-doc-1',
        source: {
          name: 'Konga Online Shopping',
          category_name: 'E-commerce',
          description: 'Leading e-commerce platform in Nigeria',
          tags: 'shopping, online, ecommerce',
          location: 'Lagos, Nigeria',
        },
      };

      const options = {
        indexName: 'businesses',
        boostFactor: 1.3,
      };

      const processed = await processor.processForPostgreSQL(testDocument, options);

      expect(processed).toHaveProperty('searchVector');
      expect(processed).toHaveProperty('fieldLengths');
      expect(processed).toHaveProperty('boostFactor', 1.3);

      expect(processed.id).toBe('business-doc-1');
      expect(processed.source).toEqual(testDocument.source);

      expect(mockAnalysisAdapter.generateTsVector).toHaveBeenCalled();
      expect(mockAnalysisAdapter.calculateFieldLengths).toHaveBeenCalled();
    });

    it('should handle default boost factor when not specified', async () => {
      const testDocument = {
        id: 'default-boost-doc',
        source: { name: 'Test Business', category_name: 'Testing' },
      };

      const options = { indexName: 'test-index' };

      const processed = await processor.processForPostgreSQL(testDocument, options);

      expect(processed.boostFactor).toBe(1.0);
    });

    it('should handle documents with minimal fields', async () => {
      const minimalDocument = {
        id: 'minimal-doc',
        source: { name: 'Simple Business' },
      };

      const options = { indexName: 'minimal-index' };

      const processed = await processor.processForPostgreSQL(minimalDocument, options);

      expect(processed.id).toBe('minimal-doc');
      expect(processed.searchVector).toBeDefined();
      expect(processed.fieldLengths).toBeDefined();
      expect(processed.boostFactor).toBe(1.0);
    });
  });

  describe('createSearchDocumentEntity', () => {
    it('should create proper search document entity for database storage', async () => {
      const testDocument = {
        id: 'entity-test-doc',
        source: {
          name: 'Nigerian Tech Hub',
          category_name: 'Technology',
          description: 'Innovation center for startups',
        },
      };

      const options = {
        indexName: 'tech-businesses',
        boostFactor: 1.0,
      };

      const processed = await processor.processForPostgreSQL(testDocument, options);
      const entity = processor.createSearchDocumentEntity(processed, options);

      expect(entity.indexName).toBe('tech-businesses');
      expect(entity.docId).toBe('entity-test-doc');
      expect(entity.content).toEqual(testDocument.source);
      expect(entity.searchVector).toBe(processed.searchVector);
      expect(entity.fieldLengths).toEqual(processed.fieldLengths);
      expect(entity.boostFactor).toBe(1.0);

      expect(typeof entity.content).toBe('object');
      expect(typeof entity.fieldLengths).toBe('object');
      expect(typeof entity.searchVector).toBe('string');
    });

    it('should handle entity creation with custom boost factor', async () => {
      const testDocument = {
        id: 'custom-boost-doc',
        source: { name: 'Premium Business', category_name: 'Premium' },
      };

      const options = { indexName: 'premium-index', boostFactor: 2.5 };

      const processed = await processor.processForPostgreSQL(testDocument, options);
      const entity = processor.createSearchDocumentEntity(processed, options);

      expect(entity.boostFactor).toBe(2.5);
      expect(entity.indexName).toBe('premium-index');
    });
  });

  describe('getMapping', () => {
    it('should use business-optimized field mapping configuration', () => {
      const mapping = processor.getMapping();

      expect(mapping.defaultAnalyzer).toBe('standard');

      expect(mapping.fields.name).toEqual({
        analyzer: 'standard',
        indexed: true,
        stored: true,
        weight: 3.0,
      });

      expect(mapping.fields.category_name).toEqual({
        analyzer: 'keyword',
        indexed: true,
        stored: true,
        weight: 2.0,
      });

      expect(mapping.fields.description).toEqual({
        analyzer: 'standard',
        indexed: true,
        stored: true,
        weight: 1.5,
      });

      expect(mapping.fields.tags).toEqual({
        analyzer: 'keyword',
        indexed: true,
        stored: true,
        weight: 1.5,
      });

      const weights = Object.values(mapping.fields)
        .map(f => f.weight)
        .filter(w => w !== undefined);
      expect(weights.every(w => w >= 1.0 && w <= 3.0)).toBe(true);
    });

    it('should return consistent mapping configuration', () => {
      const mapping1 = processor.getMapping();
      const mapping2 = processor.getMapping();

      expect(mapping1).toEqual(mapping2);
    });

    it('should include all essential business fields', () => {
      const mapping = processor.getMapping();

      expect(mapping.fields).toHaveProperty('name');
      expect(mapping.fields).toHaveProperty('category_name');
      expect(mapping.fields).toHaveProperty('description');
      expect(mapping.fields).toHaveProperty('tags');
    });
  });

  describe('Business document processing', () => {
    it('should handle Nigerian business documents', async () => {
      const nigerianBusiness = {
        id: 'nigerian-biz-1',
        source: {
          name: 'Dangote Cement',
          category_name: 'Manufacturing',
          sub_category_name: 'Cement Production',
          description: 'Leading cement manufacturer in Nigeria and Africa',
          location: 'Lagos, Nigeria',
          tags: 'cement, manufacturing, construction, africa',
          phone: '+234-1-234-5678',
          website: 'https://dangotecement.com',
        },
      };

      const options = { indexName: 'nigerian-businesses', boostFactor: 1.5 };

      const processed = await processor.processForPostgreSQL(nigerianBusiness, options);

      expect(processed.id).toBe('nigerian-biz-1');
      expect(processed.boostFactor).toBe(1.5);
      expect(processed.source).toEqual(nigerianBusiness.source);

      expect(mockAnalysisAdapter.generateTsVector).toHaveBeenCalledWith(
        nigerianBusiness.source,
        expect.any(Object),
      );
      expect(mockAnalysisAdapter.calculateFieldLengths).toHaveBeenCalledWith(
        nigerianBusiness.source,
      );
    });

    it('should handle e-commerce business documents', async () => {
      const ecommerceBusiness = {
        id: 'ecommerce-1',
        source: {
          name: 'Jumia Nigeria',
          category_name: 'E-commerce',
          description: "Africa's leading e-commerce platform",
          tags: 'online shopping, marketplace, africa, retail',
          location: 'Multiple locations across Nigeria',
        },
      };

      const options = { indexName: 'ecommerce-businesses' };

      const processed = await processor.processForPostgreSQL(ecommerceBusiness, options);
      const entity = processor.createSearchDocumentEntity(processed, options);

      expect(entity.indexName).toBe('ecommerce-businesses');
      expect(entity.docId).toBe('ecommerce-1');
      expect(entity.content.name).toBe('Jumia Nigeria');
      expect(entity.content.category_name).toBe('E-commerce');
    });

    it('should preserve all document fields during processing', async () => {
      const complexDocument = {
        id: 'complex-doc-1',
        source: {
          name: 'Tech Startup Hub',
          category_name: 'Technology',
          sub_category_name: 'Incubator',
          description: 'Supporting tech entrepreneurs in Nigeria',
          tags: 'startup, technology, incubator, nigeria',
          location: 'Yaba, Lagos',
          contact_email: 'info@techstartup.ng',
          phone: '+234-800-STARTUP',
          website: 'https://techstartup.ng',
          founded_year: 2020,
          employee_count: '10-50',
          services: ['Incubation', 'Mentorship', 'Funding'],
          social_media: {
            twitter: '@techstartupng',
            linkedin: 'techstartup-hub',
          },
        },
      };

      const options = { indexName: 'tech-startups', boostFactor: 1.8 };

      const processed = await processor.processForPostgreSQL(complexDocument, options);

      expect(processed.source).toEqual(complexDocument.source);
      expect(processed.source.services).toEqual(['Incubation', 'Mentorship', 'Funding']);
      expect(processed.source.social_media).toEqual({
        twitter: '@techstartupng',
        linkedin: 'techstartup-hub',
      });
      expect(processed.source.founded_year).toBe(2020);
    });
  });
});
