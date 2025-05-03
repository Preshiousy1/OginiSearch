import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { QueryProcessorService } from './query-processor.service';
import { QueryPlannerService } from './query-planner.service';
import { SearchExecutorService } from './search-executor.service';
import { IndexModule } from '../index/index.module';
import { StorageModule } from '../storage/storage.module';
import { AnalysisModule } from '../analysis/analysis.module';
@Module({
  imports: [IndexModule, StorageModule, AnalysisModule],
  providers: [SearchService, QueryProcessorService, QueryPlannerService, SearchExecutorService],
  exports: [SearchService, QueryProcessorService],
})
export class SearchModule {}
