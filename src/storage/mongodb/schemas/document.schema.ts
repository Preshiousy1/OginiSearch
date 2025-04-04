import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DocumentEntity = SourceDocument & Document;

@Schema({
  timestamps: true,
  collection: 'documents',
  id: true,
})
export class SourceDocument {
  @Prop({ required: true, index: true })
  indexName: string;

  @Prop({ required: true, index: true })
  documentId: string;

  @Prop({ type: Object, required: true })
  content: Record<string, any>;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const SourceDocumentSchema = SchemaFactory.createForClass(SourceDocument);

// Create a compound unique index on indexName and documentId
SourceDocumentSchema.index({ indexName: 1, documentId: 1 }, { unique: true });
