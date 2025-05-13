import { Analyzer } from '../interfaces/analyzer.interface';
import { TokenFilter } from '../interfaces/token-filter.interface';
import { Tokenizer } from '../interfaces/tokenizer.interface';

/**
 * Standard analyzer that splits text on word boundaries and applies common filters.
 * This is the default analyzer for most text fields.
 */
export class StandardAnalyzer implements Analyzer {
  getName(): string {
    return 'standard';
  }

  getTokenizer(): Tokenizer {
    return {
      getName: () => 'standard-tokenizer',
      tokenize: (text: string): string[] => {
        if (!text || typeof text !== 'string') {
          return [];
        }
        // Split on word boundaries and filter out empty tokens
        return text.split(/\b|\s+/).filter(token => token.trim().length > 0);
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
      {
        getName: () => 'stopword-filter',
        filter: (tokens: string[]): string[] => {
          const stopwords = new Set([
            'a',
            'an',
            'and',
            'are',
            'as',
            'at',
            'be',
            'by',
            'for',
            'from',
            'has',
            'he',
            'in',
            'is',
            'it',
            'its',
            'of',
            'on',
            'that',
            'the',
            'to',
            'was',
            'were',
            'will',
            'with',
          ]);
          return tokens.filter(token => !stopwords.has(token.toLowerCase()));
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
