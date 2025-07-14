import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PostgreSQLModule } from '../storage/postgresql/postgresql.module';
import { PostgreSQLSearchEngine } from '../storage/postgresql/postgresql-search-engine';
import { PostgreSQLAnalysisAdapter } from '../storage/postgresql/postgresql-analysis.adapter';
import { PostgreSQLDocumentProcessor } from '../storage/postgresql/postgresql-document-processor';
import { SearchModule } from '../search/search.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [ConfigModule, PostgreSQLModule, SearchModule, AnalysisModule],
  providers: [
    PostgreSQLAnalysisAdapter,
    PostgreSQLDocumentProcessor,
    PostgreSQLSearchEngine,
    {
      provide: 'SEARCH_ENGINE',
      useFactory: (configService: ConfigService, postgresEngine: PostgreSQLSearchEngine) => {
        // Use PostgreSQL as the primary search engine
        const searchEngine = configService.get<string>('SEARCH_ENGINE', 'postgresql');

        if (searchEngine === 'postgresql') {
          return postgresEngine;
        }

        // Default to PostgreSQL if no specific engine is configured
        return postgresEngine;
      },
      inject: [ConfigService, PostgreSQLSearchEngine],
    },
  ],
  exports: [
    'SEARCH_ENGINE',
    PostgreSQLSearchEngine,
    PostgreSQLAnalysisAdapter,
    PostgreSQLDocumentProcessor,
  ],
})
export class SearchEngineModule {}
