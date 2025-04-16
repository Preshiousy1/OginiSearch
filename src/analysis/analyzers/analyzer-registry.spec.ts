import { AnalyzerRegistry } from './analyzer-registry';
import { StandardAnalyzer } from './standard-analyzer';

describe('AnalyzerRegistry', () => {
  beforeEach(() => {
    AnalyzerRegistry.clear();
  });

  it('should register and retrieve analyzers', () => {
    const analyzer = new StandardAnalyzer();
    AnalyzerRegistry.register(analyzer);

    expect(AnalyzerRegistry.has('standard')).toBe(true);
    expect(AnalyzerRegistry.get('standard')).toBe(analyzer);
  });

  it('should throw error when registering duplicate analyzer', () => {
    AnalyzerRegistry.register(new StandardAnalyzer());

    expect(() => {
      AnalyzerRegistry.register(new StandardAnalyzer());
    }).toThrow(/already registered/);
  });

  it('should throw error when retrieving non-existent analyzer', () => {
    expect(() => {
      AnalyzerRegistry.get('non-existent');
    }).toThrow(/No analyzer found/);
  });

  it('should remove registered analyzers', () => {
    AnalyzerRegistry.register(new StandardAnalyzer());
    expect(AnalyzerRegistry.has('standard')).toBe(true);

    AnalyzerRegistry.remove('standard');
    expect(AnalyzerRegistry.has('standard')).toBe(false);
  });

  it('should register default analyzers', () => {
    AnalyzerRegistry.registerDefaults();

    expect(AnalyzerRegistry.has('standard')).toBe(true);
    expect(AnalyzerRegistry.has('whitespace')).toBe(true);
    expect(AnalyzerRegistry.has('simple')).toBe(true);
  });

  it('should validate analyzer configurations', () => {
    expect(() => {
      AnalyzerRegistry.createAnalyzer(null);
    }).toThrow(/configuration is required/);

    expect(() => {
      AnalyzerRegistry.createAnalyzer({} as any);
    }).toThrow(/name is required/);

    expect(() => {
      AnalyzerRegistry.createAnalyzer({ name: 'test' } as any);
    }).toThrow(/Tokenizer configuration is required/);

    expect(() => {
      AnalyzerRegistry.createAnalyzer({
        name: 'test',
        tokenizer: {},
      } as any);
    }).toThrow(/Tokenizer type is required/);

    expect(() => {
      AnalyzerRegistry.createAnalyzer({
        name: 'test',
        tokenizer: { type: 'standard' },
        filters: 'not-an-array' as any,
      });
    }).toThrow(/Filters configuration must be an array/);
  });
});
