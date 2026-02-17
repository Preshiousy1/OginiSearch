import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** TTL for pending indexing job refs; auto-delete after 7 days */
const PENDING_INDEXING_TTL_SEC = 86400 * 7;

/**
 * Pending indexing (batch) job reference. When Bull's job data is evicted in Redis,
 * the worker gets an "unnamed" job with empty payload. This collection lets us
 * recover: we pop the oldest pending ref, load the batch payload by payloadKey, and process.
 */
@Schema({
  collection: 'indexing_pending_jobs',
  timestamps: false,
})
export class IndexingPendingJob extends Document {
  @Prop({ required: true })
  payloadKey: string;

  @Prop({ required: true })
  indexName: string;

  @Prop({ required: true })
  batchId: string;

  @Prop({ required: true })
  bulkOpId: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const IndexingPendingJobSchema = SchemaFactory.createForClass(IndexingPendingJob);

IndexingPendingJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: PENDING_INDEXING_TTL_SEC });
IndexingPendingJobSchema.index({ payloadKey: 1 }, { unique: true });
