import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IndexingPendingJob } from '../schemas/indexing-pending-job.schema';

export interface IndexingPendingRef {
  payloadKey: string;
  indexName: string;
  batchId: string;
  bulkOpId: string;
}

/**
 * Tracks pending indexing (batch) jobs in MongoDB. When Bull's job data is evicted,
 * the worker gets an unnamed job; we pop the oldest ref and re-queue with payloadKey so the batch runs.
 */
@Injectable()
export class IndexingPendingJobRepository {
  constructor(
    @InjectModel(IndexingPendingJob.name)
    private readonly model: Model<IndexingPendingJob>,
  ) {}

  async add(ref: IndexingPendingRef): Promise<void> {
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
   * Atomically take the oldest pending job. Returns null if none.
   */
  async popOldest(): Promise<IndexingPendingRef | null> {
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
