import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface PostingEntry {
  docId: string;
  frequency: number;
  positions?: number[];
  metadata?: Record<string, any>;
}

@Schema({
  collection: 'term_postings',
  timestamps: true,
})
export class TermPostings extends Document {
  @Prop({ required: true, index: true })
  indexName: string;

  @Prop({ required: true, index: true })
  term: string;

  @Prop({ required: true, type: Object })
  postings: Record<string, PostingEntry>;

  @Prop({ default: Date.now })
  lastUpdated: Date;

  @Prop({ default: 0 })
  documentCount: number;
}

export const TermPostingsSchema = SchemaFactory.createForClass(TermPostings);

// Compound index for efficient queries
TermPostingsSchema.index({ indexName: 1, term: 1 }, { unique: true });
