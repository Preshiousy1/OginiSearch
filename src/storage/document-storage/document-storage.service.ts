import { Injectable, Logger, Optional, BadRequestException } from '@nestjs/common';
import { DocumentRepository } from '../mongodb/repositories/document.repository';
import { SourceDocument } from '../mongodb/schemas/document.schema';
import { MongoDBService } from '../mongodb/mongodb.service';
import { SchemaVersionManagerService } from '../../schema/schema-version-manager.service';

interface DocumentStorageOptions {
  batchSize?: number;
}

@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly defaultOptions: DocumentStorageOptions = {
    batchSize: 100,
  };
  private useInMemoryFallback = false;
  private inMemoryStore: Map<string, any> = new Map();

  constructor(
    @Optional() private readonly documentRepository: DocumentRepository,
    // private readonly mongoDBService: MongoDBService,
    private readonly schemaVersionManager: SchemaVersionManagerService,
  ) {
    if (!documentRepository) {
      this.logger.warn('MongoDB repository not available, using in-memory fallback');
      this.useInMemoryFallback = true;
    }
  }

  async storeDocument(
    indexName: string,
    {
      documentId,
      content,
      metadata = {},
    }: {
      documentId: string;
      content: Record<string, any>;
      metadata?: Record<string, any>;
    },
    schemaName?: string,
  ): Promise<SourceDocument> {
    try {
      // If schema is provided, validate the document before storage
      if (schemaName) {
        const validationResult = await this.schemaVersionManager.validateDocument(
          schemaName,
          content,
        );
        if (!validationResult.valid) {
          throw new BadRequestException({
            message: 'Document validation failed',
            errors: validationResult.errors,
          });
        }

        // Add schema metadata to the document
        const schema = await this.schemaVersionManager.getSchema(schemaName);
        content._schema = {
          name: schemaName,
          version: schema.version,
        };
      }

      const document = {
        indexName,
        documentId,
        content,
        metadata,
      };

      const result = await this.documentRepository.create(document);
      return result;
    } catch (error) {
      this.logger.error(`Failed to store document: ${error.message}`);
      throw error;
    }
  }

  async getDocument(indexName: string, documentId: string): Promise<SourceDocument | null> {
    try {
      return await this.documentRepository.findOne(indexName, documentId);
    } catch (error) {
      this.logger.error(`Failed to get document: ${error.message}`);
      throw error;
    }
  }

  async updateDocument(
    indexName: string,
    documentId: string,
    content: Record<string, any>,
    metadata?: Record<string, any>,
    schemaName?: string,
  ): Promise<SourceDocument> {
    try {
      // If schema is provided, validate the updated document
      if (schemaName) {
        // Get the existing document
        const existingDoc = await this.documentRepository.findOne(indexName, documentId);
        if (!existingDoc) {
          throw new BadRequestException(`Document with id ${documentId} not found`);
        }

        // Create the updated document for validation
        const updatedDoc = { ...existingDoc, ...content };

        // Validate against the schema
        const validationResult = await this.schemaVersionManager.validateDocument(
          schemaName,
          updatedDoc,
        );
        if (!validationResult.valid) {
          throw new BadRequestException({
            message: 'Document validation failed',
            errors: validationResult.errors,
          });
        }

        // Update schema version if needed
        const schema = await this.schemaVersionManager.getSchema(schemaName);
        content._schema = {
          name: schemaName,
          version: schema.version,
        };
      }

      const updateData: any = { content };
      if (metadata) {
        updateData.metadata = metadata;
      }

      return await this.documentRepository.update(indexName, documentId, updateData);
    } catch (error) {
      this.logger.error(`Failed to update document: ${error.message}`);
      throw error;
    }
  }

  async deleteDocument(indexName: string, documentId: string): Promise<boolean> {
    try {
      return await this.documentRepository.delete(indexName, documentId);
    } catch (error) {
      this.logger.error(`Failed to delete document: ${error.message}`);
      throw error;
    }
  }

  async bulkStoreDocuments(
    indexName: string,
    documents: Array<{ id: string; content: Record<string, any>; metadata?: Record<string, any> }>,
    options?: DocumentStorageOptions,
  ): Promise<number> {
    const { batchSize = this.defaultOptions.batchSize } = options || {};
    let storedCount = 0;

    try {
      // Split documents into batches
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);

        const operations = batch.map(doc => ({
          insertOne: {
            document: {
              indexName,
              documentId: doc.id,
              content: doc.content,
              metadata: doc.metadata || {},
            },
          },
        }));

        const result = await this.documentRepository.bulkWrite(operations);
        storedCount += result.insertedCount;
      }

      return storedCount;
    } catch (error) {
      this.logger.error(`Failed to bulk store documents: ${error.message}`);
      throw error;
    }
  }

  async bulkDeleteDocuments(indexName: string, documentIds: string[]): Promise<number> {
    try {
      return await this.documentRepository.deleteMany(indexName, documentIds);
    } catch (error) {
      this.logger.error(`Failed to bulk delete documents: ${error.message}`);
      throw error;
    }
  }

  async deleteAllDocumentsInIndex(indexName: string): Promise<number> {
    try {
      return await this.documentRepository.deleteMany(indexName);
    } catch (error) {
      this.logger.error(`Failed to delete all documents in index: ${error.message}`);
      throw error;
    }
  }

  async getDocuments(
    indexName: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: Record<string, any>;
    } = {},
  ): Promise<{ documents: SourceDocument[]; total: number }> {
    try {
      return await this.documentRepository.findAll(indexName, options);
    } catch (error) {
      this.logger.error(`Failed to get documents: ${error.message}`);
      throw error;
    }
  }
}
