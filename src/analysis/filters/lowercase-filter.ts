import { TokenFilter, TokenFilterOptions } from '../interfaces/token-filter.interface';

export class LowercaseFilter implements TokenFilter {
  constructor(options: TokenFilterOptions = {}) {
    // No specific options needed for lowercase filter
  }

  filter(tokens: string[]): string[] {
    if (!tokens || !Array.isArray(tokens)) {
      return [];
    }

    return tokens.map(token => token.toLowerCase());
  }

  getName(): string {
    return 'lowercase';
  }
}
