import { Injectable } from '@nestjs/common';
import { Analyzer } from './interfaces/analyzer.interface';
import { StandardAnalyzer } from './analyzers/standard.analyzer';
import { LowercaseAnalyzer } from './analyzers/lowercase.analyzer';
import { KeywordAnalyzer } from './analyzers/keyword.analyzer';

@Injectable()
export class AnalyzerRegistryService {
  private analyzers: Map<string, Analyzer> = new Map();

  constructor() {
    this.registerDefaultAnalyzers();
  }

  private registerDefaultAnalyzers(): void {
    this.registerAnalyzer('standard', new StandardAnalyzer());
    this.registerAnalyzer('lowercase', new LowercaseAnalyzer());
    this.registerAnalyzer('keyword', new KeywordAnalyzer());
  }

  registerAnalyzer(name: string, analyzer: Analyzer): void {
    this.analyzers.set(name, analyzer);
  }

  getAnalyzer(name: string): Analyzer | undefined {
    return this.analyzers.get(name);
  }

  hasAnalyzer(name: string): boolean {
    return this.analyzers.has(name);
  }

  // Add other methods as needed
}
