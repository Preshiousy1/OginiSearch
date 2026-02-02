import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TermPostings,
  PostingEntry,
  MAX_POSTINGS_PER_CHUNK,
} from '../schemas/term-postings.schema';

/** Logical term posting (merged from chunks) for API compatibility */
export interface MergedTermPosting {
  indexName: string;
  term: string;
  postings: Record<string, PostingEntry>;
  documentCount: number;
  lastUpdated?: Date;
}

@Injectable()
export class TermPostingsRepository {
  constructor(
    @InjectModel(TermPostings.name)
    private readonly termPostingsModel: Model<TermPostings>,
  ) {}

  /**
   * Find by index-aware term: loads all chunks, merges postings, returns one logical doc.
   */
  async findByIndexAwareTerm(indexAwareTerm: string): Promise<MergedTermPosting | null> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    const chunks = await this.termPostingsModel
      .find({ indexName, term: indexAwareTerm })
      .sort({ chunkIndex: 1 })
      .lean()
      .exec();
    if (chunks.length === 0) return null;
    const merged: Record<string, PostingEntry> = {};
    let totalCount = 0;
    for (const ch of chunks) {
      for (const [docId, entry] of Object.entries(ch.postings || {})) {
        merged[docId] = entry as PostingEntry;
        totalCount++;
      }
    }
    return {
      indexName,
      term: indexAwareTerm,
      postings: merged,
      documentCount: totalCount,
      lastUpdated: chunks[chunks.length - 1]?.lastUpdated,
    };
  }

  /**
   * Find by legacy field:term format (returns any one chunk for existence check).
   */
  async findByIndexAndTerm(indexName: string, term: string): Promise<TermPostings | null> {
    return this.termPostingsModel.findOne({ indexName, term }).exec();
  }

  /**
   * Find all chunk documents for an index (caller must merge by term if needed).
   */
  async findByIndex(indexName: string): Promise<TermPostings[]> {
    return this.termPostingsModel.find({ indexName }).sort({ term: 1, chunkIndex: 1 }).exec();
  }

  /**
   * Create: single doc if postings <= MAX_POSTINGS_PER_CHUNK, else chunked via update.
   */
  async create(
    indexAwareTerm: string,
    postings: Record<string, PostingEntry>,
  ): Promise<TermPostings> {
    const keys = Object.keys(postings);
    if (keys.length <= MAX_POSTINGS_PER_CHUNK) {
      const indexName = this.extractIndexFromTerm(indexAwareTerm);
      const doc = new this.termPostingsModel({
        indexName,
        term: indexAwareTerm,
        chunkIndex: 0,
        postings,
        documentCount: keys.length,
        lastUpdated: new Date(),
      });
      return doc.save();
    }
    await this.update(indexAwareTerm, postings);
    const first = await this.termPostingsModel
      .findOne({ indexName: this.extractIndexFromTerm(indexAwareTerm), term: indexAwareTerm })
      .exec();
    return first!;
  }

  /**
   * Update: split postings into chunks of MAX_POSTINGS_PER_CHUNK, upsert each chunk, delete excess.
   */
  async update(
    indexAwareTerm: string,
    postings: Record<string, PostingEntry>,
  ): Promise<MergedTermPosting | null> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    const entries = Object.entries(postings);
    const chunks: Record<string, PostingEntry>[] = [];
    for (let i = 0; i < entries.length; i += MAX_POSTINGS_PER_CHUNK) {
      const slice = entries.slice(i, i + MAX_POSTINGS_PER_CHUNK);
      chunks.push(Object.fromEntries(slice));
    }
    const now = new Date();
    for (let c = 0; c < chunks.length; c++) {
      const postingsChunk = chunks[c];
      const count = Object.keys(postingsChunk).length;
      await this.termPostingsModel
        .findOneAndUpdate(
          { indexName, term: indexAwareTerm, chunkIndex: c },
          {
            postings: postingsChunk,
            documentCount: count,
            lastUpdated: now,
          },
          { new: true, upsert: true },
        )
        .exec();
    }
    const toDelete = await this.termPostingsModel
      .find({ indexName, term: indexAwareTerm, chunkIndex: { $gte: chunks.length } })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (toDelete.length > 0) {
      await this.termPostingsModel.deleteMany({
        _id: { $in: toDelete.map(d => d._id) },
      });
    }
    return this.findByIndexAwareTerm(indexAwareTerm);
  }

  /**
   * Delete all chunks for an index-aware term.
   */
  async deleteByIndexAwareTerm(indexAwareTerm: string): Promise<boolean> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    const result = await this.termPostingsModel
      .deleteMany({ indexName, term: indexAwareTerm })
      .exec();
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Delete by legacy format (for migration purposes)
   */
  async deleteByIndexAndTerm(indexName: string, term: string): Promise<boolean> {
    const result = await this.termPostingsModel.deleteOne({ indexName, term }).exec();
    return result.deletedCount > 0;
  }

  /**
   * Delete all terms for an index
   */
  async deleteByIndex(indexName: string): Promise<number> {
    const result = await this.termPostingsModel.deleteMany({ indexName }).exec();
    return result.deletedCount;
  }

  async findAll(): Promise<TermPostings[]> {
    return this.termPostingsModel.find().exec();
  }

  async getTermCount(indexName: string): Promise<number> {
    const result = await this.termPostingsModel
      .aggregate([{ $match: { indexName } }, { $group: { _id: '$term' } }, { $count: 'count' }])
      .exec();
    return result[0]?.count ?? 0;
  }

  /**
   * Bulk upsert: chunks each term's postings (max 5000 per doc) and upserts.
   */
  async bulkUpsert(
    termPostingsData: Array<{ indexAwareTerm: string; postings: Record<string, PostingEntry> }>,
  ): Promise<void> {
    const bulkOps: any[] = [];
    const now = new Date();
    for (const { indexAwareTerm, postings } of termPostingsData) {
      const indexName = this.extractIndexFromTerm(indexAwareTerm);
      const entries = Object.entries(postings);
      for (let i = 0; i < entries.length; i += MAX_POSTINGS_PER_CHUNK) {
        const slice = entries.slice(i, i + MAX_POSTINGS_PER_CHUNK);
        const chunkPostings = Object.fromEntries(slice);
        const chunkIndex = Math.floor(i / MAX_POSTINGS_PER_CHUNK);
        bulkOps.push({
          updateOne: {
            filter: { indexName, term: indexAwareTerm, chunkIndex },
            update: {
              $set: {
                postings: chunkPostings,
                documentCount: slice.length,
                lastUpdated: now,
              },
            },
            upsert: true,
          },
        });
      }
    }
    if (bulkOps.length > 0) {
      await this.termPostingsModel.bulkWrite(bulkOps);
    }
  }

  /**
   * Legacy bulk upsert (for migration): single chunk per term (chunkIndex 0).
   * Use update() for terms with > MAX_POSTINGS_PER_CHUNK so they get chunked.
   */
  async bulkUpsertLegacy(
    indexName: string,
    termPostingsData: Array<{ term: string; postings: Record<string, PostingEntry> }>,
  ): Promise<void> {
    const now = new Date();
    const bulkOps = termPostingsData.map(({ term, postings }) => ({
      updateOne: {
        filter: { indexName, term, chunkIndex: 0 },
        update: {
          $set: {
            postings,
            documentCount: Object.keys(postings).length,
            lastUpdated: now,
            chunkIndex: 0,
          },
        },
        upsert: true,
      },
    }));
    if (bulkOps.length > 0) {
      await this.termPostingsModel.bulkWrite(bulkOps);
    }
  }

  async deleteAll(): Promise<number> {
    const result = await this.termPostingsModel.deleteMany({}).exec();
    return result.deletedCount;
  }

  /**
   * Extract index name from index-aware term (index:field:term -> index)
   */
  private extractIndexFromTerm(indexAwareTerm: string): string {
    const firstColonIndex = indexAwareTerm.indexOf(':');
    if (firstColonIndex === -1) {
      throw new Error(
        `Invalid index-aware term format: ${indexAwareTerm}. Expected format: index:field:term`,
      );
    }
    return indexAwareTerm.substring(0, firstColonIndex);
  }

  /**
   * Migrate legacy terms (field:term) to index-aware format (index:field:term)
   * Optimized for large datasets (500k+ records)
   */
  async migrateLegacyTermsToIndexAware(): Promise<{
    totalProcessed: number;
    migratedCount: number;
    alreadyMigrated: number;
    errorCount: number;
  }> {
    const batchSize = 2000; // Optimized for MongoDB performance
    let totalProcessed = 0;
    let migratedCount = 0;
    const alreadyMigrated = 0;
    let errorCount = 0;

    // Count legacy terms (field:term format without initial index prefix)
    const legacyTermsCount = await this.termPostingsModel
      .countDocuments({ term: { $not: /^[^:]+:[^:]+:.+/ } })
      .exec();

    if (legacyTermsCount === 0) {
      return { totalProcessed: 0, migratedCount: 0, alreadyMigrated: 0, errorCount: 0 };
    }

    console.log(
      `🔄 Starting migration of ${legacyTermsCount.toLocaleString()} legacy terms in batches of ${batchSize}`,
    );

    while (totalProcessed < legacyTermsCount) {
      try {
        // Get batch of legacy terms
        const batch = await this.termPostingsModel
          .find({ term: { $not: /^[^:]+:[^:]+:.+/ } })
          .limit(batchSize)
          .exec();

        if (batch.length === 0) break;

        // Prepare bulk operations
        const bulkOps = batch.map(record => {
          const newTerm = `${record.indexName}:${record.term}`;
          return {
            updateOne: {
              filter: { _id: record._id },
              update: { $set: { term: newTerm, chunkIndex: record.chunkIndex ?? 0 } },
            },
          };
        });

        // Execute bulk update
        if (bulkOps.length > 0) {
          const result = await this.termPostingsModel.bulkWrite(bulkOps, {
            ordered: false, // Allow parallel processing for better performance
          });
          migratedCount += result.modifiedCount;
        }

        totalProcessed += batch.length;

        // Log progress every 10k records
        if (totalProcessed % 10000 === 0) {
          const progressPercent = (totalProcessed / legacyTermsCount) * 100;
          console.log(
            `📈 Migration progress: ${totalProcessed.toLocaleString()}/${legacyTermsCount.toLocaleString()} (${progressPercent.toFixed(
              1,
            )}%)`,
          );
        }
      } catch (error) {
        console.error(`❌ Batch migration error: ${error.message}`);
        errorCount += batchSize; // Assume entire batch failed
        totalProcessed += batchSize; // Continue processing
      }
    }

    console.log(
      `✅ Migration completed: ${migratedCount.toLocaleString()} terms migrated, ${errorCount} errors`,
    );

    return {
      totalProcessed,
      migratedCount,
      alreadyMigrated,
      errorCount,
    };
  }
}
