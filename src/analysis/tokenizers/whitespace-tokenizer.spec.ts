import { WhitespaceTokenizer } from './whitespace-tokenizer';

describe('WhitespaceTokenizer', () => {
  let tokenizer: WhitespaceTokenizer;

  beforeEach(() => {
    tokenizer = new WhitespaceTokenizer();
  });

  it('should be defined', () => {
    expect(tokenizer).toBeDefined();
  });

  it('should tokenize text using whitespace as delimiter', () => {
    const text = 'Hello world,  this  is a\ttest.\nNew line';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['Hello', 'world,', 'this', 'is', 'a', 'test.', 'New', 'line']);
  });

  it('should handle empty input', () => {
    expect(tokenizer.tokenize('')).toEqual([]);
    expect(tokenizer.tokenize(null)).toEqual([]);
    expect(tokenizer.tokenize(undefined)).toEqual([]);
  });

  it('should convert to lowercase when enabled', () => {
    tokenizer = new WhitespaceTokenizer({ lowercase: true });
    const text = 'Hello World';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['hello', 'world']);
  });

  it('should remove stop words when enabled', () => {
    tokenizer = new WhitespaceTokenizer({
      removeStopWords: true,
      stopWords: ['is', 'a', 'the'],
    });
    const text = 'This is a test';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['This', 'test']);
  });

  it('should preserve punctuation and special characters', () => {
    const text = 'Hello, world! This-is a_test.';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['Hello,', 'world!', 'This-is', 'a_test.']);
  });
});
