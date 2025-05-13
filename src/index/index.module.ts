import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexService } from './index.service';
import { StorageModule } from '../storage/storage.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { InMemoryTermDictionary } from './term-dictionary';
import { IndexStatsService } from './index-stats.service';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';
import { RocksDBService } from 'src/storage/rocksdb/rocksdb.service';
import { BM25Scorer } from './bm25-scorer';
import { DocumentCountVerifierService } from './document-count-verifier.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => StorageModule),
    forwardRef(() => AnalysisModule),
  ],
  providers: [
    IndexService,
    IndexStatsService,
    {
      provide: 'TERM_DICTIONARY',
      useFactory: (rocksDBService: RocksDBService) =>
        new InMemoryTermDictionary(
          {
            useCompression: false,
            persistToDisk: true,
          },
          rocksDBService,
        ),
      inject: [RocksDBService],
    },
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
    DocumentCountVerifierService,
  ],
  exports: [
    'TERM_DICTIONARY',
    IndexStatsService,
    'BM25_SCORER',
    SimplePostingList,
    CompressedPostingList,
    IndexService,
    DocumentCountVerifierService,
  ],
})
export class IndexModule {}
