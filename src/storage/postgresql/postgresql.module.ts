import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostgreSQLService } from './postgresql.service';
import { PostgreSQLFuzzySearch } from './postgresql-fuzzy-search';
import { PostgreSQLIndexStats } from './postgresql-index-stats';
import { PostgreSQLResultProcessorService } from './result-processor.service';
import { PostgreSQLPerformanceMonitorService } from './performance-monitor.service';
import { OptimizedQueryCacheService } from './optimized-query-cache.service';
import { TypoToleranceService } from '../../search/typo-tolerance.service';
import { Document } from './entities/document.entity';
import { Index } from './entities/index.entity';
import { SchemaModule } from '../../schema/schema.module';
import { BM25RankingService } from './bm25-ranking.service';
import { FilterBuilderService } from './filter-builder.service';
import { PostgreSQLDocumentProcessor } from './postgresql-document-processor';
import { PostgreSQLAnalysisAdapter } from './postgresql-analysis.adapter';
import { AnalysisModule } from 'src/analysis/analysis.module';
import { RedisCacheService } from './redis-cache.service';
import { PostgreSQLSearchEngine } from './postgresql-search-engine';

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
        entities: [Document, Index],
        synchronize: false,
        logging: false,
        ssl:
          configService.get<string>('POSTGRES_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
        extra: {
          max: 25,
          min: 10,
          poolSize: 25,
          idleTimeoutMillis: 30000,
          connectTimeoutMS: 2000,
          acquireTimeoutMillis: 5000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 0,
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Document, Index]),
    forwardRef(() => SchemaModule),
    forwardRef(() => AnalysisModule),
  ],
  providers: [
    PostgreSQLDocumentProcessor,
    PostgreSQLAnalysisAdapter,
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLIndexStats,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    TypoToleranceService,
    BM25RankingService,
    FilterBuilderService,
    RedisCacheService,
    PostgreSQLSearchEngine,
  ],
  exports: [
    PostgreSQLService,
    PostgreSQLFuzzySearch,
    PostgreSQLIndexStats,
    PostgreSQLResultProcessorService,
    PostgreSQLPerformanceMonitorService,
    OptimizedQueryCacheService,
    TypeOrmModule,
    BM25RankingService,
    FilterBuilderService,
    PostgreSQLAnalysisAdapter,
    PostgreSQLDocumentProcessor,
    RedisCacheService,
    PostgreSQLSearchEngine,
  ],
})
export class PostgreSQLModule {}
