import { Module } from '@nestjs/common';
import { TokenizerFactory } from './tokenizers/tokenizer.factory';
import { TokenFilterFactory } from './filters/token-filter.factory';
import { AnalyzerRegistry } from './analyzers/analyzer-registry';
import { AnalyzerFactory } from './analyzers/analyzer.factory';
import { AnalyzerRegistryService } from './analyzer-registry.service';
@Module({
  providers: [
    TokenizerFactory,
    TokenFilterFactory,
    {
      provide: 'ANALYZER_REGISTRY',
      useFactory: () => {
        AnalyzerRegistry.registerDefaults();
        return AnalyzerRegistry;
      },
    },
    AnalyzerFactory,
    AnalyzerRegistryService,
  ],
  exports: [
    TokenizerFactory,
    TokenFilterFactory,
    'ANALYZER_REGISTRY',
    AnalyzerFactory,
    AnalyzerRegistryService,
  ],
})
export class AnalysisModule {}
