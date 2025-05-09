import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, UpdateQuery, QueryOptions } from 'mongoose';
import { SourceDocument, DocumentEntity } from '../schemas/document.schema';

@Injectable()
export class DocumentRepository {
  private readonly logger = new Logger(DocumentRepository.name);

  constructor(@InjectModel(SourceDocument.name) private documentModel: Model<DocumentEntity>) {}

  async create(document: Omit<SourceDocument, '_id'>): Promise<DocumentEntity> {
    try {
      const newDocument = new this.documentModel(document);
      return await newDocument.save();
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error
        throw new ConflictException(
          `Document with ID ${document.documentId} already exists in index ${document.indexName}`,
        );
      }
      this.logger.error(`Failed to create document: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findOne(indexName: string, documentId: string): Promise<DocumentEntity | null> {
    try {
      return await this.documentModel
        .findOne({
          indexName,
          documentId,
        })
        .exec();
    } catch (error) {
      this.logger.error(`Error finding document: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findAll(
    indexName: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: FilterQuery<DocumentEntity>;
    } = {},
  ): Promise<{ documents: DocumentEntity[]; total: number }> {
    try {
      const { limit = 100, offset = 0, filter = {} } = options;
      // Base query with index name
      const query: FilterQuery<DocumentEntity> = { indexName };

      // Handle content field filtering properly
      if (filter && Object.keys(filter).length > 0) {
        // For each field in the filter, create the proper MongoDB query
        Object.entries(filter).forEach(([field, value]) => {
          // Create a query that matches documents where the field in content matches the value
          query[`content.${field}`] = value;
        });
      }

      const [documents, total] = await Promise.all([
        this.documentModel.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).exec(),
        this.documentModel.countDocuments(query).exec(),
      ]);

      return { documents, total };
    } catch (error) {
      this.logger.error(`Failed to find documents: ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(
    indexName: string,
    documentId: string,
    updateData: UpdateQuery<DocumentEntity>,
  ): Promise<DocumentEntity> {
    try {
      const updatedDocument = await this.documentModel
        .findOneAndUpdate({ indexName, documentId }, updateData, { new: true })
        .exec();

      if (!updatedDocument) {
        throw new NotFoundException(
          `Document with ID ${documentId} not found in index ${indexName}`,
        );
      }

      return updatedDocument;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update document: ${error.message}`, error.stack);
      throw error;
    }
  }

  async delete(indexName: string, documentId: string): Promise<boolean> {
    try {
      const result = await this.documentModel.deleteOne({ indexName, documentId }).exec();
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to delete document: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteMany(indexName: string, documentIds?: string[]): Promise<number> {
    try {
      const query: FilterQuery<DocumentEntity> = { indexName };

      if (documentIds && documentIds.length > 0) {
        query.documentId = { $in: documentIds };
      }

      const result = await this.documentModel.deleteMany(query).exec();
      return result.deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete documents: ${error.message}`, error.stack);
      throw error;
    }
  }

  async bulkWrite(operations: any[]): Promise<any> {
    try {
      return await this.documentModel.bulkWrite(operations);
    } catch (error) {
      this.logger.error(`Failed to perform bulk write: ${error.message}`, error.stack);
      throw error;
    }
  }
}
