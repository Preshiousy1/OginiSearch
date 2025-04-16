import { TokenFilter, TokenFilterOptions } from '../interfaces/token-filter.interface';
import { LowercaseFilter } from './lowercase-filter';
import { StopwordFilter, StopwordFilterOptions } from './stopword-filter';
import { StemmingFilter } from './stemming-filter';

export type TokenFilterType = 'lowercase' | 'stopword' | 'stemming';

export class TokenFilterFactory {
  /**
   * Create a token filter based on the specified type and options
   */
  static createFilter(type: TokenFilterType, options: TokenFilterOptions = {}): TokenFilter {
    switch (type) {
      case 'lowercase':
        return new LowercaseFilter(options);
      case 'stopword':
        return new StopwordFilter(options as StopwordFilterOptions);
      case 'stemming':
        return new StemmingFilter(options);
      default:
        throw new Error(`Unknown token filter type: ${type}`);
    }
  }
}
