import { forwardRef, Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { IndexModule } from '../index/index.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { SearchModule } from '../search/search.module';
import { DocumentProcessorService } from './document-processor.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { InMemoryTermDictionary } from '../index/term-dictionary';
@Module({
  imports: [
    IndexModule,
    StorageModule,
    forwardRef(() => IndexingModule),
    forwardRef(() => SearchModule),
    forwardRef(() => AnalysisModule),
  ],
  providers: [DocumentService, DocumentProcessorService],
  exports: [DocumentService, DocumentProcessorService],
})
export class DocumentModule {}
