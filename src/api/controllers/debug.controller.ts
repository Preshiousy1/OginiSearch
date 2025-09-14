/* eslint-disable @typescript-eslint/no-var-requires */
import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { TypoToleranceService } from '../../search/typo-tolerance.service';

/**
 * Lean Debug Controller for essential diagnostics
 * Provides only the most critical debugging endpoints
 */
@ApiTags('debug')
@Controller('debug')
export class DebugController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly typoToleranceService: TypoToleranceService,
  ) {}

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
    description:
      'Remove the idx_documents_search_lightweight index that causes btree size limit errors',
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

  @Post('fix-index-size-limitation')
  @ApiOperation({
    summary: 'Comprehensive PostgreSQL index optimization',
    description:
      'Fix index size limitations AND cleanup duplicate indexes for optimal performance. This single endpoint handles both the "index row size exceeds btree version 4 maximum" error and removes conflicting indexes.',
  })
  async fixIndexSizeLimitation() {
    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'fix-index-size-limitation.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      await this.dataSource.query(script);

      return {
        status: 'success',
        message: 'Comprehensive index optimization completed successfully',
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

  @Post('setup-typo-tolerance-optimization')
  @ApiOperation({
    summary: 'Setup typo tolerance optimization',
    description:
      'Deploy the materialized view and database functions for ultra-fast typo tolerance',
  })
  async setupTypoToleranceOptimization() {
    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(
        process.cwd(),
        'scripts',
        'typo-tolerance-optimization-deployment.sql',
      );
      const script = fs.readFileSync(scriptPath, 'utf8');

      await this.dataSource.query(script);

      // Get statistics after setup
      const stats = await this.dataSource.query(`
        SELECT 
          COUNT(*) as total_terms,
          COUNT(DISTINCT index_name) as total_indices
        FROM search_terms
      `);

      return {
        status: 'success',
        message: 'Typo tolerance optimization setup completed successfully',
        statistics: stats[0],
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

  @Post('add-typo-functions')
  @ApiOperation({
    summary: 'Add missing typo tolerance functions',
    description: 'Add the missing database functions for typo tolerance',
  })
  async addTypoFunctions() {
    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'add-typo-functions.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      await this.dataSource.query(script);

      return {
        status: 'success',
        message: 'Typo tolerance functions added successfully',
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

  @Get('typo-tolerance-stats/:indexName')
  @ApiOperation({
    summary: 'Get typo tolerance statistics',
    description: 'Get statistics about the typo tolerance materialized view for a specific index',
  })
  async getTypoToleranceStats(@Param('indexName') indexName: string) {
    try {
      const stats = await this.dataSource.query('SELECT * FROM get_index_typo_stats($1)', [
        indexName,
      ]);

      return {
        status: 'success',
        indexName,
        statistics: stats[0] || null,
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

  @Post('refresh-typo-tolerance-view')
  @ApiOperation({
    summary: 'Refresh typo tolerance materialized view',
    description: 'Refresh the search_terms materialized view to include latest data',
  })
  async refreshTypoToleranceView() {
    try {
      await this.dataSource.query('REFRESH MATERIALIZED VIEW search_terms');
      return {
        status: 'success',
        message: 'Typo tolerance materialized view refreshed successfully',
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

  @Post('test-typo-tolerance')
  @ApiOperation({
    summary: 'Test typo tolerance service directly',
    description: 'Test the typo tolerance service with a given query',
  })
  async testTypoTolerance(@Body() body: { indexName: string; query: string }) {
    try {
      // Use our optimized TypoToleranceService for 10ms target
      const result = await this.typoToleranceService.correctQuery(body.indexName, body.query, [
        'name',
        'description',
        'category',
      ]);

      return {
        status: 'success',
        result,
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
