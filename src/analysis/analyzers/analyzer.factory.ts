import { Analyzer, AnalyzerConfig } from '../interfaces/analyzer.interface';
import { StandardAnalyzer } from './standard-analyzer';
import { CustomAnalyzer } from './custom-analyzer';
import { AnalyzerRegistry } from './analyzer-registry';

export class AnalyzerFactory {
  /**
   * Create an analyzer by name (using registry) or configuration
   * @param nameOrConfig Analyzer name or configuration
   */
  static createAnalyzer(nameOrConfig: string | AnalyzerConfig): Analyzer {
    // Ensure default analyzers are registered
    if (!AnalyzerRegistry.has('standard')) {
      AnalyzerRegistry.registerDefaults();
    }

    // If a string is provided, get analyzer from registry
    if (typeof nameOrConfig === 'string') {
      if (AnalyzerRegistry.has(nameOrConfig)) {
        return AnalyzerRegistry.get(nameOrConfig);
      }
      throw new Error(`No analyzer registered with name: ${nameOrConfig}`);
    }

    // Otherwise create from configuration
    const config = nameOrConfig as AnalyzerConfig;

    // Check if this configuration matches a registered analyzer
    if (AnalyzerRegistry.has(config.name)) {
      return AnalyzerRegistry.get(config.name);
    }

    // Create new analyzer from config
    const analyzer = AnalyzerRegistry.createAnalyzer(config);

    // Register if it has a name
    if (config.name) {
      AnalyzerRegistry.register(analyzer);
    }

    return analyzer;
  }
}
