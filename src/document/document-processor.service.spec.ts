import { Test, TestingModule } from '@nestjs/testing';
import { DocumentProcessorService } from './document-processor.service';
import { Analyzer } from '../analysis/interfaces/analyzer.interface';
import { DocumentMapping, RawDocument } from './interfaces/document-processor.interface';
import { AnalyzerRegistryService } from 'src/analysis/analyzer-registry.service';

// Mock analyzer that simply splits on spaces
class MockAnalyzer implements Analyzer {
  analyze(text: string): string[] {
    return text.split(' ').filter(t => t.length > 0);
  }

  getName(): string {
    return 'standard';
  }

  getTokenizer(): any {
    return { type: 'whitespace' };
  }

  getFilters(): any[] {
    return [];
  }
}

// Mock lowercase analyzer
class MockLowercaseAnalyzer implements Analyzer {
  analyze(text: string): string[] {
    return text
      .toLowerCase()
      .split(' ')
      .filter(t => t.length > 0);
  }

  getName(): string {
    return 'lowercase';
  }

  getTokenizer(): any {
    return { type: 'whitespace' };
  }

  getFilters(): any[] {
    return [{ type: 'lowercase' }];
  }
}

describe('DocumentProcessorService', () => {
  let service: DocumentProcessorService;
  let analyzerRegistryService: AnalyzerRegistryService;

  beforeEach(async () => {
    // Create mock analyzer registry
    const mockAnalyzerRegistry = {
      getAnalyzer: jest.fn((name: string) => {
        if (name === 'standard') {
          return new MockAnalyzer();
        } else if (name === 'lowercase') {
          return new MockLowercaseAnalyzer();
        }
        return null;
      }),
      hasAnalyzer: jest.fn((name: string) => {
        return name === 'standard' || name === 'lowercase';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentProcessorService,
        {
          provide: AnalyzerRegistryService,
          useValue: mockAnalyzerRegistry,
        },
      ],
    }).compile();

    service = module.get<DocumentProcessorService>(DocumentProcessorService);
    analyzerRegistryService = module.get<AnalyzerRegistryService>(AnalyzerRegistryService);

    // Set up a basic mapping
    const mapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {
        title: {
          analyzer: 'lowercase',
          indexed: true,
          stored: true,
          weight: 2.0,
        },
        body: {
          indexed: true,
          stored: true,
        },
        tags: {
          analyzer: 'lowercase',
          indexed: true,
        },
        createdAt: {
          indexed: false,
        },
      },
    };

    service.setMapping(mapping);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should process a simple document correctly', () => {
    const rawDoc: RawDocument = {
      id: 'doc1',
      source: {
        title: 'Hello World',
        body: 'This is a test document',
        createdAt: '2023-01-01',
      },
    };

    const processed = service.processDocument(rawDoc);

    // Verify ID and source are preserved
    expect(processed.id).toBe('doc1');
    expect(processed.source).toEqual(rawDoc.source);

    // Verify processed fields
    expect(processed.fields.title).toBeDefined();
    expect(processed.fields.body).toBeDefined();
    expect(processed.fields.createdAt).toBeUndefined(); // Not indexed

    // Verify title field (lowercase analyzer)
    expect(processed.fields.title.terms).toEqual(['hello', 'world']);
    expect(processed.fields.title.termFrequencies).toEqual({ hello: 1, world: 1 });
    expect(processed.fields.title.length).toBe(2);

    // Verify body field (standard analyzer)
    expect(processed.fields.body.terms).toEqual(['This', 'is', 'a', 'test', 'document']);
    expect(processed.fields.body.termFrequencies).toEqual({
      This: 1,
      is: 1,
      a: 1,
      test: 1,
      document: 1,
    });
    expect(processed.fields.body.length).toBe(5);

    // Verify field lengths are properly set
    expect(processed.fieldLengths).toEqual({
      title: 2,
      body: 5,
    });
  });

  it('should handle nested fields with dot notation', () => {
    const rawDoc: RawDocument = {
      id: 'doc2',
      source: {
        title: 'Nested Document',
        user: {
          profile: {
            name: 'Precious Atam',
            bio: 'Software developer',
          },
        },
      },
    };

    // Update mapping to include nested fields
    const mapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {
        title: {
          analyzer: 'lowercase',
        },
        'user.profile.name': {
          analyzer: 'lowercase',
        },
        'user.profile.bio': {
          analyzer: 'standard',
        },
      },
    };

    service.setMapping(mapping);

    const processed = service.processDocument(rawDoc);

    // Verify nested fields are processed
    expect(processed.fields['user.profile.name']).toBeDefined();
    expect(processed.fields['user.profile.name'].terms).toEqual(['precious', 'atam']);

    expect(processed.fields['user.profile.bio']).toBeDefined();
    expect(processed.fields['user.profile.bio'].terms).toEqual(['Software', 'developer']);
  });

  it('should handle array fields', () => {
    const rawDoc: RawDocument = {
      id: 'doc3',
      source: {
        title: 'Array Test',
        tags: ['software', 'SEARCH', 'API'],
      },
    };

    const processed = service.processDocument(rawDoc);

    // Verify array fields are processed
    expect(processed.fields.tags).toBeDefined();
    expect(processed.fields.tags.terms).toEqual(['software', 'search', 'api']);
    expect(processed.fields.tags.termFrequencies).toEqual({
      software: 1,
      search: 1,
      api: 1,
    });
  });

  it('should validate analyzers when setting mapping', () => {
    const invalidMapping: DocumentMapping = {
      defaultAnalyzer: 'nonexistent',
      fields: {
        title: { analyzer: 'standard' },
      },
    };

    expect(() => service.setMapping(invalidMapping)).toThrow(
      'Default analyzer "nonexistent" not found',
    );

    const invalidFieldMapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {
        title: { analyzer: 'nonexistent' },
      },
    };

    expect(() => service.setMapping(invalidFieldMapping)).toThrow(
      'Analyzer "nonexistent" not found for field "title"',
    );
  });

  it('should normalize different data types', () => {
    const rawDoc: RawDocument = {
      id: 'doc4',
      source: {
        title: 'Types Test',
        number: 42,
        boolean: true,
        date: new Date('2023-01-01T00:00:00Z'),
        object: { name: 'test' },
      },
    };

    // Update mapping to include different types
    const mapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {
        title: {},
        number: {},
        boolean: {},
        date: {},
        object: {},
      },
    };

    service.setMapping(mapping);

    const processed = service.processDocument(rawDoc);

    // Verify different types are normalized to strings
    expect(processed.fields.number.terms).toEqual(['42']);
    expect(processed.fields.boolean.terms).toEqual(['true']);
    expect(processed.fields.date.terms).toEqual(['2023-01-01T00:00:00.000Z']);
    expect(processed.fields.object.terms).toEqual(['{"name":"test"}']);
  });
});
