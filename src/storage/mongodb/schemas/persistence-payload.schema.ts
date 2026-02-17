import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** TTL for payloads (same as Redis fallback); auto-delete after this many seconds */
export const PERSISTENCE_PAYLOAD_TTL_SEC = 86400 * 7; // 7 days

/**
 * Out-of-band persistence job payload stored in MongoDB to avoid Redis eviction.
 * Key matches Bull payload's payloadKey (e.g. persist:payload:bulkOpId:batchId).
 */
@Schema({
  collection: 'persistence_payloads',
  timestamps: false,
})
export class PersistencePayload extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, type: String })
  value: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const PersistencePayloadSchema = SchemaFactory.createForClass(PersistencePayload);

// TTL: remove documents after 7 days so we don't accumulate stale payloads
PersistencePayloadSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: PERSISTENCE_PAYLOAD_TTL_SEC },
);
