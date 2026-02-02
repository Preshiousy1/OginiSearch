import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** Max postings per document to stay under MongoDB 16MB limit (~5000 entries safe). */
export const MAX_POSTINGS_PER_CHUNK = 5000;

export interface PostingEntry {
  docId: string;
  frequency: number;
  positions?: number[];
  metadata?: Record<string, any>;
}

/**
 * Chunked term postings: one logical term can span multiple docs (chunkIndex 0,1,2...).
 * Each chunk holds at most MAX_POSTINGS_PER_CHUNK postings (tree of chunks per term).
 */
@Schema({
  collection: 'term_postings',
  timestamps: true,
})
export class TermPostings extends Document {
  @Prop({ required: true, index: true })
  indexName: string;

  @Prop({ required: true, index: true })
  term: string;

  @Prop({ required: true, default: 0 })
  chunkIndex: number;

  @Prop({ required: true, type: Object })
  postings: Record<string, PostingEntry>;

  @Prop({ default: Date.now })
  lastUpdated: Date;

  @Prop({ default: 0 })
  documentCount: number;
}

export const TermPostingsSchema = SchemaFactory.createForClass(TermPostings);

TermPostingsSchema.index({ indexName: 1, term: 1, chunkIndex: 1 }, { unique: true });
TermPostingsSchema.index({ indexName: 1, term: 1 });
