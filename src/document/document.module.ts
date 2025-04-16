import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { DocumentProcessorService } from './document-processor.service';

@Module({
  imports: [AnalysisModule],
  providers: [DocumentProcessorService],
  exports: [DocumentProcessorService],
})
export class DocumentModule {}
