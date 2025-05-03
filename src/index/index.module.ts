import { Module } from '@nestjs/common';
import { InMemoryTermDictionary } from './term-dictionary';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { IndexStatsService } from './index-stats.service';
import { BM25Scorer } from './bm25-scorer';
import { IndexService } from './index.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { StorageModule } from '../storage/storage.module';
@Module({
  imports: [StorageModule, AnalysisModule],
  providers: [
    {
      provide: 'TERM_DICTIONARY',
      useFactory: () => new InMemoryTermDictionary({ useCompression: true }),
    },
    IndexStatsService,
    {
      provide: 'BM25_SCORER',
      useFactory: (indexStats: IndexStatsService) =>
        new BM25Scorer(indexStats, {
          k1: 1.2,
          b: 0.75,
          fieldWeights: { title: 3.0, body: 1.0, keywords: 2.0 },
        }),
      inject: [IndexStatsService],
    },
    SimplePostingList,
    CompressedPostingList,
    IndexService,
  ],
  exports: [
    'TERM_DICTIONARY',
    IndexStatsService,
    'BM25_SCORER',
    SimplePostingList,
    CompressedPostingList,
    IndexService,
  ],
})
export class IndexModule {}
