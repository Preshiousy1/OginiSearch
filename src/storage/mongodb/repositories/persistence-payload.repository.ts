import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PersistencePayload } from '../schemas/persistence-payload.schema';

/**
 * Stores persistence job payloads in MongoDB so workers are not dependent on Redis
 * for large payloads (avoids eviction and "payload key not found" / unnamed job issues).
 */
@Injectable()
export class PersistencePayloadRepository {
  constructor(
    @InjectModel(PersistencePayload.name)
    private readonly model: Model<PersistencePayload>,
  ) {}

  async set(key: string, value: string): Promise<void> {
    await this.model
      .findOneAndUpdate({ key }, { key, value, createdAt: new Date() }, { upsert: true, new: true })
      .exec();
  }

  async get(key: string): Promise<string | null> {
    const doc = await this.model.findOne({ key }).lean().exec();
    return doc?.value ?? null;
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.model.deleteOne({ key }).exec();
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Find all payload keys for a given index name.
   * Payload keys follow the pattern: persist:payload:bulk:${indexName}:...
   */
  async findAllKeysForIndex(indexName: string): Promise<string[]> {
    const pattern = `persist:payload:bulk:${indexName}:`;
    const docs = await this.model
      .find({ key: { $regex: `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
      .select('key')
      .lean()
      .exec();
    return docs.map(doc => doc.key);
  }

  /**
   * Find all payloads for a given index name.
   * Returns an array of { key, value } objects.
   */
  async findAllForIndex(indexName: string): Promise<Array<{ key: string; value: string }>> {
    const pattern = `persist:payload:bulk:${indexName}:`;
    const docs = await this.model
      .find({ key: { $regex: `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
      .lean()
      .exec();
    return docs.map(doc => ({ key: doc.key, value: doc.value }));
  }

  /**
   * Diagnostic: total count and sample keys to debug empty recovery results.
   */
  async getDiagnostics(): Promise<{
    totalCount: number;
    sampleKeys: string[];
  }> {
    const totalCount = await this.model.countDocuments().exec();
    const sampleDocs = await this.model.find().select('key').limit(5).lean().exec();
    return {
      totalCount,
      sampleKeys: sampleDocs.map(d => d.key),
    };
  }
}
