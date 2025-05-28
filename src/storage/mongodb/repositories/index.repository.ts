import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IndexMetadata, IndexMetadataDocument } from '../schemas/index.schema';
import { Index } from '../../../index/interfaces/index.interface';

@Injectable()
export class IndexRepository {
  private readonly logger = new Logger(IndexRepository.name);

  constructor(
    @InjectModel(IndexMetadata.name)
    private readonly indexModel: Model<IndexMetadataDocument>,
  ) {}

  async create(index: Index): Promise<IndexMetadataDocument> {
    this.logger.log(`Creating index metadata in MongoDB for: ${index.name}`);
    try {
      const newIndex = new this.indexModel(index);
      const result = await newIndex.save();
      this.logger.log(`Successfully created index metadata in MongoDB for: ${index.name}`);
      return result;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error
        this.logger.error(`Duplicate index error for ${index.name}`);
        throw new ConflictException(`Index with name ${index.name} already exists`);
      }
      this.logger.error(
        `Failed to create index metadata for ${index.name}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findByName(name: string): Promise<IndexMetadataDocument | null> {
    return this.indexModel.findOne({ name }).exec();
  }

  async findAll(status?: string): Promise<IndexMetadataDocument[]> {
    const filter = status ? { status } : {};
    return this.indexModel.find(filter).exec();
  }

  async update(name: string, updates: Partial<Index>): Promise<IndexMetadataDocument | null> {
    return this.indexModel
      .findOneAndUpdate(
        { name },
        { ...updates, updatedAt: new Date().toISOString() },
        { new: true },
      )
      .exec();
  }

  async delete(name: string): Promise<boolean> {
    try {
      this.logger.debug(`Attempting to delete index metadata for: ${name}`);
      const result = await this.indexModel.deleteOne({ name }).exec();
      this.logger.debug(`Delete result for ${name}: deletedCount=${result.deletedCount}`);
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(
        `Failed to delete index metadata for ${name}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async updateDocumentCount(name: string, count: number): Promise<void> {
    await this.indexModel
      .updateOne({ name }, { documentCount: count, updatedAt: new Date().toISOString() })
      .exec();
  }
}
