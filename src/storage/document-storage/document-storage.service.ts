import { Injectable, Logger, Optional } from '@nestjs/common';
import { DocumentRepository } from '../mongodb/repositories/document.repository';
import { SourceDocument } from '../mongodb/schemas/document.schema';

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

  constructor(@Optional() private readonly documentRepository: DocumentRepository) {
    if (!documentRepository) {
      this.logger.warn('MongoDB repository not available, using in-memory fallback');
      this.useInMemoryFallback = true;
    }
  }

  async storeDocument(
    indexName: string,
    documentId: string,
    content: Record<string, any>,
    metadata: Record<string, any> = {},
  ): Promise<SourceDocument> {
    try {
      const document = {
        indexName,
        documentId,
        content,
        metadata,
      };

      return await this.documentRepository.create(document);
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
  ): Promise<SourceDocument> {
    try {
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
