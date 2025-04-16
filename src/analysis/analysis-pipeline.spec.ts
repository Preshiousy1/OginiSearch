import { AnalyzerFactory } from './analyzers/analyzer.factory';
import { AnalyzerRegistry } from './analyzers/analyzer-registry';

describe('Analysis Pipeline Integration', () => {
  beforeEach(() => {
    AnalyzerRegistry.clear();
    AnalyzerRegistry.registerDefaults();
  });

  it('should process text through standard analyzer', () => {
    const analyzer = AnalyzerFactory.createAnalyzer('standard');
    const result = analyzer.analyze('Hello world, this is a test!');

    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).toContain('test');
    expect(result).not.toContain('this');
    expect(result).not.toContain('is');
    expect(result).not.toContain('a');
  });

  it('should process text through whitespace analyzer', () => {
    const analyzer = AnalyzerFactory.createAnalyzer('whitespace');
    const result = analyzer.analyze('Hello world, this is a test!');

    expect(result).toEqual(['Hello', 'world,', 'this', 'is', 'a', 'test!']);
  });

  it('should create and use custom analyzer from config', () => {
    const analyzer = AnalyzerFactory.createAnalyzer({
      name: 'custom-test',
      tokenizer: {
        type: 'standard',
        options: { removeSpecialChars: true },
      },
      filters: [{ type: 'lowercase' }, { type: 'stemming' }],
    });

    const result = analyzer.analyze('Running and Jumping are great exercises!');

    // Should lowercase and stem words
    expect(result).toContain('run');
    expect(result).toContain('jump');
    expect(result).toContain('great');
    expect(result).toContain('exercis');
    expect(result).not.toContain('running');
    expect(result).not.toContain('jumping');
  });

  it('should allow chaining multiple filters in order', () => {
    const analyzer = AnalyzerFactory.createAnalyzer({
      name: 'multi-filter',
      tokenizer: { type: 'standard' },
      filters: [{ type: 'lowercase' }, { type: 'stopword' }, { type: 'stemming' }],
    });

    const result = analyzer.analyze('The running dogs are barking loudly');

    // Should lowercase, remove stopwords, and stem
    expect(result).toContain('run');
    expect(result).toContain('dog');
    expect(result).toContain('bark');
    expect(result).toContain('loudli');
    expect(result).not.toContain('the');
    expect(result).not.toContain('are');
  });
});
