import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostgreSQLSearchEngine } from '../storage/postgresql/postgresql-search-engine';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';
import { PostgreSQLFuzzySearch } from '../storage/postgresql/postgresql-fuzzy-search';
import { PostgreSQLIndexStats } from '../storage/postgresql/postgresql-index-stats';
import { PostgreSQLResultProcessorService } from '../storage/postgresql/result-processor.service';
import { PostgreSQLPerformanceMonitorService } from '../storage/postgresql/performance-monitor.service';
import { OptimizedQueryCacheService } from '../storage/postgresql/optimized-query-cache.service';
import { TypoToleranceService } from '../search/typo-tolerance.service';
import { QueryProcessorService } from '../search/query-processor.service';
import { Document } from '../storage/postgresql/entities/document.entity';
import { Index } from '../storage/postgresql/entities/index.entity';
import { PostgreSQLDocumentProcessor } from '../storage/postgresql/postgresql-document-processor';
import { PostgreSQLModule } from 'src/storage/postgresql/postgresql.module';
import { SearchModule } from 'src/search/search.module';
import { AnalysisModule } from 'src/analysis/analysis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Index]),
    forwardRef(() => PostgreSQLModule),
    forwardRef(() => SearchModule),
    AnalysisModule,
  ],
  providers: [
    PostgreSQLSearchEngine,
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLIndexStats,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    TypoToleranceService,
    QueryProcessorService,
  ],
  exports: [
    PostgreSQLSearchEngine,
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLIndexStats,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    TypoToleranceService,
    QueryProcessorService,
  ],
})
export class SearchEngineModule {}
