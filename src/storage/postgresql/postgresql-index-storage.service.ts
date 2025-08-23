import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  Index,
  IndexMappings,
  IndexSettings,
  IndexStatus,
} from '../../index/interfaces/index.interface';
import { ProcessedDocument } from '../../document/interfaces/document-processor.interface';
import { IndexStorage } from '../../index/interfaces/index-storage.interface';
import { PostgreSQLProcessedDocument } from './interfaces/postgresql-document.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';
import { Index as IndexEntity } from './entities/index.entity';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
export class PostgreSQLIndexStorageService implements IndexStorage {
  private readonly logger = new Logger(PostgreSQLIndexStorageService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(IndexEntity)
    private readonly indexRepository: Repository<IndexEntity>,
  ) {}

  async getDocumentCount(indexName: string): Promise<number> {
    // Get count from documents table as source of truth
    const result = await this.dataSource.query(
      'SELECT COUNT(*) FROM documents WHERE index_name = $1',
      [indexName],
    );
    const actualCount = parseInt(result[0]?.count || '0', 10);

    // Update indices table if count doesn't match
    await this.dataSource.query(
      `UPDATE indices 
       SET document_count = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE index_name = $1 AND document_count != $2`,
      [indexName, actualCount],
    );

    return actualCount;
  }

  async getFields(indexName: string): Promise<string[]> {
    const index = await this.getIndex(indexName);
    if (!index?.mappings) return [];
    return Object.keys(index.mappings);
  }

  async getFieldStats(field: string): Promise<{ totalLength: number; docCount: number } | null> {
    const result = await this.dataSource.query(
      'SELECT total_length, doc_count FROM field_stats WHERE field_name = $1',
      [field],
    );
    if (result.rows.length === 0) return null;

    return {
      totalLength: parseInt(result.rows[0].total_length, 10),
      docCount: parseInt(result.rows[0].doc_count, 10),
    };
  }

  async updateFieldStats(
    field: string,
    stats: { totalLength: number; docCount: number },
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO field_stats (field_name, total_length, doc_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (field_name) 
       DO UPDATE SET total_length = $2, doc_count = $3`,
      [field, stats.totalLength, stats.docCount],
    );
  }

  async getIndex(name: string): Promise<Index | null> {
    const entity = await this.indexRepository.findOne({ where: { indexName: name } });
    if (!entity) return null;

    return {
      name: entity.indexName,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt?.toISOString(),
      settings: {
        analysis: {
          analyzer: {
            default: {
              type: 'standard',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop'],
            },
          },
        },
        similarity: 'bm25',
        searchableFields: ['_all'],
      },
      mappings: {
        dynamic: true,
        properties: {},
      },
      status: 'open',
      documentCount: 0,
    };
  }

  async createIndex(
    index: Partial<Index> & { name: string; settings: IndexSettings; mappings: IndexMappings },
  ): Promise<Index> {
    try {
      const existingIndex = await this.getIndex(index.name);
      if (existingIndex) {
        throw new ConflictException(`Index with name ${index.name} already exists`);
      }

      await this.dataSource.query(
        `INSERT INTO search_indexes (
          index_name, settings, mappings, document_count, created_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          index.name,
          JSON.stringify(index.settings),
          JSON.stringify(index.mappings),
          0,
          new Date().toISOString(),
        ],
      );

      return {
        name: index.name,
        settings: index.settings,
        mappings: index.mappings,
        status: 'open',
        documentCount: 0,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error creating index ${index.name}: ${error.message}`);
      throw error;
    }
  }

  async updateIndex(name: string, updates: Partial<Index>, fromBulk?: boolean): Promise<Index> {
    const entity = await this.indexRepository.findOne({ where: { indexName: name } });
    if (!entity) {
      throw new Error(`Index ${name} not found`);
    }

    if (updates.settings) {
      entity.settings = {
        ...entity.settings,
        ...updates.settings,
      };
    }

    await this.indexRepository.save(entity);
    const updated = await this.getIndex(name);
    if (!updated) throw new Error(`Failed to update index ${name}`);
    return updated;
  }

  async listIndices(): Promise<Index[]> {
    try {
      const result = await this.dataSource.query(
        'SELECT index_name, settings, mappings, status, document_count, created_at FROM indices WHERE status = $1',
        ['open'],
      );

      if (!Array.isArray(result)) {
        this.logger.warn('Query result is not an array, returning empty array');
        return [];
      }

      return result.map(index => ({
        name: index.index_name,
        settings: index.settings || {},
        mappings: index.mappings || {},
        status: index.status || 'open',
        documentCount: parseInt(index.document_count || '0', 10),
        createdAt: index.created_at,
      }));
    } catch (error) {
      this.logger.error(`Error listing indices: ${error.message}`);
      // Return empty array instead of throwing to prevent iteration errors
      return [];
    }
  }

  async storeProcessedDocument(indexName: string, document: ProcessedDocument): Promise<void> {
    try {
      // Generate search vector from processed fields
      const searchVectorParts = [];
      const fieldWeights: Record<string, number> = {};

      for (const [field, fieldData] of Object.entries(document.fields)) {
        if (!fieldData.terms || fieldData.terms.length === 0) continue;

        // Determine field weight
        const weight = field === 'title' ? 'A' : field === 'description' ? 'B' : 'C';
        fieldWeights[field] = weight === 'A' ? 2.0 : weight === 'B' ? 1.5 : 1.0;

        // Create field-specific tsvector
        const fieldText = fieldData.terms.join(' ');
        searchVectorParts.push(
          `setweight(to_tsvector('english', $${searchVectorParts.length + 1}), '${weight}')`,
        );
      }

      // Create search document entity
      const searchVectorExpr =
        searchVectorParts.length > 0
          ? searchVectorParts.join(' || ')
          : `to_tsvector('english', '')`;

      // Get field values for parameters
      const params = Object.entries(document.fields)
        .filter(([_, fieldData]) => fieldData.terms && fieldData.terms.length > 0)
        .map(([_, fieldData]) => fieldData.terms.join(' '));

      // Store document with generated tsvector
      await this.dataSource.query(
        `INSERT INTO documents (document_id, index_name, content, metadata, search_vector, field_weights)
         VALUES ($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${
          params.length + 4
        }, ${searchVectorExpr}, $${params.length + 5})
         ON CONFLICT (document_id, index_name)
         DO UPDATE SET search_vector = EXCLUDED.search_vector,
                      field_weights = EXCLUDED.field_weights`,
        [
          document.id,
          indexName,
          JSON.stringify(document.fields),
          JSON.stringify({}),
          ...params,
          fieldWeights,
        ],
      );
    } catch (error) {
      this.logger.error(
        `Failed to store processed document ${document.id} in index ${indexName}: ${error.message}`,
      );
      throw error;
    }
  }

  async getProcessedDocument(indexName: string, documentId: string): Promise<any> {
    const doc = await this.documentRepository.findOne({
      where: { indexName, documentId },
    });

    if (!doc) return null;

    return {
      id: doc.documentId,
      searchVector: doc.searchVector,
      fieldWeights: doc.fieldWeights,
      fields: {},
    };
  }

  async deleteProcessedDocument(indexName: string, documentId: string): Promise<void> {
    await this.documentRepository.delete({ indexName, documentId });
  }

  async storeIndexStats(indexName: string, stats: Record<string, any>): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO index_stats (index_name, stats)
       VALUES ($1, $2)
       ON CONFLICT (index_name) 
       DO UPDATE SET stats = $2`,
      [indexName, JSON.stringify(stats)],
    );
  }

  async getIndexStats(indexName: string): Promise<Record<string, any> | null> {
    const result = await this.dataSource.query(
      'SELECT stats FROM index_stats WHERE index_name = $1',
      [indexName],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].stats;
  }

  async deleteIndex(name: string): Promise<void> {
    try {
      await this.dataSource.query('DELETE FROM indices WHERE index_name = $1', [name]);
      this.logger.log(`Deleted index ${name} from PostgreSQL`);
    } catch (error) {
      this.logger.error(`Error deleting index ${name}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getAllDocuments(indexName: string): Promise<Array<{ id: string; source: any }>> {
    const entities = await this.documentRepository.find({
      where: { indexName },
      select: ['documentId', 'searchVector'],
    });

    return entities.map(entity => ({
      id: entity.documentId,
      source: entity.searchVector,
    }));
  }

  async clearIndex(indexName: string): Promise<void> {
    try {
      await this.dataSource.query('BEGIN');

      // Delete all documents for this index
      await this.documentRepository.delete({ indexName });

      // Reset document count in index metadata
      await this.dataSource.query('UPDATE indices SET document_count = 0 WHERE index_name = $1', [
        indexName,
      ]);

      await this.dataSource.query('COMMIT');
      this.logger.log(`Successfully cleared index ${indexName}`);
    } catch (error) {
      await this.dataSource.query('ROLLBACK');
      this.logger.error(`Error clearing index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  async storeTermPostings(
    indexName: string,
    term: string,
    documentId: string,
    positions: number[],
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO term_postings (index_name, term, document_id, positions)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (index_name, term, document_id) 
       DO UPDATE SET positions = $4`,
      [indexName, term, documentId, positions],
    );
  }

  async addTermToIndex(
    indexName: string,
    term: string,
    documentId: string,
    positions: number[],
  ): Promise<void> {
    try {
      const searchDoc = await this.documentRepository.findOne({
        where: { indexName, documentId },
      });

      if (!searchDoc) {
        throw new Error(`Search document not found for ${documentId} in index ${indexName}`);
      }

      // Update the tsvector with the new term
      await this.documentRepository
        .createQueryBuilder()
        .update()
        .set({
          searchVector: () => `setweight(to_tsvector('english', :term), 'A')`,
        })
        .where('document_id = :documentId AND index_name = :indexName', { documentId, indexName })
        .setParameter('term', term)
        .execute();
    } catch (error) {
      this.logger.error(`Failed to add term ${term} to document ${documentId}: ${error.message}`);
      throw error;
    }
  }

  async removeTermFromIndex(indexName: string, term: string, documentId: string): Promise<void> {
    try {
      const searchDoc = await this.documentRepository.findOne({
        where: { indexName, documentId },
      });

      if (!searchDoc) {
        throw new Error(`Search document not found for ${documentId} in index ${indexName}`);
      }

      // Remove the term from tsvector
      await this.documentRepository
        .createQueryBuilder()
        .update()
        .set({
          searchVector: () =>
            `strip(search_vector, ARRAY[to_tsquery('english', :term)]::tsquery[])`,
        })
        .where('document_id = :documentId AND index_name = :indexName', { documentId, indexName })
        .setParameter('term', term)
        .execute();
    } catch (error) {
      this.logger.error(
        `Failed to remove term ${term} from document ${documentId}: ${error.message}`,
      );
      throw error;
    }
  }

  async resetDocumentCount(indexName: string): Promise<void> {
    try {
      await this.dataSource.query('UPDATE indices SET document_count = 0 WHERE index_name = $1', [
        indexName,
      ]);
    } catch (error) {
      this.logger.error(`Error resetting document count for ${indexName}: ${error.message}`);
      throw error;
    }
  }
}
