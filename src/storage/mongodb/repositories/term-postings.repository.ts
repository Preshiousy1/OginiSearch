import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TermPostings, PostingEntry } from '../schemas/term-postings.schema';

@Injectable()
export class TermPostingsRepository {
  constructor(
    @InjectModel(TermPostings.name)
    private readonly termPostingsModel: Model<TermPostings>,
  ) {}

  /**
   * Find by index-aware term (index:field:term format)
   */
  async findByIndexAwareTerm(indexAwareTerm: string): Promise<TermPostings | null> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    return this.termPostingsModel.findOne({ indexName, term: indexAwareTerm }).exec();
  }

  /**
   * Find by legacy field:term format (for migration purposes only)
   */
  async findByIndexAndTerm(indexName: string, term: string): Promise<TermPostings | null> {
    return this.termPostingsModel.findOne({ indexName, term }).exec();
  }

  /**
   * Find all terms for a specific index
   */
  async findByIndex(indexName: string): Promise<TermPostings[]> {
    return this.termPostingsModel.find({ indexName }).exec();
  }

  /**
   * Create new term posting with index-aware term
   */
  async create(
    indexAwareTerm: string,
    postings: Record<string, PostingEntry>,
  ): Promise<TermPostings> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    const termPostings = new this.termPostingsModel({
      indexName,
      term: indexAwareTerm, // Store full index-aware term
      postings,
      documentCount: Object.keys(postings).length,
      lastUpdated: new Date(),
    });
    return termPostings.save();
  }

  /**
   * Update term posting with index-aware term
   */
  async update(
    indexAwareTerm: string,
    postings: Record<string, PostingEntry>,
  ): Promise<TermPostings | null> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    return this.termPostingsModel
      .findOneAndUpdate(
        { indexName, term: indexAwareTerm },
        {
          postings,
          documentCount: Object.keys(postings).length,
          lastUpdated: new Date(),
        },
        { new: true, upsert: true },
      )
      .exec();
  }

  /**
   * Delete by index-aware term
   */
  async deleteByIndexAwareTerm(indexAwareTerm: string): Promise<boolean> {
    const indexName = this.extractIndexFromTerm(indexAwareTerm);
    const result = await this.termPostingsModel
      .deleteOne({ indexName, term: indexAwareTerm })
      .exec();
    return result.deletedCount > 0;
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
    return this.termPostingsModel.countDocuments({ indexName }).exec();
  }

  /**
   * Bulk upsert with index-aware terms
   */
  async bulkUpsert(
    termPostingsData: Array<{ indexAwareTerm: string; postings: Record<string, PostingEntry> }>,
  ): Promise<void> {
    const bulkOps = termPostingsData.map(({ indexAwareTerm, postings }) => {
      const indexName = this.extractIndexFromTerm(indexAwareTerm);
      return {
        updateOne: {
          filter: { indexName, term: indexAwareTerm },
          update: {
            $set: {
              postings,
              documentCount: Object.keys(postings).length,
              lastUpdated: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    if (bulkOps.length > 0) {
      await this.termPostingsModel.bulkWrite(bulkOps);
    }
  }

  /**
   * Legacy bulk upsert (for migration purposes)
   */
  async bulkUpsertLegacy(
    indexName: string,
    termPostingsData: Array<{ term: string; postings: Record<string, PostingEntry> }>,
  ): Promise<void> {
    const bulkOps = termPostingsData.map(({ term, postings }) => ({
      updateOne: {
        filter: { indexName, term },
        update: {
          $set: {
            postings,
            documentCount: Object.keys(postings).length,
            lastUpdated: new Date(),
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
              update: { $set: { term: newTerm } },
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
