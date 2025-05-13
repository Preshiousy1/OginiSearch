import { Analyzer } from '../interfaces/analyzer.interface';
import { TokenFilter } from '../interfaces/token-filter.interface';
import { Tokenizer } from '../interfaces/tokenizer.interface';

/**
 * Keyword analyzer that preserves the exact input as a single token.
 * Useful for fields that should be matched exactly like categories, tags, etc.
 */
export class KeywordAnalyzer implements Analyzer {
  getName(): string {
    return 'keyword';
  }

  getTokenizer(): Tokenizer {
    return {
      getName: () => 'keyword-tokenizer',
      tokenize: (text: string): string[] => {
        if (!text || typeof text !== 'string') {
          return [];
        }
        // Return the entire text as a single token, trimmed
        const normalized = text.trim();
        return normalized ? [normalized] : [];
      },
    };
  }

  getFilters(): TokenFilter[] {
    return [
      {
        getName: () => 'lowercase-filter',
        filter: (tokens: string[]): string[] => {
          return tokens.map(token => token.toLowerCase());
        },
      },
    ];
  }

  analyze(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }
    const tokenizer = this.getTokenizer();
    const tokens = tokenizer.tokenize(text);
    return this.getFilters().reduce((current, filter) => filter.filter(current), tokens);
  }
}
