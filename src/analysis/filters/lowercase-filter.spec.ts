import { LowercaseFilter } from './lowercase-filter';

describe('LowercaseFilter', () => {
  let filter: LowercaseFilter;

  beforeEach(() => {
    filter = new LowercaseFilter();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should convert tokens to lowercase', () => {
    const tokens = ['Hello', 'WORLD', 'Test', 'JavaScript'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['hello', 'world', 'test', 'javascript']);
  });

  it('should handle empty array', () => {
    expect(filter.filter([])).toEqual([]);
  });

  it('should handle null or undefined input', () => {
    expect(filter.filter(null)).toEqual([]);
    expect(filter.filter(undefined)).toEqual([]);
  });

  it('should maintain tokens that are already lowercase', () => {
    const tokens = ['already', 'lowercase', 'tokens'];
    const result = filter.filter(tokens);
    expect(result).toEqual(['already', 'lowercase', 'tokens']);
  });
});
