import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PersistencePendingJob } from '../schemas/persistence-pending-job.schema';

export interface PendingJobRef {
  payloadKey: string;
  indexName: string;
  batchId: string;
  bulkOpId: string;
}

/**
 * Tracks pending persistence jobs in MongoDB. When Bull's job is evicted (unnamed job),
 * the worker can pop the oldest ref and process by payloadKey so no batch is lost.
 */
@Injectable()
export class PersistencePendingJobRepository {
  constructor(
    @InjectModel(PersistencePendingJob.name)
    private readonly model: Model<PersistencePendingJob>,
  ) {}

  async add(ref: PendingJobRef): Promise<void> {
    const now = new Date();
    await this.model
      .findOneAndUpdate(
        { payloadKey: ref.payloadKey },
        {
          payloadKey: ref.payloadKey,
          indexName: ref.indexName,
          batchId: ref.batchId,
          bulkOpId: ref.bulkOpId,
          createdAt: now,
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async removeByPayloadKey(payloadKey: string): Promise<boolean> {
    const result = await this.model.deleteOne({ payloadKey }).exec();
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Check if a pending job ref exists for a payload key (without removing it).
   */
  async existsByPayloadKey(payloadKey: string): Promise<boolean> {
    const count = await this.model.countDocuments({ payloadKey }).exec();
    return count > 0;
  }

  /**
   * Atomically take the oldest pending job. Returns null if none.
   */
  async popOldest(): Promise<PendingJobRef | null> {
    const doc = await this.model
      .findOneAndDelete({}, { sort: { createdAt: 1 } })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      payloadKey: doc.payloadKey,
      indexName: doc.indexName,
      batchId: doc.batchId,
      bulkOpId: doc.bulkOpId,
    };
  }
}
