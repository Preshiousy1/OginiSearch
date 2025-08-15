import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

/**
 * Debug Controller for diagnosing search issues
 * Provides database state information for troubleshooting
 */
@ApiTags('debug')
@Controller('debug')
export class DebugController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('search-state/:indexName')
  @ApiOperation({
    summary: 'Get search database state for debugging',
    description:
      'Returns document counts, index status, and sample queries for debugging search issues',
  })
  @ApiResponse({
    status: 200,
    description: 'Search state information',
  })
  async getSearchState(@Param('indexName') indexName: string) {
    try {
      // Check document counts
      const docCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const searchDocCountQuery = `SELECT COUNT(*) as count FROM search_documents WHERE index_name = $1`;

      const [docCount, searchDocCount] = await Promise.all([
        this.dataSource.query(docCountQuery, [indexName]),
        this.dataSource.query(searchDocCountQuery, [indexName]),
      ]);

      // Check if tables exist
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('documents', 'search_documents', 'indices')
      `;
      const tables = await this.dataSource.query(tablesQuery);

      // Check indexes
      const indexesQuery = `
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename IN ('documents', 'search_documents') 
        AND schemaname = 'public'
      `;
      const indexes = await this.dataSource.query(indexesQuery);

      // Sample documents
      const sampleDocsQuery = `SELECT document_id, content FROM documents WHERE index_name = $1 LIMIT 3`;
      const sampleDocs = await this.dataSource.query(sampleDocsQuery, [indexName]);

      // Sample search documents
      const sampleSearchDocsQuery = `SELECT document_id, search_vector IS NOT NULL as has_vector FROM search_documents WHERE index_name = $1 LIMIT 3`;
      const sampleSearchDocs = await this.dataSource.query(sampleSearchDocsQuery, [indexName]);

      return {
        status: 'success',
        indexName,
        documentCounts: {
          documents: parseInt(docCount[0]?.count || '0'),
          searchDocuments: parseInt(searchDocCount[0]?.count || '0'),
        },
        tables: tables.map(t => t.table_name),
        indexes: indexes.map(i => ({ name: i.indexname, table: i.tablename })),
        sampleDocs: sampleDocs.length,
        sampleSearchDocs: sampleSearchDocs.length,
        hasSearchVectors: sampleSearchDocs.filter(d => d.has_vector).length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        indexName,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('test-search/:indexName/:term')
  @ApiOperation({
    summary: 'Test raw search query',
    description:
      'Execute a raw search query to test database connectivity and search functionality',
  })
  async testRawSearch(@Param('indexName') indexName: string, @Param('term') term: string) {
    try {
      // Test basic document query
      const basicQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const basicResult = await this.dataSource.query(basicQuery, [indexName]);

      // Test search document query
      const searchQuery = `
        SELECT d.document_id, d.content, ts_rank_cd(sd.search_vector, plainto_tsquery('english', $2)) as score
        FROM search_documents sd 
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = $1 AND sd.search_vector @@ plainto_tsquery('english', $2)
        LIMIT 5
      `;
      const searchResult = await this.dataSource.query(searchQuery, [indexName, term]);

      // Test fallback ILIKE query
      const fallbackQuery = `
        SELECT document_id, content 
        FROM documents 
        WHERE index_name = $1 AND (content->>'name' ILIKE $2)
        LIMIT 5
      `;
      const fallbackResult = await this.dataSource.query(fallbackQuery, [indexName, `%${term}%`]);

      return {
        status: 'success',
        indexName,
        term,
        results: {
          totalDocuments: parseInt(basicResult[0]?.count || '0'),
          ftsResults: searchResult.length,
          fallbackResults: fallbackResult.length,
          ftsScores: searchResult.map(r => r.score),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        indexName,
        term,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
