import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** TTL for pending job refs; auto-delete after 7 days */
const PENDING_JOB_TTL_SEC = 86400 * 7;

/**
 * Pending persistence job reference. When Bull's job key is evicted in Redis,
 * the worker gets an "unnamed" job with empty data. This collection lets us
 * recover: we pop the oldest pending ref, load the payload by payloadKey, and process.
 */
@Schema({
  collection: 'persistence_pending_jobs',
  timestamps: false,
})
export class PersistencePendingJob extends Document {
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

export const PersistencePendingJobSchema = SchemaFactory.createForClass(PersistencePendingJob);

PersistencePendingJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: PENDING_JOB_TTL_SEC });
PersistencePendingJobSchema.index({ payloadKey: 1 }, { unique: true });
