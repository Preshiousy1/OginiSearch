import { Analyzer, AnalyzerConfig } from '../interfaces/analyzer.interface';
import { Tokenizer } from '../interfaces/tokenizer.interface';
import { TokenFilter } from '../interfaces/token-filter.interface';
import { TokenizerFactory } from '../tokenizers/tokenizer.factory';
import { TokenFilterFactory } from '../filters/token-filter.factory';

export class CustomAnalyzer implements Analyzer {
  private name: string;
  private tokenizer: Tokenizer;
  private filters: TokenFilter[];

  constructor(config: AnalyzerConfig) {
    this.name = config.name;

    // Create tokenizer from config
    this.tokenizer = TokenizerFactory.createTokenizer(
      config.tokenizer.type as any,
      config.tokenizer.options || {},
    );

    // Create filters from config
    this.filters = [];
    if (config.filters && Array.isArray(config.filters)) {
      for (const filterConfig of config.filters) {
        const filter = TokenFilterFactory.createFilter(
          filterConfig.type as any,
          filterConfig.options || {},
        );
        this.filters.push(filter);
      }
    }
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
