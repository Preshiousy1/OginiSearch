import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'indices',
  id: true,
})
export class IndexMetadata {
  @Prop({ required: true, unique: true, index: true })
  name: string;

  @Prop({ type: Object, required: true })
  settings: Record<string, any>;

  @Prop({ type: Object, required: true })
  mappings: Record<string, any>;

  @Prop({ required: true, default: 'open' })
  status: string;

  @Prop({ required: true, default: 0 })
  documentCount: number;

  @Prop({ required: true })
  createdAt: string;

  @Prop()
  updatedAt?: string;
}

export type IndexMetadataDocument = IndexMetadata & Document;
export const IndexMetadataSchema = SchemaFactory.createForClass(IndexMetadata);
