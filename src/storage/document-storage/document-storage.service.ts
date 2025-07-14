import { Injectable, Logger, Optional, BadRequestException } from '@nestjs/common';
import { SchemaVersionManagerService } from '../../schema/schema-version-manager.service';
import { PostgreSQLService } from '../postgresql/postgresql.service';

interface DocumentStorageOptions {
  batchSize?: number;
}

export interface SourceDocument {
  indexName: string;
  documentId: string;
  content: Record<string, any>;
  metadata?: Record<string, any>;
}

@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly defaultOptions: DocumentStorageOptions = {
    batchSize: 100,
  };

  constructor(
    private readonly postgresService: PostgreSQLService,
    private readonly schemaVersionManager: SchemaVersionManagerService,
  ) {}

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

      await this.postgresService.storeDocument(document);
      return document;
    } catch (error) {
      this.logger.error(`Failed to store document: ${error.message}`);
      throw error;
    }
  }

  async getDocument(indexName: string, documentId: string): Promise<SourceDocument | null> {
    try {
      return await this.postgresService.getDocument(indexName, documentId);
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
        const existingDoc = await this.postgresService.getDocument(indexName, documentId);
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

      const document = {
        indexName,
        documentId,
        content,
        metadata: metadata || {},
      };

      await this.postgresService.updateDocument(document);
      return document;
    } catch (error) {
      this.logger.error(`Failed to update document: ${error.message}`);
      throw error;
    }
  }

  async deleteDocument(indexName: string, documentId: string): Promise<boolean> {
    try {
      return await this.postgresService.deleteDocument(indexName, documentId);
    } catch (error) {
      this.logger.error(`Failed to delete document: ${error.message}`);
      throw error;
    }
  }

  async bulkStoreDocuments(
    indexName: string,
    documents: Array<Omit<SourceDocument, 'indexName'>>,
    options: { batchSize?: number; skipDuplicates?: boolean } = {},
  ): Promise<{
    successCount: number;
    errors: Array<{ documentId: string; error: string }>;
  }> {
    this.logger.log(`Bulk storing ${documents.length} documents in index ${indexName}`);

    const sourceDocuments = documents.map(doc => ({
      indexName,
      documentId: doc.documentId,
      content: doc.content,
      metadata: doc.metadata,
    }));

    return this.postgresService.bulkStoreDocuments(sourceDocuments, options);
  }

  async bulkDeleteDocuments(indexName: string, documentIds: string[]): Promise<number> {
    try {
      return await this.postgresService.bulkDeleteDocuments(indexName, documentIds);
    } catch (error) {
      this.logger.error(`Failed to bulk delete documents: ${error.message}`);
      throw error;
    }
  }

  async deleteAllDocumentsInIndex(indexName: string): Promise<number> {
    try {
      return await this.postgresService.deleteAllDocumentsInIndex(indexName);
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
      this.logger.debug(
        `Getting documents from ${indexName} with options: ${JSON.stringify(options)}`,
      );
      const result = await this.postgresService.getDocuments(indexName, options);
      this.logger.debug(`Found ${result.documents.length} documents in document storage`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to get documents: ${error.message}`);
      throw error;
    }
  }

  async deleteAllDocuments(): Promise<void> {
    try {
      await this.postgresService.deleteAllDocuments();
    } catch (error) {
      this.logger.error(`Failed to delete all documents: ${error.message}`);
      throw error;
    }
  }

  async upsertDocument(
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
      // If schema is provided, validate the document before upsert
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

      await this.postgresService.upsertDocument(document);
      return document;
    } catch (error) {
      this.logger.error(`Failed to upsert document: ${error.message}`);
      throw error;
    }
  }

  async getAllDocuments(indexName: string): Promise<Array<{ id: string; source: any }>> {
    const result = await this.postgresService.query(
      'SELECT document_id as id, content as source FROM processed_documents WHERE index_name = $1',
      [indexName],
    );
    return result.rows;
  }
}
