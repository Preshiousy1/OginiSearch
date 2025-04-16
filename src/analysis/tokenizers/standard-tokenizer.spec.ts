import { StandardTokenizer } from './standard-tokenizer';

describe('StandardTokenizer', () => {
  let tokenizer: StandardTokenizer;

  beforeEach(() => {
    tokenizer = new StandardTokenizer();
  });

  it('should be defined', () => {
    expect(tokenizer).toBeDefined();
  });

  it('should tokenize text using standard word boundaries', () => {
    const text = 'Hello world, this is a test.';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['hello', 'world', 'this', 'is', 'a', 'test']);
  });

  it('should handle empty input', () => {
    expect(tokenizer.tokenize('')).toEqual([]);
    expect(tokenizer.tokenize(null)).toEqual([]);
    expect(tokenizer.tokenize(undefined)).toEqual([]);
  });

  it('should preserve case when lowercase is disabled', () => {
    tokenizer = new StandardTokenizer({ lowercase: false });
    const text = 'Hello World';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['Hello', 'World']);
  });

  it('should remove stop words when enabled', () => {
    tokenizer = new StandardTokenizer({ removeStopWords: true });
    const text = 'this is a test with the stopwords';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['test', 'stopwords']);
  });

  it('should use custom stop words when provided', () => {
    tokenizer = new StandardTokenizer({
      removeStopWords: true,
      stopWords: ['test', 'custom'],
    });
    const text = 'this is a test with custom stopwords';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['this', 'is', 'a', 'with', 'stopwords']);
  });

  it('should preserve special characters when removeSpecialChars is disabled', () => {
    tokenizer = new StandardTokenizer({ removeSpecialChars: false });
    const text = 'hello, world!';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['hello,', 'world!']);
  });
});
