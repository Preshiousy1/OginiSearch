import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoDBModule } from './mongodb.module';
import { DocumentRepository } from './repositories/document.repository';
import { SourceDocument, SourceDocumentSchema } from './schemas/document.schema';

@Module({
  imports: [
    MongoDBModule,
    MongooseModule.forFeature([{ name: SourceDocument.name, schema: SourceDocumentSchema }]),
  ],
  providers: [DocumentRepository],
  exports: [DocumentRepository],
})
export class DocumentModule {}
