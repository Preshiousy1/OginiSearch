import { Injectable, Logger, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { CreateIndexDto, IndexResponseDto } from '../api/dtos/index.dto';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexStatsService } from './index-stats.service';
import { IndexingService } from '../indexing/indexing.service';
import { BM25Scorer } from './bm25-scorer';
import { TermDictionary } from './term-dictionary';
import { DocumentCountVerifierService } from './document-count-verifier.service';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);

  constructor(
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    private readonly indexing: IndexingService,
    private readonly bm25Scorer: BM25Scorer,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: TermDictionary,
    private readonly documentCountVerifier: DocumentCountVerifierService,
    private readonly postgresService: PostgreSQLService,
  ) {}

  async createIndex(createIndexDto: CreateIndexDto): Promise<IndexResponseDto> {
    this.logger.log(`Creating index: ${createIndexDto.name}`);

    // Check if index already exists
    const existingIndex = await this.getIndex(createIndexDto.name);
    if (existingIndex) {
      throw new ConflictException(`Index ${createIndexDto.name} already exists`);
    }

    // Create index in PostgreSQL
    const result = await this.postgresService.query(
      'INSERT INTO indices (index_name, settings) VALUES ($1, $2) RETURNING *',
      [createIndexDto.name, JSON.stringify(createIndexDto.settings || {})],
    );

    return {
      name: createIndexDto.name,
      mappings: createIndexDto.mappings,
      settings: createIndexDto.settings || {},
      documentCount: 0,
      createdAt: result[0].created_at,
      updatedAt: result[0].updated_at,
      status: 'open',
    };
  }

  async listIndices(status?: string): Promise<IndexResponseDto[]> {
    this.logger.log('Listing all indices');
    const query = status ? 'SELECT * FROM indices WHERE status = $1' : 'SELECT * FROM indices';
    const params = status ? [status] : [];
    const result = await this.postgresService.query(query, params);
    return result.map(index => this.mapToIndexResponse(index));
  }

  async getIndex(indexName: string): Promise<IndexResponseDto | null> {
    try {
      const result = await this.postgresService.query(
        'SELECT * FROM indices WHERE index_name = $1',
        [indexName],
      );

      if (result.length === 0) {
        return null;
      }

      const index = result[0];
      return {
        name: index.index_name,
        mappings: index.mappings || { properties: {} },
        settings: index.settings || {},
        documentCount: parseInt(index.document_count || '0', 10),
        createdAt: index.created_at,
        updatedAt: index.updated_at,
        status: index.status || 'open',
      };
    } catch (error) {
      this.logger.error(`Error getting index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  async updateIndex(name: string, settings: any): Promise<IndexResponseDto> {
    this.logger.log(`Updating index settings: ${name}`);
    const index = await this.getIndex(name);

    if (!index) {
      throw new NotFoundException(`Index with name ${name} not found`);
    }

    const result = await this.postgresService.query(
      'UPDATE indices SET settings = $2, updated_at = NOW() WHERE index_name = $1 RETURNING *',
      [name, settings],
    );

    return this.mapToIndexResponse(result[0]);
  }

  async deleteIndex(name: string): Promise<void> {
    this.logger.log(`Deleting index: ${name}`);

    try {
      await this.postgresService.query('BEGIN');

      // Delete from indices table - this will cascade to documents and search_documents
      await this.postgresService.query('DELETE FROM indices WHERE index_name = $1', [name]);

      await this.postgresService.query('COMMIT');
      this.logger.log(`Successfully deleted index ${name}`);
    } catch (error) {
      await this.postgresService.query('ROLLBACK');
      this.logger.error(`Error deleting index ${name}: ${error.message}`);
      throw error;
    }
  }

  async clearCache(indexName: string): Promise<void> {
    this.logger.log(`Clearing cache for index: ${indexName}`);

    // Clear term dictionary entries for this index
    const terms = this.termDictionary.getTerms().filter(term => term.startsWith(`${indexName}:`));
    for (const term of terms) {
      await this.termDictionary.removeTerm(term);
    }

    this.logger.log(`Cache cleared for index ${indexName}`);
  }

  private async clearIndex(indexName: string): Promise<void> {
    this.logger.log(`Clearing index: ${indexName}`);

    try {
      await this.postgresService.query('BEGIN');

      // Clear all documents - this will cascade to search_documents
      await this.postgresService.query('DELETE FROM documents WHERE index_name = $1', [indexName]);

      await this.postgresService.query('COMMIT');
      this.logger.log(`Successfully cleared index ${indexName}`);
    } catch (error) {
      await this.postgresService.query('ROLLBACK');
      this.logger.error(`Error clearing index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  async rebuildDocumentCount(indexName: string): Promise<void> {
    this.logger.log(`Rebuilding document count for index: ${indexName}`);
    // Get actual document count from storage
    const { total: actualCount } = await this.documentStorage.getDocuments(indexName, { limit: 0 });

    // Update index metadata with correct count
    await this.postgresService.query(
      'UPDATE indices SET document_count = $2 WHERE index_name = $1',
      [indexName, actualCount],
    );

    this.logger.log(`Updated document count for index ${indexName} to ${actualCount}`);
  }

  private mapToIndexResponse(index: any): IndexResponseDto {
    return {
      name: index.index_name,
      mappings: index.mappings,
      settings: index.settings || {},
      documentCount: index.document_count || 0,
      createdAt: index.created_at,
      updatedAt: index.updated_at,
      status: index.status || 'open',
    };
  }
}
