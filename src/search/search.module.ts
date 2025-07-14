import { forwardRef, Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { QueryProcessorService } from './query-processor.service';
import { SearchExecutorService } from './search-executor.service';
import { QueryPlannerService } from './query-planner.service';
import { TypoToleranceService } from './typo-tolerance.service';
import { PostgreSQLFuzzySearch } from '../storage/postgresql/postgresql-fuzzy-search';
import { PostgreSQLSchemaManager } from '../storage/postgresql/postgresql-schema-manager';
import { SchemaModule } from '../schema/schema.module';
import { StorageModule } from '../storage/storage.module';
import { IndexModule } from '../index/index.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { PostgreSQLModule } from 'src/storage/postgresql/postgresql.module';
import { SearchEngineModule } from 'src/search-engine/search-engine.module';

@Module({
  imports: [
    SchemaModule,
    StorageModule,
    IndexModule,
    AnalysisModule,
    forwardRef(() => SearchEngineModule),
  ],
  providers: [
    SearchService,
    QueryProcessorService,
    SearchExecutorService,
    QueryPlannerService,
    TypoToleranceService,
    PostgreSQLFuzzySearch,
    PostgreSQLSchemaManager,
  ],
  exports: [
    SearchService,
    QueryProcessorService,
    TypoToleranceService,
    PostgreSQLFuzzySearch,
    PostgreSQLSchemaManager,
  ],
})
export class SearchModule {}
