import { forwardRef, Module } from '@nestjs/common';
import { IndexService } from './index.service';
import { IndexStatsService } from './index-stats.service';
import { BM25Scorer } from './bm25-scorer';
import { TermDictionary } from './term-dictionary';
import { StorageModule } from '../storage/storage.module';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';
import { DocumentCountVerifierService } from './document-count-verifier.service';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexingModule } from '../indexing/indexing.module';

@Module({
  imports: [StorageModule, ScheduleModule.forRoot(), forwardRef(() => IndexingModule)],
  providers: [
    IndexService,
    IndexStatsService,
    DocumentCountVerifierService,
    PostgreSQLService,
    {
      provide: 'TERM_DICTIONARY',
      useFactory: (postgresqlService: PostgreSQLService) =>
        new TermDictionary({ persistToDisk: true }, postgresqlService),
      inject: [PostgreSQLService],
    },
    {
      provide: BM25Scorer,
      useFactory: (indexStats: IndexStatsService) =>
        new BM25Scorer(indexStats, { k1: 1.2, b: 0.75 }),
      inject: [IndexStatsService],
    },
  ],
  exports: [IndexService, IndexStatsService, 'TERM_DICTIONARY'],
})
export class IndexModule {}
