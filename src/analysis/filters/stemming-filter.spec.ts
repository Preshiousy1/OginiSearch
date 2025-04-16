import { StemmingFilter } from './stemming-filter';
import * as stemmer from 'porter-stemmer';

describe('StemmingFilter', () => {
  let filter: StemmingFilter;

  beforeEach(() => {
    filter = new StemmingFilter();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should stem words using Porter stemmer', () => {
    const tokens = ['running', 'jumps', 'jumped', 'flies', 'driving', 'easily'];
    const result = filter.filter(tokens);
    // Expected Porter stemmer results
    expect(result).toEqual(['run', 'jump', 'jump', 'fli', 'drive', 'easili']);
  });

  it('should handle empty array', () => {
    expect(filter.filter([])).toEqual([]);
  });

  it('should handle null or undefined input', () => {
    expect(filter.filter(null)).toEqual([]);
    expect(filter.filter(undefined)).toEqual([]);
  });

  it('should leave already stemmed words unchanged', () => {
    const tokens = ['run', 'jump', 'fly', 'drive'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['run', 'jump', 'fly', 'drive']);
  });
});
