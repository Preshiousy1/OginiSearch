/* eslint-disable @typescript-eslint/no-var-requires */
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

/**
 * Lean Debug Controller for essential diagnostics
 * Provides only the most critical debugging endpoints
 */
@ApiTags('debug')
@Controller('debug')
export class DebugController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health/:indexName')
  @ApiOperation({
    summary: 'Get database health status',
    description: 'Returns basic database health and document counts',
  })
  @ApiResponse({
    status: 200,
    description: 'Database health information',
  })
  async getHealth(@Param('indexName') indexName: string) {
    try {
      // Check document counts
      const docCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const docCount = await this.dataSource.query(docCountQuery, [indexName]);

      // Check if tables exist
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('documents', 'indices')
      `;
      const tables = await this.dataSource.query(tablesQuery);

      // Check indexes
      const indexesQuery = `
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename = 'documents' 
        AND schemaname = 'public'
      `;
      const indexes = await this.dataSource.query(indexesQuery);

      return {
        status: 'success',
        indexName,
        documentCount: parseInt(docCount[0]?.count || '0'),
        tables: tables.map(t => t.table_name),
        indexes: indexes.map(i => ({ name: i.indexname, table: i.tablename })),
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
    summary: 'Test search functionality',
    description: 'Execute a test search to verify functionality',
  })
  async testSearch(@Param('indexName') indexName: string, @Param('term') term: string) {
    try {
      const testQuery = `
        SELECT 
          document_id,
          ts_rank_cd(COALESCE(materialized_vector, search_vector), to_tsquery('english', $2)) as rank
        FROM documents
        WHERE index_name = $1
          AND COALESCE(materialized_vector, search_vector) @@ to_tsquery('english', $2)
        ORDER BY rank DESC
        LIMIT 5
      `;

      const results = await this.dataSource.query(testQuery, [indexName, term]);

      return {
        status: 'success',
        indexName,
        term,
        results: results.length,
        sampleResults: results.slice(0, 2),
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

  @Get('init-clean-database')
  @ApiOperation({
    summary: 'Initialize clean database',
    description: 'Run the clean database initialization script',
  })
  async initCleanDatabase() {
    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'init-clean-postgres.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      await this.dataSource.query(script);

      return {
        status: 'success',
        message: 'Clean database initialization completed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('remove-problematic-index')
  @ApiOperation({
    summary: 'Remove problematic index',
    description: 'Remove the idx_documents_search_lightweight index that causes btree size limit errors',
  })
  async removeProblematicIndex() {
    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'remove-problematic-index.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      await this.dataSource.query(script);

      return {
        status: 'success',
        message: 'Problematic index removed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
