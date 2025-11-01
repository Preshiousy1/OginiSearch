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

  @Post('complete-search-optimization')
  @ApiOperation({
    summary: 'Run complete search engine optimization',
    description:
      'Executes the comprehensive database optimization script for sub-200ms search performance. This includes: materialized columns, search vector generation, optimized indexes, and performance monitoring setup. Estimated runtime: 2-4 hours for 600K documents.',
  })
  async completeSearchOptimization() {
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'complete-search-optimization.sql');

      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        return {
          status: 'error',
          error: 'Complete search optimization script not found',
          timestamp: new Date().toISOString(),
        };
      }

      const script = fs.readFileSync(scriptPath, 'utf8');
      const startTime = Date.now();

      // Clean the script for Node.js execution
      const cleanScript = script
        // Remove psql-specific commands
        .replace(/\\timing on/g, '')
        .replace(/\\set ON_ERROR_STOP on/g, '')
        // Remove BEGIN/COMMIT that wrap sections (not inside DO blocks)
        .replace(/^BEGIN;/gm, '')
        .replace(/^COMMIT;/gm, '')
        // Fix CONCURRENTLY statements - they can't be in transactions
        // Handle both "CREATE INDEX CONCURRENTLY" and "CREATE INDEX CONCURRENTLY IF NOT EXISTS"
        .replace(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/gi, 'CREATE INDEX IF NOT EXISTS')
        .replace(/CREATE INDEX CONCURRENTLY/gi, 'CREATE INDEX IF NOT EXISTS')
        .replace(
          /DROP INDEX IF EXISTS ([^;]+);[\s\n]*CREATE INDEX CONCURRENTLY/gi,
          'CREATE INDEX IF NOT EXISTS',
        );

      // Smart statement splitting that respects DO $$ and FUNCTION $$ blocks
      const statements: string[] = [];
      let currentStatement = '';
      let inDollarQuote = false;
      let blockType: 'DO' | 'FUNCTION' | null = null;

      const lines = cleanScript.split('\n');

      for (const line of lines) {
        // Skip empty lines and comments when not in a statement
        if (!currentStatement && (line.trim() === '' || line.trim().startsWith('--'))) {
          continue;
        }

        currentStatement += line + '\n';

        // Detect start of dollar-quoted blocks
        if (!inDollarQuote) {
          if (line.match(/DO\s+\$\$/i)) {
            inDollarQuote = true;
            blockType = 'DO';
          } else if (
            line.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i) ||
            line.match(/RETURNS/i) ||
            currentStatement.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)
          ) {
            // Check if this line or current statement has AS $$ or just $$
            if (line.match(/AS\s+\$\$/i) || line.match(/^\s*\$\$/)) {
              inDollarQuote = true;
              blockType = 'FUNCTION';
            }
          }
        } else {
          // Detect end of dollar-quoted blocks
          if (blockType === 'DO' && line.match(/END\s+\$\$;/i)) {
            // DO block ends with END $$;
            inDollarQuote = false;
            blockType = null;
            // This line completes the statement
            if (currentStatement.trim()) {
              statements.push(currentStatement.trim());
            }
            currentStatement = '';
            continue;
          } else if (blockType === 'FUNCTION' && line.match(/\$\$\s*LANGUAGE/i)) {
            // FUNCTION block ends with $$ LANGUAGE
            inDollarQuote = false;
            blockType = null;
          }
        }

        // Check for statement end (semicolon not in DO/FUNCTION block)
        if (!inDollarQuote && line.trim().endsWith(';')) {
          if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
          }
          currentStatement = '';
        }
      }

      // Add last statement if exists
      if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
      }

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      // Execute statements one by one
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];

        try {
          await this.dataSource.query(statement);
          successCount++;

          // Log progress every 10 statements
          if ((i + 1) % 10 === 0) {
            console.log(`Progress: ${i + 1}/${statements.length} statements executed`);
          }
        } catch (error) {
          errorCount++;
          const preview = statement.substring(0, 100).replace(/\n/g, ' ');
          errors.push({
            statement: preview + '...',
            error: error.message,
          });

          // Continue on errors that are acceptable
          const acceptableErrors = ['already exists', 'does not exist', 'duplicate'];

          const isAcceptable = acceptableErrors.some(msg =>
            error.message.toLowerCase().includes(msg.toLowerCase()),
          );

          if (!isAcceptable) {
            console.error(`Error executing statement ${i + 1}:`, error.message);
          }
        }
      }

      const executionTime = Date.now() - startTime;

      // Get statistics after optimization
      const vectorCoverage = await this.dataSource.query(`
        SELECT 
          COUNT(*) as total_documents,
          COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END) as documents_with_vectors,
          ROUND((COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END)::FLOAT / 
                 NULLIF(COUNT(*), 0) * 100)::numeric, 2) as vector_coverage_percent
        FROM documents
      `);

      const indexCount = await this.dataSource.query(`
        SELECT COUNT(*) as index_count
        FROM pg_indexes 
        WHERE tablename = 'documents'
      `);

      const tableSize = await this.dataSource.query(`
        SELECT pg_size_pretty(pg_total_relation_size('documents')) as table_size
      `);

      return {
        status: errorCount > 0 ? 'partial_success' : 'success',
        message:
          errorCount > 0
            ? `Optimization completed with ${errorCount} errors (some may be acceptable)`
            : 'Complete search optimization executed successfully',
        execution: {
          total_statements: statements.length,
          successful: successCount,
          errors: errorCount,
          error_details: errors.length > 0 ? errors.slice(0, 5) : undefined,
        },
        optimizations: [
          'Materialized columns (name, category, description, location, filters)',
          'Search vector generation functions with field weights',
          'Automatic triggers for vector updates',
          'Batch population of existing search vectors',
          'GIN indexes on weighted_search_vector, search_vector, materialized_vector',
          'Trigram indexes for wildcard searches (name, category, description)',
          'Composite indexes for filtered queries',
          'Materialized view for active documents',
          'Helper functions (search_with_prefix, search_with_boost)',
          'Maintenance procedures and performance monitoring views',
          'PostgreSQL configuration optimization',
        ],
        statistics: {
          ...vectorCoverage[0],
          total_indexes: indexCount[0].index_count,
          table_size: tableSize[0].table_size,
        },
        executionTime: `${(executionTime / 1000).toFixed(2)}s`,
        nextSteps: [
          'Restart PostgreSQL to apply configuration changes (ALTER SYSTEM settings)',
          'Monitor query performance using slow_search_queries view',
          'Run maintain_documents_table() daily for maintenance',
          'Deploy updated application code with optimized queries',
        ],
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        errorDetail: error.detail || 'No additional details',
        stack: error.stack,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('verify-search-indexes')
  @ApiOperation({
    summary: 'Verify search engine indexes',
    description:
      'Lists all indexes on the documents table to verify that critical search indexes have been created. Should show at least 15 indexes including weighted_search_vector, name_trgm, and active_verified indexes.',
  })
  async verifySearchIndexes() {
    try {
      // Get all indexes on documents table
      const indexes = await this.dataSource.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE tablename = 'documents'
          AND schemaname = 'public'
        ORDER BY indexname
      `);

      // Check for critical indexes
      const criticalIndexes = [
        'idx_documents_weighted_search_vector',
        'idx_documents_name_trgm',
        'idx_documents_active_verified',
        'idx_documents_search_vector',
        'idx_documents_category_trgm',
        'idx_documents_index_filters',
      ];

      const foundCritical = criticalIndexes.filter(criticalIndex =>
        indexes.some(idx => idx.indexname === criticalIndex),
      );

      const missingCritical = criticalIndexes.filter(
        criticalIndex => !indexes.some(idx => idx.indexname === criticalIndex),
      );

      // Get index usage statistics
      const indexUsage = await this.dataSource.query(`
        SELECT 
          schemaname,
          relname as tablename,
          indexrelname as indexname,
          idx_scan as scans,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND relname = 'documents'
        ORDER BY idx_scan DESC
        LIMIT 20
      `);

      // Get table statistics
      const tableStats = await this.dataSource.query(`
        SELECT 
          COUNT(*) as total_documents,
          COUNT(CASE WHEN weighted_search_vector IS NOT NULL THEN 1 END) as documents_with_weighted_vectors,
          COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as documents_with_search_vectors,
          pg_size_pretty(pg_total_relation_size('documents')) as total_table_size,
          pg_size_pretty(pg_relation_size('documents')) as table_size,
          pg_size_pretty(pg_total_relation_size('documents') - pg_relation_size('documents')) as indexes_size
        FROM documents
      `);

      return {
        status: foundCritical.length === criticalIndexes.length ? 'success' : 'warning',
        message:
          foundCritical.length === criticalIndexes.length
            ? 'All critical indexes found'
            : 'Some critical indexes are missing',
        summary: {
          total_indexes: indexes.length,
          critical_indexes_found: foundCritical.length,
          critical_indexes_missing: missingCritical.length,
        },
        criticalIndexes: {
          found: foundCritical,
          missing: missingCritical,
        },
        allIndexes: indexes,
        indexUsage: indexUsage,
        tableStatistics: tableStats[0],
        recommendations:
          missingCritical.length > 0
            ? [
                'Run POST /debug/complete-search-optimization to create missing indexes',
                'Verify that the optimization script completed successfully',
                'Check PostgreSQL logs for any index creation errors',
              ]
            : [
                'All critical indexes are in place',
                'Monitor index usage with this endpoint regularly',
                'Run maintain_documents_table() for ongoing optimization',
              ],
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
