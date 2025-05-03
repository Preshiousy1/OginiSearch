import { forwardRef, Module } from '@nestjs/common';
import { IndexingService } from './indexing.service';
import { StorageModule } from '../storage/storage.module';
import { DocumentModule } from '../document/document.module';
import { IndexModule } from '../index/index.module';

@Module({
  imports: [StorageModule, IndexModule, forwardRef(() => DocumentModule)],
  providers: [IndexingService],
  exports: [IndexingService],
})
export class IndexingModule {}
