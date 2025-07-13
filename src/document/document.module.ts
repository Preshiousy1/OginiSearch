import { forwardRef, Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { IndexModule } from '../index/index.module';
import { StorageModule } from '../storage/storage.module';
import { IndexingModule } from '../indexing/indexing.module';
import { BulkIndexingModule } from '../indexing/bulk-indexing.module';
import { SearchModule } from '../search/search.module';
import { DocumentProcessorService } from './document-processor.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { TermDictionary } from '../index/term-dictionary';
import { DocumentProcessingService } from './document-processing.service';

@Module({
  imports: [
    forwardRef(() => IndexModule),
    forwardRef(() => StorageModule),
    forwardRef(() => IndexingModule),
    forwardRef(() => BulkIndexingModule),
    forwardRef(() => SearchModule),
    forwardRef(() => AnalysisModule),
  ],
  providers: [DocumentService, DocumentProcessorService, DocumentProcessingService],
  exports: [DocumentService, DocumentProcessorService, DocumentProcessingService],
})
export class DocumentModule {}
