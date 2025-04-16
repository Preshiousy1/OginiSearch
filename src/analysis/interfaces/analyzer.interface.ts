import { Tokenizer } from './tokenizer.interface';
import { TokenFilter } from './token-filter.interface';

export interface AnalyzerConfig {
  name: string;
  tokenizer: {
    type: string;
    options?: Record<string, any>;
  };
  filters?: Array<{
    type: string;
    options?: Record<string, any>;
  }>;
}

export interface Analyzer {
  /**
   * Analyze text input and return tokens after processing
   * @param text The text to analyze
   * @returns Processed tokens
   */
  analyze(text: string): string[];

  /**
   * Get the name of the analyzer
   */
  getName(): string;

  /**
   * Get the tokenizer used by this analyzer
   */
  getTokenizer(): Tokenizer;

  /**
   * Get the filters used by this analyzer
   */
  getFilters(): TokenFilter[];
}
