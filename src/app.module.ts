import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { IndexManagerModule } from './index-manager/index-manager.module';
import { SearchEngineModule } from './search-engine/search-engine.module';
import { DocumentManagerModule } from './document-manager/document-manager.module';
import { TextAnalysisModule } from './text-analysis/text-analysis.module';
import { StorageModule } from './storage/storage.module';
import { SchemaModule } from './schema/schema.module';
import { AnalysisModule } from './analysis/analysis.module';
import { HealthModule } from './index/interfaces/health/health.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
