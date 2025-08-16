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

  @Get('fts-debug/:indexName/:term')
  @ApiOperation({
    summary: 'Debug PostgreSQL Full-Text Search',
    description: 'Deep dive into FTS issues with actual search vector content and query analysis',
  })
  async debugFTS(@Param('indexName') indexName: string, @Param('term') term: string) {
    try {
      // Check actual search vector content
      const vectorQuery = `
        SELECT document_id, 
               search_vector IS NOT NULL as has_vector,
               length(search_vector::text) as vector_length,
               search_vector::text as vector_preview
        FROM search_documents 
        WHERE index_name = $1 
        LIMIT 3
      `;
      const vectorResult = await this.dataSource.query(vectorQuery, [indexName]);

      // Test different tsquery functions
      const testQueries = [
        {
          name: 'plainto_tsquery',
          query: `SELECT plainto_tsquery('english', $1) as result`,
          param: term,
        },
        {
          name: 'to_tsquery',
          query: `SELECT to_tsquery('english', $1) as result`,
          param: `${term}:*`,
        },
        {
          name: 'websearch_to_tsquery',
          query: `SELECT websearch_to_tsquery('english', $1) as result`,
          param: term,
        },
      ];

      const queryResults = {};
      for (const test of testQueries) {
        try {
          const result = await this.dataSource.query(test.query, [test.param]);
          queryResults[test.name] = result[0]?.result || null;
        } catch (error) {
          queryResults[test.name] = `ERROR: ${error.message}`;
        }
      }

      // Test a manual FTS query with specific vector
      const manualFTSQuery = `
        SELECT document_id,
               search_vector @@ plainto_tsquery('english', $2) as matches_plainto,
               search_vector @@ to_tsquery('english', $3) as matches_to_tsquery,
               ts_rank_cd(search_vector, plainto_tsquery('english', $2)) as rank_score
        FROM search_documents 
        WHERE index_name = $1 
        LIMIT 5
      `;
      const manualFTSResult = await this.dataSource.query(manualFTSQuery, [
        indexName,
        term,
        `${term}:*`,
      ]);

      // Check PostgreSQL FTS configuration
      const configQuery = `
        SELECT cfgname, cfgparser, cfgdict 
        FROM pg_ts_config 
        WHERE cfgname = 'english'
      `;
      const configResult = await this.dataSource.query(configQuery);

      return {
        status: 'success',
        indexName,
        term,
        vectorSamples: vectorResult,
        tsqueryTests: queryResults,
        manualFTSTests: manualFTSResult,
        ftsConfig: configResult,
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
