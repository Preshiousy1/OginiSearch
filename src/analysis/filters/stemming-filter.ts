import { TokenFilter, TokenFilterOptions } from '../interfaces/token-filter.interface';
import * as stemmer from 'porter-stemmer';

export class StemmingFilter implements TokenFilter {
  constructor(options: TokenFilterOptions = {}) {
    // No specific options needed for basic Porter stemmer
  }

  filter(tokens: string[]): string[] {
    if (!tokens || !Array.isArray(tokens)) {
      return [];
    }

    return tokens.map(token => stemmer.stemmer(token));
  }

  getName(): string {
    return 'stemming';
  }
}
