import { Analyzer } from '../interfaces/analyzer.interface';
import { Tokenizer } from '../interfaces/tokenizer.interface';
import { TokenFilter } from '../interfaces/token-filter.interface';
import { StandardTokenizer } from '../tokenizers/standard-tokenizer';
import { LowercaseFilter } from '../filters/lowercase-filter';
import { StopwordFilter } from '../filters/stopword-filter';

export class StandardAnalyzer implements Analyzer {
  private name: string;
  private tokenizer: Tokenizer;
  private filters: TokenFilter[];

  constructor(
    options: {
      name?: string;
      tokenizer?: Tokenizer;
      filters?: TokenFilter[];
    } = {},
  ) {
    this.name = options.name || 'standard';
    this.tokenizer = options.tokenizer || new StandardTokenizer();
    this.filters = options.filters || [new LowercaseFilter(), new StopwordFilter()];
  }

  analyze(text: string): string[] {
    if (!text) {
      return [];
    }

    // First tokenize the text
    let tokens = this.tokenizer.tokenize(text);

    // Then apply each filter in sequence
    for (const filter of this.filters) {
      tokens = filter.filter(tokens);
    }

    return tokens;
  }

  getName(): string {
    return this.name;
  }

  getTokenizer(): Tokenizer {
    return this.tokenizer;
  }

  getFilters(): TokenFilter[] {
    return this.filters;
  }
}
