import { Module } from '@nestjs/common';
import { InMemoryTermDictionary } from './term-dictionary';
import { SimplePostingList } from './posting-list';
import { CompressedPostingList } from './compressed-posting-list';

@Module({
  providers: [
    {
      provide: 'TERM_DICTIONARY',
      useFactory: () => new InMemoryTermDictionary({ useCompression: true }),
    },
    SimplePostingList,
    CompressedPostingList,
  ],
  exports: ['TERM_DICTIONARY', SimplePostingList, CompressedPostingList],
})
export class IndexModule {}
