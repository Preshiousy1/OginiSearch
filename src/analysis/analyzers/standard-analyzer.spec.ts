import { StandardAnalyzer } from './standard-analyzer';

describe('StandardAnalyzer', () => {
  let analyzer: StandardAnalyzer;

  beforeEach(() => {
    analyzer = new StandardAnalyzer();
  });

  it('should be defined', () => {
    expect(analyzer).toBeDefined();
  });

  it('should tokenize and filter text', () => {
    const text = 'Hello world, This is a test with multiple words!';
    const tokens = analyzer.analyze(text);

    // Standard analyzer applies standard tokenizer (splits on boundaries),
    // lowercase filter, and stopword filter
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('this');
    expect(tokens).not.toContain('with');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
    expect(tokens).toContain('multiple');
    expect(tokens).toContain('words');
  });

  it('should handle empty input', () => {
    expect(analyzer.analyze('')).toEqual([]);
    expect(analyzer.analyze(null)).toEqual([]);
    expect(analyzer.analyze(undefined)).toEqual([]);
  });

  it('should return tokenizer and filters', () => {
    expect(analyzer.getTokenizer()).toBeDefined();
    expect(analyzer.getFilters().length).toBeGreaterThan(0);
  });
});
