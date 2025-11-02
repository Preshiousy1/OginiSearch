import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, QueryRunner } from 'typeorm';
import { Document } from './entities/document.entity';
import { SourceDocument } from '../document-storage/document-storage.service';
import { chunk } from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import { Index } from './entities/index.entity';

@Injectable()
export class PostgreSQLService implements OnModuleInit {
  private readonly logger = new Logger(PostgreSQLService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.setupExtensions();
    // await this.clearDatabase(); // TEMPORARY: Clear database to start fresh - REMOVE AFTER RAILWAY DEPLOYMENT
    await this.ensureTablesExist();
    await this.runMigrations();
  }

  /**
   * Setup required PostgreSQL extensions for full-text search
   */
  private async setupExtensions(): Promise<void> {
    try {
      this.logger.log('Setting up PostgreSQL extensions...');

      const extensions = [
        'CREATE EXTENSION IF NOT EXISTS "pg_trgm"',
        'CREATE EXTENSION IF NOT EXISTS "btree_gin"',
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
      ];

      for (const extension of extensions) {
        await this.dataSource.query(extension);
      }

      this.logger.log('PostgreSQL extensions setup completed');
    } catch (error) {
      this.logger.error(`Failed to setup PostgreSQL extensions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure required tables exist, create them if they don't
   */
  private async ensureTablesExist(): Promise<void> {
    try {
      this.logger.log('Checking if required tables exist...');

      // Check if documents table exists
      const tableExists = await this.dataSource.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'documents'
        );
      `);

      if (!tableExists[0].exists) {
        this.logger.log('Required tables do not exist, running initialization script...');

        // Read and execute the init-clean-postgres.sql file
        await this.runInitScript();

        this.logger.log('Database initialization completed successfully');
      } else {
        this.logger.log('Required tables already exist');
      }
    } catch (error) {
      this.logger.error(`Failed to ensure tables exist: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read and execute the init-postgres.sql script
   */
  private async runInitScript(): Promise<void> {
    try {
      // Read the init-clean-postgres.sql file
      const scriptPath = path.join(process.cwd(), 'scripts', 'init-clean-postgres.sql');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      // Execute the entire script as one statement
      await this.dataSource.query(scriptContent);

      this.logger.log('Init script executed successfully');
    } catch (error) {
      this.logger.error(`Failed to execute init script: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    try {
      this.logger.log('Running database migrations...');

      // Run comprehensive migration script
      await this.runComprehensiveMigration();

      this.logger.log('Database migrations completed successfully');
    } catch (error) {
      this.logger.error(`Failed to run migrations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run comprehensive migration script
   */
  private async runComprehensiveMigration(): Promise<void> {
    try {
      // Read the migration script
      const scriptPath = path.join(process.cwd(), 'scripts', 'migrate-postgresql-schema.sql');

      let scriptContent: string;
      try {
        scriptContent = fs.readFileSync(scriptPath, 'utf8');
      } catch (fileError) {
        // Migration file not found - using fallback SQL (this is normal)
        // Fallback SQL for comprehensive migration
        scriptContent = `
          -- Add status column to indices table if it doesn't exist
          DO $$
          BEGIN
              IF NOT EXISTS (
                  SELECT 1 
                  FROM information_schema.columns 
                  WHERE table_name = 'indices' 
                  AND column_name = 'status'
              ) THEN
                  ALTER TABLE indices ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'open';
                  RAISE NOTICE 'Added status column to indices table';
              ELSE
                  RAISE NOTICE 'Status column already exists in indices table';
              END IF;
          END $$;

          -- Add document_count column to indices table if it doesn't exist
          DO $$
          BEGIN
              IF NOT EXISTS (
                  SELECT 1 
                  FROM information_schema.columns 
                  WHERE table_name = 'indices' 
                  AND column_name = 'document_count'
              ) THEN
                  ALTER TABLE indices ADD COLUMN document_count INTEGER NOT NULL DEFAULT 0;
                  RAISE NOTICE 'Added document_count column to indices table';
              ELSE
                  RAISE NOTICE 'Document_count column already exists in indices table';
              END IF;
          END $$;

          -- Add missing indexes if they don't exist
          CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING GIN (metadata);

          -- Enable trigram extension for ILIKE performance optimization
          CREATE EXTENSION IF NOT EXISTS pg_trgm;

          -- Ensure primary key constraint exists on documents table
          DO $$
          BEGIN
              IF NOT EXISTS (
                  SELECT 1 
                  FROM information_schema.table_constraints 
                  WHERE table_name = 'documents' 
                  AND constraint_type = 'PRIMARY KEY'
              ) THEN
                  ALTER TABLE documents ADD CONSTRAINT documents_pkey PRIMARY KEY (document_id, index_name);
                  RAISE NOTICE 'Added primary key constraint to documents table';
              ELSE
                  RAISE NOTICE 'Primary key constraint already exists on documents table';
              END IF;
          END $$;

          -- Update existing indices to have 'open' status if they don't have it
          UPDATE indices SET status = 'open' WHERE status IS NULL;
        `;
      }

      // Execute the migration
      await this.dataSource.query(scriptContent);

      this.logger.log('Comprehensive migration completed');
    } catch (error) {
      this.logger.error(`Failed to run comprehensive migration: ${error.message}`);
      throw error;
    }
  }

  /**
   * Document Storage Methods
   */

  async storeDocument(document: SourceDocument): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // First store the document
      await queryRunner.manager.save(Document, {
        documentId: document.documentId,
        indexName: document.indexName,
        content: document.content,
        metadata: document.metadata || {},
      });

      // Generate search vector
      const searchVector = await this.generateSearchVector(document.content);
      const fieldWeights = this.calculateFieldWeights(document.content);

      // Store search document
      // This part of the code was removed as per the edit hint.
      // The original code had SearchDocument entity, but the new import removed it.
      // The logic for storing search documents is now removed.

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to store document: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async generateSearchVector(content: Record<string, any>): Promise<string> {
    const result = await this.dataSource.query(
      'SELECT generate_document_search_vector($1) as vector',
      [JSON.stringify(content)],
    );
    return result[0].vector;
  }

  private calculateFieldWeights(content: Record<string, any>): Record<string, number> {
    const weights: Record<string, number> = {};
    if (content.title) weights.title = 3.0;
    if (content.description) weights.description = 1.5;
    if (content.categories) weights.categories = 1.0;
    return weights;
  }

  async getDocument(indexName: string, documentId: string): Promise<SourceDocument | null> {
    const doc = await this.documentRepository.findOne({
      where: { indexName, documentId },
    });

    if (!doc) return null;

    return {
      indexName: doc.indexName,
      documentId: doc.documentId,
      content: doc.content,
      metadata: doc.metadata,
    };
  }

  async updateDocument(document: SourceDocument): Promise<void> {
    await this.documentRepository.update(
      { indexName: document.indexName, documentId: document.documentId },
      {
        content: document.content,
        metadata: document.metadata,
        updatedAt: new Date(),
      },
    );
  }

  async deleteDocument(indexName: string, documentId: string): Promise<boolean> {
    const result = await this.documentRepository.delete({ indexName, documentId });
    return result.affected > 0;
  }

  /**
   * Efficient bulk document storage with individual error handling
   */
  async bulkStoreDocuments(
    documents: SourceDocument[],
    options: { batchSize?: number; skipDuplicates?: boolean } = {},
  ): Promise<{
    successCount: number;
    errors: Array<{ documentId: string; error: string }>;
  }> {
    const { batchSize = 1000, skipDuplicates = false } = options;
    let successCount = 0;
    const errors: Array<{ documentId: string; error: string }> = [];
    const batches = chunk(documents, batchSize);

    for (const batch of batches) {
      // Process each document individually to avoid transaction abortion
      for (const doc of batch) {
        const { documentId, indexName, content, metadata = {} } = doc;

        // Ensure content is a valid JSON object
        const safeContent = typeof content === 'object' ? content : { content };
        const safeMetadata = typeof metadata === 'object' ? metadata : {};

        try {
          // Check if document already exists
          const existing = await this.dataSource.query(
            `SELECT document_id FROM documents WHERE document_id = $1 AND index_name = $2`,
            [documentId, indexName],
          );

          if (existing.length > 0) {
            // Update existing document
            await this.dataSource.query(
              `UPDATE documents SET content = $3::jsonb, metadata = $4::jsonb, updated_at = CURRENT_TIMESTAMP
               WHERE document_id = $1 AND index_name = $2`,
              [documentId, indexName, JSON.stringify(safeContent), JSON.stringify(safeMetadata)],
            );
          } else {
            // Insert new document
            await this.dataSource.query(
              `INSERT INTO documents (document_id, index_name, content, metadata)
               VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
              [documentId, indexName, JSON.stringify(safeContent), JSON.stringify(safeMetadata)],
            );
          }

          successCount++;
        } catch (error) {
          this.logger.error(`Error processing document ${documentId}: ${error.message}`);
          errors.push({
            documentId,
            error: error.message,
          });
          // Continue processing other documents instead of aborting
          continue;
        }
      }
    }

    return { successCount, errors };
  }

  async bulkDeleteDocuments(indexName: string, documentIds: string[]): Promise<number> {
    const result = await this.documentRepository.delete({
      indexName,
      documentId: In(documentIds),
    });
    return result.affected || 0;
  }

  async deleteAllDocumentsInIndex(indexName: string): Promise<number> {
    const result = await this.documentRepository.delete({ indexName });
    return result.affected || 0;
  }

  async getDocuments(
    indexName: string,
    options: {
      limit?: number;
      offset?: number;
      filter?: Record<string, any>;
    } = {},
  ): Promise<{ documents: SourceDocument[]; total: number }> {
    const { limit = 10, offset = 0, filter } = options;

    const queryBuilder = this.documentRepository
      .createQueryBuilder('document')
      .where('document.indexName = :indexName', { indexName });

    if (filter) {
      Object.entries(filter).forEach(([key, value]) => {
        queryBuilder.andWhere(`document.content->>'${key}' = :${key}`, { [key]: value });
      });
    }

    const [documents, total] = await queryBuilder.skip(offset).take(limit).getManyAndCount();

    return {
      documents: documents.map(doc => ({
        indexName: doc.indexName,
        documentId: doc.documentId,
        content: doc.content,
        metadata: doc.metadata,
      })),
      total,
    };
  }

  async deleteAllDocuments(): Promise<void> {
    await this.documentRepository.clear();
  }

  async upsertDocument(document: SourceDocument): Promise<void> {
    await this.documentRepository.save({
      documentId: document.documentId,
      indexName: document.indexName,
      content: document.content,
      metadata: document.metadata,
      updatedAt: new Date(),
    });
  }

  /**
   * Execute raw SQL query
   */
  async query(sql: string, parameters?: any[]): Promise<any> {
    return this.dataSource.query(sql, parameters);
  }

  /**
   * Get database connection status
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error(`Database connection check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get database statistics for monitoring
   */
  async getDatabaseStats(): Promise<{
    totalDocuments: number;
    indexes: string[];
    indexSizes: Array<{ indexName: string; size: string }>;
  }> {
    try {
      const [totalResult] = await this.dataSource.query(
        'SELECT COUNT(*) as total FROM search_documents',
      );

      const indexesResult = await this.dataSource.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'search_documents'
      `);

      const indexSizesResult = await this.dataSource.query(`
        SELECT 
          schemaname || '.' || indexname as index_name,
          pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as size
        FROM pg_indexes 
        WHERE tablename = 'search_documents'
      `);

      return {
        totalDocuments: parseInt(totalResult.total),
        indexes: indexesResult.map((row: any) => row.indexname),
        indexSizes: indexSizesResult.map((row: any) => ({
          indexName: row.index_name,
          size: row.size,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get database stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a client from the connection pool
   */
  async getClient(): Promise<QueryRunner> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    return queryRunner;
  }

  private async clearDatabase(): Promise<void> {
    this.logger.log('Clearing database tables...');
    const tables = ['search_documents', 'documents', 'indices'];

    for (const table of tables) {
      try {
        await this.dataSource.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        this.logger.log(`Dropped table: ${table}`);
      } catch (error) {
        this.logger.error(`Failed to drop table ${table}: ${error.message}`);
        throw error;
      }
    }
    this.logger.log('Database tables cleared successfully');
  }
}
