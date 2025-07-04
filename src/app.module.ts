import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { StorageModule } from './storage/storage.module';
import { IndexManagerModule } from './index-manager/index-manager.module';
import { SearchEngineModule } from './search-engine/search-engine.module';
import { DocumentManagerModule } from './document-manager/document-manager.module';
import { TextAnalysisModule } from './text-analysis/text-analysis.module';
import { HealthModule } from './index/interfaces/health/health.module';
import { SchemaModule } from './schema/schema.module';
import { AnalysisModule } from './analysis/analysis.module';
import { ApiModule } from './api/api.module';
import { DocumentationModule } from './api/documentation/documentation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Global Bull configuration (matches Omume project pattern)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          url: configService.get<string>('REDIS_URL'),
          username: configService.get<string>('REDIS_USERNAME'),
          password: configService.get<string>('REDIS_PASSWORD'),
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get<string>('REDIS_PORT')),
          family: 0,
        },
      }),
      inject: [ConfigService],
    }),
    StorageModule,
    IndexManagerModule,
    SearchEngineModule,
    DocumentManagerModule,
    TextAnalysisModule,
    HealthModule,
    SchemaModule,
    AnalysisModule,
    ApiModule,
    DocumentationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
