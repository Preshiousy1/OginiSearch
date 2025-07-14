import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostgreSQLService } from './postgresql.service';
import { PostgreSQLFuzzySearch } from './postgresql-fuzzy-search';
import { PostgreSQLSchemaManager } from './postgresql-schema-manager';
import { Document } from './entities/document.entity';
import { SearchDocument } from './entities/search-document.entity';
import { Index } from './entities/index.entity';
import { SchemaModule } from '../../schema/schema.module';

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
        synchronize: false,
        logging: false,
        ssl:
          configService.get<string>('NODE_ENV') === 'production'
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
  providers: [PostgreSQLService, PostgreSQLFuzzySearch, PostgreSQLSchemaManager],
  exports: [PostgreSQLService, PostgreSQLFuzzySearch, PostgreSQLSchemaManager, TypeOrmModule],
})
export class PostgreSQLModule {}
