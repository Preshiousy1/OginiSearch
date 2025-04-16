import { NgramTokenizer } from './ngram-tokenizer';

describe('NgramTokenizer', () => {
  let tokenizer: NgramTokenizer;

  beforeEach(() => {
    tokenizer = new NgramTokenizer();
  });

  it('should be defined', () => {
    expect(tokenizer).toBeDefined();
  });

  it('should generate n-grams with default settings (2-3 character n-grams)', () => {
    const text = 'hello';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['he', 'hel', 'el', 'ell', 'll', 'llo', 'lo']);
  });

  it('should handle empty input', () => {
    expect(tokenizer.tokenize('')).toEqual([]);
    expect(tokenizer.tokenize(null)).toEqual([]);
    expect(tokenizer.tokenize(undefined)).toEqual([]);
  });

  it('should respect custom minGram and maxGram settings', () => {
    tokenizer = new NgramTokenizer({ minGram: 1, maxGram: 2 });
    const text = 'abc';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toEqual(['a', 'ab', 'b', 'bc', 'c']);
  });

  it('should convert to lowercase by default', () => {
    const text = 'Hello';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toContain('he');
    expect(tokens).toContain('hel');
    expect(tokens).not.toContain('He');
  });

  it('should preserve case when lowercase is disabled', () => {
    tokenizer = new NgramTokenizer({ lowercase: false });
    const text = 'Hello';
    const tokens = tokenizer.tokenize(text);
    expect(tokens).toContain('He');
    expect(tokens).toContain('Hel');
    expect(tokens).not.toContain('he');
  });
});
