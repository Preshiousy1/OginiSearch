import { Module } from '@nestjs/common';
import { IndexController } from './controllers/index.controller';
import { DocumentController } from './controllers/document.controller';
import { SearchController } from './controllers/search.controller';
import { IndexModule } from '../index/index.module';
import { DocumentModule } from '../document/document.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [IndexModule, DocumentModule, SearchModule],
  controllers: [IndexController, DocumentController, SearchController],
})
export class ApiModule {}
