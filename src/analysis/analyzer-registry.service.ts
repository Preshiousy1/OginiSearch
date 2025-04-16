import { Injectable } from '@nestjs/common';
import { AnalyzerRegistry } from './analyzers/analyzer-registry';
import { Analyzer, AnalyzerConfig } from './interfaces/analyzer.interface';

@Injectable()
export class AnalyzerRegistryService {
  getAnalyzer(name: string): Analyzer {
    return AnalyzerRegistry.get(name);
  }

  hasAnalyzer(name: string): boolean {
    return AnalyzerRegistry.has(name);
  }

  // Add other methods as needed
}
