import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostgreSQLService } from './postgresql.service';
import { PostgreSQLFuzzySearch } from './postgresql-fuzzy-search';
import { PostgreSQLSchemaManager } from './postgresql-schema-manager';
import { PostgreSQLIndexStats } from './postgresql-index-stats';
import { DynamicIndexManagerService } from './dynamic-index-manager.service';
import { PostgreSQLQueryBuilderService } from './query-builder.service';
import { PostgreSQLResultProcessorService } from './result-processor.service';
import { PostgreSQLPerformanceMonitorService } from './performance-monitor.service';
import { OptimizedQueryCacheService } from './optimized-query-cache.service';

import { AdaptiveQueryOptimizerService } from './adaptive-query-optimizer.service';
import { TypoToleranceService } from '../../search/typo-tolerance.service';
import { Document } from './entities/document.entity';
import { SearchDocument } from './entities/search-document.entity';
import { Index } from './entities/index.entity';
import { SchemaModule } from '../../schema/schema.module';
// Phase 3 Query Builders
import { QueryBuilderFactory } from './query-builders/query-builder-factory';
import { MatchQueryBuilder } from './query-builders/match-query-builder';
import { TermQueryBuilder } from './query-builders/term-query-builder';
import { WildcardQueryBuilder } from './query-builders/wildcard-query-builder';
import { BoolQueryBuilder } from './query-builders/bool-query-builder';
import { MatchAllQueryBuilder } from './query-builders/match-all-query-builder';
// Phase 3 Services
import { BM25RankingService } from './bm25-ranking.service';
import { FilterBuilderService } from './filter-builder.service';
import { SearchConfigurationService } from './search-configuration.service';
import { SearchMetricsService } from './search-metrics.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('POSTGRES_HOST', 'localhost'),
        port: configService.get<number>('POSTGRES_PORT', 5432),
        database: configService.get<string>('POSTGRES_DB', 'ogini_search'),
        username: configService.get<string>('POSTGRES_USER', 'postgres'),
        password: configService.get<string>('POSTGRES_PASSWORD'),
        entities: [Document, SearchDocument, Index],
        synchronize: false, // Temporarily enable for table creation
        logging: false,
        ssl:
          configService.get<string>('POSTGRES_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
        extra: {
          max: 20,
          min: 5,
          poolSize: 20,
          idleTimeoutMillis: 30000,
          connectTimeoutMS: 2000,
          acquireTimeoutMillis: 30000,
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Document, SearchDocument, Index]),
    forwardRef(() => SchemaModule),
  ],
  providers: [
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLSchemaManager,
    PostgreSQLIndexStats,
    DynamicIndexManagerService,
    PostgreSQLQueryBuilderService,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    AdaptiveQueryOptimizerService,
    TypoToleranceService,
    // Phase 3 Query Builders
    QueryBuilderFactory,
    MatchQueryBuilder,
    TermQueryBuilder,
    WildcardQueryBuilder,
    BoolQueryBuilder,
    MatchAllQueryBuilder,
    // Phase 3 Services
    BM25RankingService,
    FilterBuilderService,
    // Phase 5 Services
    SearchConfigurationService,
    SearchMetricsService,
  ],
  exports: [
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLSchemaManager,
    PostgreSQLIndexStats,
    DynamicIndexManagerService,
    PostgreSQLQueryBuilderService,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    AdaptiveQueryOptimizerService,
    TypeOrmModule,
    // Phase 3 exports
    QueryBuilderFactory,
    BM25RankingService,
    FilterBuilderService,
    // Phase 5 exports
    SearchConfigurationService,
    SearchMetricsService,
  ],
})
export class PostgreSQLModule {}
