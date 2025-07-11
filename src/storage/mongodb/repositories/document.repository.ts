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
        .select({
          indexName: 1,
          documentId: 1,
          content: 1,
          metadata: 1,
          _id: 0,
        })
        .lean()
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

      this.logger.debug(`Base query: ${JSON.stringify(query)}`);
      this.logger.debug(`Filter: ${JSON.stringify(filter)}`);

      // Handle content field filtering properly
      if (filter && Object.keys(filter).length > 0) {
        // For each field in the filter, create the proper MongoDB query
        Object.entries(filter).forEach(([field, value]) => {
          // Special handling for documentId which is a top-level field
          if (field === 'documentId') {
            query[field] = value;
          } else {
            // For other fields, assume they are in the content object
            query[`content.${field}`] = value;
          }
        });
      }

      // Build the query
      let documentQuery = this.documentModel
        .find(query)
        .select({
          indexName: 1,
          documentId: 1,
          content: 1,
          metadata: 1,
          _id: 0,
        })
        .sort({ createdAt: -1 })
        .skip(offset);

      // Only apply limit if it's greater than 0 (0 means no limit)
      if (limit > 0) {
        documentQuery = documentQuery.limit(limit);
      }

      const [documents, total] = await Promise.all([
        documentQuery.lean().exec(),
        this.documentModel.countDocuments(query).exec(),
      ]);

      this.logger.debug(`Found ${documents.length} documents`);
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

  async upsert(document: Omit<SourceDocument, '_id'>): Promise<DocumentEntity> {
    try {
      const { indexName, documentId, ...updateData } = document;

      const upsertedDocument = await this.documentModel
        .findOneAndUpdate(
          { indexName, documentId },
          { $set: updateData },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
          },
        )
        .exec();

      return upsertedDocument;
    } catch (error) {
      this.logger.error(`Failed to upsert document: ${error.message}`, error.stack);
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

  async deleteAll(): Promise<void> {
    await this.documentModel.deleteMany({});
  }
}
