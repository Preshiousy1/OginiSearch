import { Analyzer, AnalyzerConfig } from '../interfaces/analyzer.interface';
import { StandardAnalyzer } from './standard-analyzer';
import { CustomAnalyzer } from './custom-analyzer';

export class AnalyzerRegistry {
  private static analyzers: Map<string, Analyzer> = new Map();

  /**
   * Register a new analyzer
   * @param analyzer The analyzer to register
   */
  static register(analyzer: Analyzer): void {
    const name = analyzer.getName();
    if (this.analyzers.has(name)) {
      throw new Error(`Analyzer with name '${name}' is already registered`);
    }
    this.analyzers.set(name, analyzer);
  }

  /**
   * Get a registered analyzer by name
   * @param name Name of the analyzer to retrieve
   */
  static get(name: string): Analyzer {
    const analyzer = this.analyzers.get(name);
    if (!analyzer) {
      throw new Error(`No analyzer found with name '${name}'`);
    }
    return analyzer;
  }

  /**
   * Check if an analyzer is registered
   * @param name Name of the analyzer to check
   */
  static has(name: string): boolean {
    return this.analyzers.has(name);
  }

  /**
   * Remove a registered analyzer
   * @param name Name of the analyzer to remove
   */
  static remove(name: string): boolean {
    return this.analyzers.delete(name);
  }

  /**
   * Get names of all registered analyzers
   */
  static getNames(): string[] {
    return Array.from(this.analyzers.keys());
  }

  /**
   * Create an analyzer from configuration
   * @param config Analyzer configuration
   */
  static createAnalyzer(config: AnalyzerConfig): Analyzer {
    // Validate configuration
    this.validateConfig(config);

    if (config.name === 'standard' && !config.tokenizer) {
      return new StandardAnalyzer();
    }

    return new CustomAnalyzer(config);
  }

  /**
   * Validate analyzer configuration
   * @param config Configuration to validate
   */
  private static validateConfig(config: AnalyzerConfig): void {
    if (!config) {
      throw new Error('Analyzer configuration is required');
    }

    if (!config.name || typeof config.name !== 'string') {
      throw new Error('Analyzer name is required and must be a string');
    }

    if (!config.tokenizer || typeof config.tokenizer !== 'object') {
      throw new Error('Tokenizer configuration is required');
    }

    if (!config.tokenizer.type || typeof config.tokenizer.type !== 'string') {
      throw new Error('Tokenizer type is required and must be a string');
    }

    if (config.filters && !Array.isArray(config.filters)) {
      throw new Error('Filters configuration must be an array');
    }

    if (config.filters) {
      for (const filter of config.filters) {
        if (!filter.type || typeof filter.type !== 'string') {
          throw new Error('Filter type is required and must be a string');
        }
      }
    }
  }

  /**
   * Register default analyzers
   */
  static registerDefaults(): void {
    if (!this.has('standard')) {
      this.register(new StandardAnalyzer());
    }

    if (!this.has('whitespace')) {
      this.register(
        new CustomAnalyzer({
          name: 'whitespace',
          tokenizer: {
            type: 'whitespace',
          },
        }),
      );
    }

    if (!this.has('simple')) {
      this.register(
        new CustomAnalyzer({
          name: 'simple',
          tokenizer: {
            type: 'standard',
          },
          filters: [{ type: 'lowercase' }],
        }),
      );
    }
  }

  /**
   * Clear all registered analyzers
   */
  static clear(): void {
    this.analyzers.clear();
  }
}
