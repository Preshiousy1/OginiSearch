/* eslint-disable @typescript-eslint/no-var-requires */
import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { TypoToleranceService } from '../../search/typo-tolerance.service';
import { FilterBuilderService } from '../../storage/postgresql/filter-builder.service';
import * as fs from 'fs';
import * as path from 'path';

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
    private readonly filterBuilderService: FilterBuilderService,
  ) {}
  @Post('setup-field-weights')
  @ApiOperation({
    summary: 'Set up field weights support',
    description: 'Applies the field weights patch to add support for weighted field ranking',
  })
  async setupFieldWeights() {
    try {
      // Read and execute the patch script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'patch-field-weights.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');
      await this.dataSource.query(script);

      return {
        status: 'success',
        message: 'Field weights support added successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('field-weights/:indexName')
  @ApiOperation({
    summary: 'Get field weights for index',
    description: 'Returns the configured field weights for the specified index',
  })
  async getFieldWeights(@Param('indexName') indexName: string) {
    try {
      const weights = await this.dataSource.query(
        'SELECT field_name, weight, description FROM field_weights WHERE index_name = $1 ORDER BY weight DESC',
        [indexName],
      );

      return {
        status: 'success',
        indexName,
        weights,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

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
      const result = await this.typoToleranceService.correctQuery(body.indexName, body.query);

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

  @Post('rebuild-typo-tolerance-index')
  @ApiOperation({
    summary: 'Force rebuild SymSpell index',
    description: 'Force rebuild the SymSpell index for a specific index',
  })
  async rebuildTypoToleranceIndex(@Body() body: { indexName: string }) {
    try {
      await this.typoToleranceService.forceRebuildIndex(body.indexName);
      return {
        status: 'success',
        message: `SymSpell index rebuilt for ${body.indexName}`,
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

  @Post('optimize-search-performance')
  @ApiOperation({
    summary: 'Optimize search performance',
    description: 'Apply database indexes and optimizations for faster search queries',
  })
  async optimizeSearchPerformance() {
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'optimize-search-performance.sql');

      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        return {
          status: 'error',
          error: 'Optimization script not found',
          timestamp: new Date().toISOString(),
        };
      }

      const script = fs.readFileSync(scriptPath, 'utf8');

      // Split script into individual statements for better error handling
      const statements = script
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      const results = [];

      for (const statement of statements) {
        try {
          if (statement.trim()) {
            await this.dataSource.query(statement);
            results.push({ statement: statement.substring(0, 50) + '...', status: 'success' });
          }
        } catch (error) {
          results.push({
            statement: statement.substring(0, 50) + '...',
            status: 'error',
            error: error.message,
          });
        }
      }

      return {
        status: 'success',
        message: 'Search performance optimizations applied successfully',
        optimizations: [
          'GIN indexes on JSON fields for faster ILIKE operations',
          'Composite indexes for common search patterns',
          'Partial indexes for active documents',
          'Optimized search_vector indexes',
          'Updated table statistics',
        ],
        results: results,
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

  @Post('implement-precomputed-ranking')
  @ApiOperation({
    summary: 'Implement precomputed field-weighted ranking',
    description: 'Deploy precomputed tsvector with field weights for sub-100ms search performance',
  })
  async implementPrecomputedRanking() {
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'simple-precomputed-ranking.sql');

      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        return {
          status: 'error',
          error: 'Precomputed ranking script not found',
          timestamp: new Date().toISOString(),
        };
      }

      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the script as a single transaction
      const startTime = Date.now();
      await this.dataSource.query(script);
      const executionTime = Date.now() - startTime;

      // Get document count with weighted vectors
      const countResult = await this.dataSource.query(
        'SELECT COUNT(*) as count FROM documents WHERE weighted_search_vector IS NOT NULL',
      );
      const documentsUpdated = parseInt(countResult[0]?.count || '0');

      return {
        status: 'success',
        message: 'Precomputed field-weighted ranking implemented successfully',
        optimizations: [
          'Precomputed tsvector with field weights (A=name/title, B=category, C=description, D=tags)',
          'Automatic trigger for new documents',
          'Optimized GIN index on weighted_search_vector',
          'Batch update of existing documents',
          'Ready for sub-100ms search performance',
        ],
        documentsUpdated,
        executionTime: `${executionTime}ms`,
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

  @Post('test-location-filter')
  @ApiOperation({
    summary: 'Test location filter generation',
    description: 'Test how location filters are converted to SQL',
  })
  async testLocationFilter(@Body() body: { locationText: string }) {
    try {
      // Test the filter builder service
      const filter = {
        bool: {
          must: [{ term: { field: 'location_text', value: body.locationText } }],
        },
      };

      const params: any[] = [];
      const result = this.filterBuilderService.buildConditions(filter, params, 2);

      // Test the actual SQL execution
      const testSql = `
        SELECT document_id, content->>'name' as name, content->>'location_text' as location
        FROM documents 
        WHERE index_name = $1 
        ${result.sql}
        LIMIT 5
      `;

      const testParams = ['businesses', ...params];
      const testResults = await this.dataSource.query(testSql, testParams);

      return {
        filter,
        generatedSql: result.sql,
        params: params,
        testSql,
        testParams,
        testResults,
        message: 'Location filter test completed',
      };
    } catch (error) {
      console.error('Error testing location filter:', error);
      return {
        error: error.message,
        message: 'Location filter test failed',
      };
    }
  }
}
