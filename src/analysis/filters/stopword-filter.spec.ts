import { StopwordFilter } from './stopword-filter';

describe('StopwordFilter', () => {
  let filter: StopwordFilter;

  beforeEach(() => {
    filter = new StopwordFilter();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should remove standard stopwords', () => {
    const tokens = ['this', 'is', 'a', 'test', 'with', 'the', 'stopwords'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['test', 'stopwords']);
  });

  it('should handle empty array', () => {
    expect(filter.filter([])).toEqual([]);
  });

  it('should handle null or undefined input', () => {
    expect(filter.filter(null)).toEqual([]);
    expect(filter.filter(undefined)).toEqual([]);
  });

  it('should use custom stopwords when provided', () => {
    filter = new StopwordFilter({
      stopwords: ['test', 'custom'],
    });
    const tokens = ['this', 'is', 'a', 'test', 'with', 'custom', 'stopwords'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['this', 'is', 'a', 'with', 'stopwords']);
  });

  it('should maintain tokens that are not stopwords', () => {
    const tokens = ['code', 'search', 'engine', 'development'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['code', 'search', 'engine', 'development']);
  });
});
