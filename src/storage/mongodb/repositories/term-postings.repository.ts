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

  async findByIndexAndTerm(indexName: string, term: string): Promise<TermPostings | null> {
    return this.termPostingsModel.findOne({ indexName, term }).exec();
  }

  async findByIndex(indexName: string): Promise<TermPostings[]> {
    return this.termPostingsModel.find({ indexName }).exec();
  }

  async create(
    indexName: string,
    term: string,
    postings: Record<string, PostingEntry>,
  ): Promise<TermPostings> {
    const termPostings = new this.termPostingsModel({
      indexName,
      term,
      postings,
      documentCount: Object.keys(postings).length,
      lastUpdated: new Date(),
    });
    return termPostings.save();
  }

  async update(
    indexName: string,
    term: string,
    postings: Record<string, PostingEntry>,
  ): Promise<TermPostings | null> {
    return this.termPostingsModel
      .findOneAndUpdate(
        { indexName, term },
        {
          postings,
          documentCount: Object.keys(postings).length,
          lastUpdated: new Date(),
        },
        { new: true, upsert: true },
      )
      .exec();
  }

  async deleteByIndexAndTerm(indexName: string, term: string): Promise<boolean> {
    const result = await this.termPostingsModel.deleteOne({ indexName, term }).exec();
    return result.deletedCount > 0;
  }

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

  async bulkUpsert(
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
}
