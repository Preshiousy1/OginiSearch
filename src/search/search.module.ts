import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { QueryProcessorService } from './query-processor.service';
import { TypoToleranceService } from './typo-tolerance.service';
import { EntityExtractionService } from './services/entity-extraction.service';
import { LocationProcessorService } from './services/location-processor.service';
import { QueryExpansionService } from './services/query-expansion.service';
import { SemanticSearchService } from './services/semantic-search.service';
import { GeographicFilterService } from './services/geographic-filter.service';
import { MultiSignalRankingService } from './services/multi-signal-ranking.service';
import { DictionaryService } from './services/dictionary.service';
import { SpellCheckerService } from './spell-checker.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { PostgreSQLModule } from '../storage/postgresql/postgresql.module';

@Module({
  imports: [
    AnalysisModule,
    PostgreSQLModule,
    TypeOrmModule.forFeature(), // This provides DataSource
  ],
  providers: [
    SearchService,
    QueryProcessorService,
    TypoToleranceService,
    SpellCheckerService,
    EntityExtractionService,
    LocationProcessorService,
    QueryExpansionService,
    SemanticSearchService,
    GeographicFilterService,
    MultiSignalRankingService,
    DictionaryService,
  ],
  exports: [
    SearchService,
    QueryProcessorService,
    TypoToleranceService,
    SpellCheckerService,
    EntityExtractionService,
    LocationProcessorService,
    QueryExpansionService,
    SemanticSearchService,
    GeographicFilterService,
    MultiSignalRankingService,
    DictionaryService,
  ],
})
export class SearchModule {}
