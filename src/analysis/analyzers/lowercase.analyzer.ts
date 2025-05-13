import { Analyzer } from '../interfaces/analyzer.interface';
import { TokenFilter } from '../interfaces/token-filter.interface';
import { Tokenizer } from '../interfaces/tokenizer.interface';

/**
 * Lowercase analyzer that splits text on whitespace and converts to lowercase.
 * Simpler than the standard analyzer, without stopword removal.
 */
export class LowercaseAnalyzer implements Analyzer {
  getName(): string {
    return 'lowercase';
  }

  getTokenizer(): Tokenizer {
    return {
      getName: () => 'whitespace-tokenizer',
      tokenize: (text: string): string[] => {
        if (!text || typeof text !== 'string') {
          return [];
        }
        // Split on whitespace and filter out empty tokens
        return text.split(/\s+/).filter(token => token.length > 0);
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
