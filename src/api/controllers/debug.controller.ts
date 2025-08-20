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

      const queryResults: any = {};
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

  @Get('fts-diagnosis/:indexName')
  @ApiOperation({
    summary: 'Diagnose PostgreSQL Full-Text Search issues',
    description: 'Deep analysis of FTS failure - search vectors, configurations, and query testing',
  })
  async diagnoseFTS(@Param('indexName') indexName: string) {
    try {
      // 1. Check search vector samples and their content
      const vectorSampleQuery = `
        SELECT 
          document_id,
          search_vector IS NOT NULL as has_vector,
          length(search_vector::text) as vector_length,
          substring(search_vector::text, 1, 200) as vector_preview,
          substring(d.content::text, 1, 200) as content_preview
        FROM search_documents sd
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = $1 
        LIMIT 5
      `;
      const vectorSamples = await this.dataSource.query(vectorSampleQuery, [indexName]);

      // 2. Test different PostgreSQL FTS functions
      const ftsTests: any = {};
      const testTerm = 'business';

      try {
        // Test basic tsquery functions
        const queryTests = [
          {
            name: 'plainto_tsquery',
            sql: `SELECT plainto_tsquery('english', $1)::text as result`,
            param: testTerm,
          },
          {
            name: 'to_tsquery',
            sql: `SELECT to_tsquery('english', $1)::text as result`,
            param: `${testTerm}:*`,
          },
          {
            name: 'websearch_to_tsquery',
            sql: `SELECT websearch_to_tsquery('english', $1)::text as result`,
            param: testTerm,
          },
        ];

        for (const test of queryTests) {
          try {
            const result = await this.dataSource.query(test.sql, [test.param]);
            ftsTests[test.name] = result[0]?.result || 'NULL';
          } catch (error) {
            ftsTests[test.name] = `ERROR: ${error.message}`;
          }
        }
      } catch (error) {
        ftsTests['error'] = error.message;
      }

      // 3. Test search vector matching with sample data
      const matchingTests: any = {};
      try {
        const matchTestQuery = `
          SELECT 
            document_id,
            search_vector @@ plainto_tsquery('english', $2) as matches_plainto,
            search_vector @@ to_tsquery('english', $3) as matches_to_tsquery,
            ts_rank_cd(search_vector, plainto_tsquery('english', $2)) as rank_plainto,
            ts_rank_cd(search_vector, to_tsquery('english', $3)) as rank_to_tsquery
          FROM search_documents 
          WHERE index_name = $1 
          LIMIT 3
        `;
        const matchResults = await this.dataSource.query(matchTestQuery, [
          indexName,
          testTerm,
          `${testTerm}:*`,
        ]);
        matchingTests.results = matchResults;
        matchingTests.totalMatches = matchResults.filter(r => r.matches_plainto).length;
      } catch (error) {
        matchingTests.error = error.message;
      }

      // 4. Check PostgreSQL text search configuration
      const configTests: any = {};
      try {
        const configQueries = [
          {
            name: 'text_search_configs',
            sql: `SELECT cfgname FROM pg_ts_config WHERE cfgname = 'english'`,
          },
          { name: 'dictionaries', sql: `SELECT dictname FROM pg_ts_dict LIMIT 5` },
          { name: 'parsers', sql: `SELECT prsname FROM pg_ts_parser LIMIT 3` },
          { name: 'current_config', sql: `SELECT current_setting('default_text_search_config')` },
        ];

        for (const test of configQueries) {
          try {
            const result = await this.dataSource.query(test.sql);
            configTests[test.name] = result;
          } catch (error) {
            configTests[test.name] = `ERROR: ${error.message}`;
          }
        }
      } catch (error) {
        configTests.error = error.message;
      }

      // 5. Test raw search vector content analysis
      let vectorAnalysis: any = {};
      try {
        const analysisQuery = `
          SELECT 
            COUNT(*) as total_vectors,
            COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as non_null_vectors,
            COUNT(CASE WHEN length(search_vector::text) > 10 THEN 1 END) as substantial_vectors,
            AVG(length(search_vector::text)) as avg_vector_length
          FROM search_documents 
          WHERE index_name = $1
        `;
        const analysis = await this.dataSource.query(analysisQuery, [indexName]);
        vectorAnalysis = analysis[0] || {};
      } catch (error) {
        vectorAnalysis.error = error.message;
      }

      return {
        status: 'success',
        indexName,
        diagnosis: {
          vectorSamples: vectorSamples || [],
          ftsQueryTests: ftsTests,
          vectorMatchingTests: matchingTests,
          postgresqlConfig: configTests,
          vectorAnalysis: vectorAnalysis,
        },
        summary: {
          hasVectors: vectorSamples?.length > 0,
          ftsConfigured: configTests.text_search_configs?.length > 0,
          canCreateQueries: Object.keys(ftsTests).length > 0,
        },
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

  @Get('raw-fts-test/:term')
  @ApiOperation({
    summary: 'Test raw PostgreSQL FTS functions',
    description: 'Test if basic PostgreSQL FTS functions work at all',
  })
  async testRawFTS(@Param('term') term: string) {
    try {
      // Test 1: Basic tsquery creation
      const queryCreationTests = await Promise.all([
        this.dataSource.query(`SELECT plainto_tsquery('english', $1)::text as result`, [term]),
        this.dataSource.query(`SELECT to_tsquery('english', $1)::text as result`, [`${term}:*`]),
        this.dataSource.query(`SELECT websearch_to_tsquery('english', $1)::text as result`, [term]),
      ]);

      // Test 2: Check if search_vector has any content at all
      const vectorContentQuery = `
        SELECT COUNT(*) as total_vectors,
               COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as non_null_count,
               COUNT(CASE WHEN length(search_vector::text) > 10 THEN 1 END) as substantial_count
        FROM search_documents 
        WHERE index_name = 'businesses'
      `;
      const vectorStats = await this.dataSource.query(vectorContentQuery);

      // Test 3: Sample search vector content
      const vectorSampleQuery = `
        SELECT sd.document_id,
               substring(sd.search_vector::text, 1, 100) as vector_sample,
               substring(d.content->>'name', 1, 50) as name_sample
        FROM search_documents sd
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = 'businesses'
        LIMIT 3
      `;
      const vectorSamples = await this.dataSource.query(vectorSampleQuery);

      return {
        status: 'success',
        term,
        tests: {
          queryCreation: {
            plainto_tsquery: queryCreationTests[0][0]?.result || 'null',
            to_tsquery: queryCreationTests[1][0]?.result || 'null',
            websearch_to_tsquery: queryCreationTests[2][0]?.result || 'null',
          },
          vectorStats: vectorStats[0] || {},
          vectorSamples: vectorSamples || [],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        term,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('test-vector-generation/:term')
  @ApiOperation({
    summary: 'Test search vector generation',
    description: 'Manually test creating a search vector and see if it works',
  })
  async testVectorGeneration(@Param('term') term: string) {
    try {
      // Test 1: Create a simple tsvector manually
      const simpleVectorQuery = `SELECT to_tsvector('english', $1)::text as vector`;
      const simpleVector = await this.dataSource.query(simpleVectorQuery, [term]);

      // Test 2: Create weighted tsvector manually
      const weightedVectorQuery = `SELECT setweight(to_tsvector('english', $1), 'A')::text as vector`;
      const weightedVector = await this.dataSource.query(weightedVectorQuery, [term]);

      // Test 3: Test if we can search against a manually created vector
      const testSearchQuery = `
        SELECT 
          setweight(to_tsvector('english', $1), 'A') @@ plainto_tsquery('english', $2) as matches_plainto,
          setweight(to_tsvector('english', $1), 'A') @@ to_tsquery('english', $3) as matches_to_tsquery
      `;
      const searchTest = await this.dataSource.query(testSearchQuery, [
        `${term} business technology`, // Sample content
        term, // Search term (plainto)
        `${term}:*`, // Search term (to_tsquery)
      ]);

      // Test 4: Create and insert a test document with proper vector
      const testDocId = `test-${Date.now()}`;
      const insertTestQuery = `
        INSERT INTO search_documents (document_id, index_name, search_vector, field_weights)
        VALUES ($1, 'businesses', setweight(to_tsvector('english', $2), 'A'), '{}')
        ON CONFLICT (document_id, index_name) 
        DO UPDATE SET search_vector = EXCLUDED.search_vector
      `;
      await this.dataSource.query(insertTestQuery, [testDocId, `${term} test business`]);

      // Test 5: Search for the test document we just created
      const findTestQuery = `
        SELECT 
          sd.search_vector::text as stored_vector,
          sd.search_vector @@ plainto_tsquery('english', $2) as matches
        FROM search_documents sd
        WHERE sd.document_id = $1 AND sd.index_name = 'businesses'
      `;
      const findResult = await this.dataSource.query(findTestQuery, [testDocId, term]);

      return {
        status: 'success',
        term,
        tests: {
          simpleVector: simpleVector[0]?.vector || 'null',
          weightedVector: weightedVector[0]?.vector || 'null',
          searchTest: searchTest[0] || {},
          testDocumentId: testDocId,
          testDocumentVector: findResult[0] || {},
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        term,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('reindex-search-vectors/:indexName')
  @ApiOperation({
    summary: 'Reindex all documents to populate search vectors',
    description: 'Fix empty search vectors by reindexing all documents in batches',
  })
  async reindexSearchVectors(@Param('indexName') indexName: string) {
    try {
      // First, check how many documents need reindexing
      const emptyVectorCountQuery = `
        SELECT COUNT(*) as empty_count
        FROM search_documents sd
        WHERE sd.index_name = $1 AND (sd.search_vector IS NULL OR length(sd.search_vector::text) < 10)
      `;
      const emptyCount = await this.dataSource.query(emptyVectorCountQuery, [indexName]);

      const totalDocumentsQuery = `
        SELECT COUNT(*) as total FROM search_documents WHERE index_name = $1
      `;
      const totalCount = await this.dataSource.query(totalDocumentsQuery, [indexName]);

      // Update documents in batches to populate search vectors
      const batchSize = 1000;
      const updateQuery = `
        UPDATE search_documents sd
        SET search_vector = setweight(
          to_tsvector('english', 
            COALESCE(d.content->>'name', '') || ' ' ||
            COALESCE(d.content->>'description', '') || ' ' ||
            COALESCE(d.content->>'category_name', '') || ' ' ||
            COALESCE(d.content->>'tags', '')
          ), 'A'
        )
        FROM documents d
        WHERE sd.document_id = d.document_id 
          AND sd.index_name = d.index_name 
          AND sd.index_name = $1
          AND (sd.search_vector IS NULL OR length(sd.search_vector::text) < 10)
          AND sd.document_id IN (
            SELECT document_id FROM search_documents 
            WHERE index_name = $1 AND (search_vector IS NULL OR length(search_vector::text) < 10)
            LIMIT $2
          )
      `;

      // Process in batches
      let updatedTotal = 0;
      let batchCount = 0;
      const maxBatches = 20; // Limit to prevent timeout

      while (batchCount < maxBatches) {
        const result = await this.dataSource.query(updateQuery, [indexName, batchSize]);
        const updatedInBatch = result[1] || 0; // Number of affected rows

        updatedTotal += updatedInBatch;
        batchCount++;

        // Stop if no more documents to update
        if (updatedInBatch < batchSize) {
          break;
        }
      }

      // Check results after reindexing
      const finalEmptyCount = await this.dataSource.query(emptyVectorCountQuery, [indexName]);

      return {
        status: 'success',
        indexName,
        results: {
          totalDocuments: parseInt(totalCount[0]?.total || '0'),
          emptyVectorsBefore: parseInt(emptyCount[0]?.empty_count || '0'),
          emptyVectorsAfter: parseInt(finalEmptyCount[0]?.empty_count || '0'),
          documentsUpdated: updatedTotal,
          batchesProcessed: batchCount,
          maxBatchesReached: batchCount >= maxBatches,
        },
        recommendation:
          batchCount >= maxBatches
            ? 'Run this endpoint multiple times to complete reindexing'
            : 'Reindexing completed successfully',
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

  @Get('bulk-reindex/:indexName/:batchCount')
  @ApiOperation({
    summary: 'Bulk reindex multiple batches at once',
    description: 'Process multiple reindexing batches in a single request for faster completion',
  })
  async bulkReindex(
    @Param('indexName') indexName: string,
    @Param('batchCount') batchCount: string,
  ) {
    try {
      const numBatches = Math.min(parseInt(batchCount) || 10, 50); // Limit to 50 batches max
      const batchSize = 5000; // Larger batch size

      let totalUpdated = 0;
      let finalRemaining = 0;

      for (let i = 0; i < numBatches; i++) {
        // Process larger batch
        const updateQuery = `
          UPDATE search_documents sd
          SET search_vector = setweight(
            to_tsvector('english', 
              COALESCE(d.content->>'name', '') || ' ' ||
              COALESCE(d.content->>'description', '') || ' ' ||
              COALESCE(d.content->>'category_name', '') || ' ' ||
              COALESCE(d.content->>'tags', '')
            ), 'A'
          )
          FROM documents d
          WHERE sd.document_id = d.document_id 
            AND sd.index_name = d.index_name 
            AND sd.index_name = $1
            AND (sd.search_vector IS NULL OR length(sd.search_vector::text) < 10)
            AND sd.document_id IN (
              SELECT document_id FROM search_documents 
              WHERE index_name = $1 AND (search_vector IS NULL OR length(search_vector::text) < 10)
              LIMIT $2
            )
        `;

        const result = await this.dataSource.query(updateQuery, [indexName, batchSize]);
        const batchUpdated = result[1] || 0;
        totalUpdated += batchUpdated;

        // Check remaining after this batch
        const remainingQuery = `
          SELECT COUNT(*) as count FROM search_documents 
          WHERE index_name = $1 AND (search_vector IS NULL OR length(search_vector::text) < 10)
        `;
        const remainingResult = await this.dataSource.query(remainingQuery, [indexName]);
        finalRemaining = parseInt(remainingResult[0]?.count || '0');

        // Stop if no more documents to process
        if (batchUpdated === 0 || finalRemaining === 0) {
          break;
        }
      }

      // Get final statistics
      const totalQuery = `SELECT COUNT(*) as total FROM search_documents WHERE index_name = $1`;
      const totalResult = await this.dataSource.query(totalQuery, [indexName]);
      const totalDocs = parseInt(totalResult[0]?.total || '0');
      const completed = totalDocs - finalRemaining;
      const percentComplete = totalDocs > 0 ? (completed * 100) / totalDocs : 0;

      return {
        status: 'success',
        indexName,
        results: {
          batchesProcessed: numBatches,
          totalUpdated,
          completed,
          remaining: finalRemaining,
          totalDocuments: totalDocs,
          percentComplete: Math.round(percentComplete * 100) / 100,
        },
        recommendation:
          finalRemaining > 0 ? 'Continue with more bulk reindexing' : 'Reindexing complete',
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

  @Get('optimize-gin-indexes/:indexName')
  @ApiOperation({
    summary: 'Phase 1.1: Optimize GIN indexes for search performance',
    description: 'Creates optimized GIN indexes with fastupdate=off and covering indexes',
  })
  @ApiResponse({
    status: 200,
    description: 'GIN optimization results',
  })
  async optimizeGinIndexes(@Param('indexName') indexName: string) {
    try {
      const results = {
        phase: 'Phase 1.1: GIN Index Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        steps: [],
        performance: {},
      };

      // Step 1: Check current index status
      const currentIndexesQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes 
        WHERE tablename = 'search_documents' 
          AND indexname LIKE '%search_vector%'
        ORDER BY indexname
      `;

      const currentIndexes = await this.dataSource.query(currentIndexesQuery);
      results.steps.push({
        step: 1,
        action: 'Check current indexes',
        result: currentIndexes,
      });

      // Step 2: Check index configuration details
      const indexConfigQuery = `
        SELECT 
          i.indexname,
          i.indexdef,
          pg_size_pretty(pg_relation_size(i.indexname::regclass)) as size,
          COALESCE(s.idx_scan, 0) as scans,
          COALESCE(s.idx_tup_read, 0) as tuples_read
        FROM pg_indexes i
        LEFT JOIN pg_stat_user_indexes s ON i.indexname = s.indexrelname
        WHERE i.tablename = 'search_documents'
        ORDER BY i.indexname
      `;

      const indexConfig = await this.dataSource.query(indexConfigQuery);
      results.steps.push({
        step: 2,
        action: 'Analyze current index configuration',
        result: indexConfig,
      });

      // Step 3: Create optimized GIN index (if not exists)
      const createOptimizedIndexQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_vector_optimized 
          ON search_documents USING GIN (search_vector) 
          WITH (fastupdate = off, gin_pending_list_limit = 4194304)
      `;

      try {
        await this.dataSource.query(createOptimizedIndexQuery);
        results.steps.push({
          step: 3,
          action: 'Create optimized GIN index',
          result: 'SUCCESS: idx_search_vector_optimized created',
        });
      } catch (error) {
        results.steps.push({
          step: 3,
          action: 'Create optimized GIN index',
          result: `INFO: ${error.message}`,
        });
      }

      // Step 4: Create covering index
      const createCoveringIndexQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_covering 
          ON search_documents (index_name, search_vector) 
          INCLUDE (document_id, field_weights, created_at)
      `;

      try {
        await this.dataSource.query(createCoveringIndexQuery);
        results.steps.push({
          step: 4,
          action: 'Create covering index',
          result: 'SUCCESS: idx_search_documents_covering created',
        });
      } catch (error) {
        results.steps.push({
          step: 4,
          action: 'Create covering index',
          result: `INFO: ${error.message}`,
        });
      }

      // Step 5: Create composite index for common patterns
      const createCompositeIndexQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_composite
          ON search_documents (index_name) 
          WHERE search_vector IS NOT NULL AND search_vector != to_tsvector('english', '')
      `;

      try {
        await this.dataSource.query(createCompositeIndexQuery);
        results.steps.push({
          step: 5,
          action: 'Create composite index',
          result: 'SUCCESS: idx_search_documents_composite created',
        });
      } catch (error) {
        results.steps.push({
          step: 5,
          action: 'Create composite index',
          result: `INFO: ${error.message}`,
        });
      }

      // Step 6: Analyze table
      await this.dataSource.query('ANALYZE search_documents');
      results.steps.push({
        step: 6,
        action: 'Analyze search_documents table',
        result: 'SUCCESS: Statistics updated',
      });

      // Step 7: Get final index status
      const finalIndexesQuery = `
        SELECT 
          i.indexname,
          i.indexdef,
          pg_size_pretty(pg_relation_size(i.indexname::regclass)) as size,
          s.idx_scan as scans,
          s.idx_tup_read as tuples_read
        FROM pg_indexes i
        LEFT JOIN pg_stat_user_indexes s ON i.indexname = s.indexrelname
        WHERE i.tablename = 'search_documents'
        ORDER BY pg_relation_size(i.indexname::regclass) DESC
      `;

      const finalIndexes = await this.dataSource.query(finalIndexesQuery);
      results.steps.push({
        step: 7,
        action: 'Final index status',
        result: finalIndexes,
      });

      // Step 8: Performance test
      const perfTestStart = Date.now();
      const testQuery = `
        SELECT COUNT(*) 
        FROM search_documents sd 
        WHERE sd.index_name = $1 
        AND sd.search_vector @@ plainto_tsquery('english', 'test')
      `;

      await this.dataSource.query(testQuery, [indexName]);
      const perfTestDuration = Date.now() - perfTestStart;

      results.performance = {
        testQuery: 'FTS search with optimized indexes',
        duration: `${perfTestDuration}ms`,
        status: 'COMPLETED',
      };

      return results;
    } catch (error) {
      return {
        phase: 'Phase 1.1: GIN Index Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('materialize-tsvectors/:indexName')
  @ApiOperation({
    summary: 'Phase 1.2: Create materialized tsvector columns with weighted fields',
    description:
      'Adds materialized_vector column with proper field weighting for optimal FTS performance',
  })
  @ApiResponse({
    status: 200,
    description: 'Materialized tsvector optimization results',
  })
  async materializeTsvectors(@Param('indexName') indexName: string) {
    try {
      const results = {
        phase: 'Phase 1.2: Materialized tsvector Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        steps: [],
        performance: {},
      };

      // Step 1: Check if materialized_vector column exists
      const columnExistsQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'search_documents' 
        AND column_name = 'materialized_vector'
      `;

      const columnExists = await this.dataSource.query(columnExistsQuery);
      results.steps.push({
        step: 1,
        action: 'Check materialized_vector column',
        result: columnExists.length > 0 ? 'EXISTS' : 'MISSING',
        details: columnExists,
      });

      // Step 2: Add materialized_vector column if not exists
      if (columnExists.length === 0) {
        const addColumnQuery = `
          ALTER TABLE search_documents 
          ADD COLUMN IF NOT EXISTS materialized_vector tsvector
        `;

        await this.dataSource.query(addColumnQuery);
        results.steps.push({
          step: 2,
          action: 'Add materialized_vector column',
          result: 'SUCCESS: Column added',
        });
      } else {
        results.steps.push({
          step: 2,
          action: 'Add materialized_vector column',
          result: 'SKIPPED: Column already exists',
        });
      }

      // Step 3: Check sample of empty materialized vectors
      const emptyVectorQuery = `
        SELECT COUNT(*) as empty_count,
               (SELECT COUNT(*) FROM search_documents WHERE index_name = $1) as total_count
        FROM search_documents 
        WHERE index_name = $1 
        AND (materialized_vector IS NULL OR materialized_vector = to_tsvector('english', ''))
      `;

      const emptyStats = await this.dataSource.query(emptyVectorQuery, [indexName]);
      results.steps.push({
        step: 3,
        action: 'Check empty materialized vectors',
        result: emptyStats[0],
      });

      // Step 4: Update materialized vectors with weighted fields (batch approach)
      const batchSize = 1000;
      const maxBatches = 5; // Limit for testing
      let totalUpdated = 0;

      for (let batch = 0; batch < maxBatches; batch++) {
        const updateQuery = `
          UPDATE search_documents sd 
          SET materialized_vector = 
            setweight(to_tsvector('english', coalesce(d.content->>'name', '')), 'A') ||
            setweight(to_tsvector('english', coalesce(d.content->>'title', '')), 'A') ||
            setweight(to_tsvector('english', coalesce(d.content->>'description', '')), 'B') ||
            setweight(to_tsvector('english', coalesce(d.content->>'category_name', '')), 'B') ||
            setweight(to_tsvector('english', coalesce(d.content->>'tags', '')), 'C')
          FROM documents d 
          WHERE sd.document_id = d.document_id 
          AND sd.index_name = d.index_name 
          AND sd.index_name = $1
          AND (sd.materialized_vector IS NULL OR sd.materialized_vector = to_tsvector('english', ''))
          AND sd.document_id IN (
            SELECT document_id FROM search_documents 
            WHERE index_name = $1 
            AND (materialized_vector IS NULL OR materialized_vector = to_tsvector('english', ''))
            LIMIT $2
          )
        `;

        const result = await this.dataSource.query(updateQuery, [indexName, batchSize]);
        const batchUpdated = result[1] || 0;
        totalUpdated += batchUpdated;

        if (batchUpdated === 0) break; // No more to update
      }

      results.steps.push({
        step: 4,
        action: 'Update materialized vectors (sample batches)',
        result: `SUCCESS: Updated ${totalUpdated} documents`,
      });

      // Step 5: Create index on materialized_vector if not exists
      const createIndexQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_materialized_vector 
        ON search_documents USING GIN (materialized_vector) 
        WITH (fastupdate = off)
      `;

      try {
        await this.dataSource.query(createIndexQuery);
        results.steps.push({
          step: 5,
          action: 'Create materialized vector index',
          result: 'SUCCESS: idx_materialized_vector created',
        });
      } catch (error) {
        results.steps.push({
          step: 5,
          action: 'Create materialized vector index',
          result: `INFO: ${error.message}`,
        });
      }

      // Step 6: Performance comparison test
      const perfTestStart = Date.now();

      // Test with regular search_vector
      const regularQuery = `
        SELECT COUNT(*) 
        FROM search_documents sd 
        WHERE sd.index_name = $1 
        AND sd.search_vector @@ plainto_tsquery('english', 'technology')
      `;

      const regularStart = Date.now();
      await this.dataSource.query(regularQuery, [indexName]);
      const regularDuration = Date.now() - regularStart;

      // Test with materialized_vector (if populated)
      const materializedQuery = `
        SELECT COUNT(*) 
        FROM search_documents sd 
        WHERE sd.index_name = $1 
        AND sd.materialized_vector @@ plainto_tsquery('english', 'technology')
        AND sd.materialized_vector IS NOT NULL
      `;

      const materializedStart = Date.now();
      await this.dataSource.query(materializedQuery, [indexName]);
      const materializedDuration = Date.now() - materializedStart;

      results.performance = {
        regular_vector_ms: regularDuration,
        materialized_vector_ms: materializedDuration,
        improvement:
          regularDuration > 0
            ? `${Math.round(((regularDuration - materializedDuration) / regularDuration) * 100)}%`
            : 'N/A',
        status: 'COMPLETED',
      };

      // Step 7: Final statistics
      const finalStatsQuery = `
        SELECT 
          COUNT(*) as total_docs,
          COUNT(CASE WHEN materialized_vector IS NOT NULL 
                AND materialized_vector != to_tsvector('english', '') THEN 1 END) as materialized_docs,
          COUNT(CASE WHEN search_vector IS NOT NULL 
                AND search_vector != to_tsvector('english', '') THEN 1 END) as search_vector_docs
        FROM search_documents 
        WHERE index_name = $1
      `;

      const finalStats = await this.dataSource.query(finalStatsQuery, [indexName]);
      results.steps.push({
        step: 7,
        action: 'Final statistics',
        result: finalStats[0],
      });

      return results;
    } catch (error) {
      return {
        phase: 'Phase 1.2: Materialized tsvector Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('populate-all-materialized-vectors/:indexName')
  @ApiOperation({
    summary: 'Bulk populate ALL materialized vectors for performance optimization',
    description: 'Updates all empty materialized_vector columns with proper weighted tsvectors',
  })
  @ApiResponse({
    status: 200,
    description: 'Bulk materialized vector population results',
  })
  async populateAllMaterializedVectors(@Param('indexName') indexName: string) {
    try {
      const startTime = Date.now();

      // Check current status
      const statusQuery = `
        SELECT 
          COUNT(*) as total_docs,
          COUNT(CASE WHEN materialized_vector IS NULL OR materialized_vector = to_tsvector('english', '') THEN 1 END) as empty_vectors
        FROM search_documents 
        WHERE index_name = $1
      `;

      const beforeStatus = await this.dataSource.query(statusQuery, [indexName]);

      // Bulk update ALL empty materialized vectors
      const updateQuery = `
        UPDATE search_documents sd 
        SET materialized_vector = 
          setweight(to_tsvector('english', coalesce(d.content->>'name', '')), 'A') ||
          setweight(to_tsvector('english', coalesce(d.content->>'title', '')), 'A') ||
          setweight(to_tsvector('english', coalesce(d.content->>'description', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(d.content->>'category_name', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(d.content->>'tags', '')), 'C')
        FROM documents d 
        WHERE sd.document_id = d.document_id 
          AND sd.index_name = d.index_name 
          AND sd.index_name = $1
          AND (sd.materialized_vector IS NULL OR sd.materialized_vector = to_tsvector('english', ''))
      `;

      const updateResult = await this.dataSource.query(updateQuery, [indexName]);
      const updatedCount = updateResult[1] || 0;

      // Check final status
      const afterStatus = await this.dataSource.query(statusQuery, [indexName]);
      const duration = Date.now() - startTime;

      return {
        phase: 'Bulk Materialized Vector Population',
        indexName,
        timestamp: new Date().toISOString(),
        before: beforeStatus[0],
        after: afterStatus[0],
        updated: updatedCount,
        duration: `${duration}ms`,
        status: 'SUCCESS',
      };
    } catch (error) {
      return {
        phase: 'Bulk Materialized Vector Population',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('cleanup-redundant-indexes/:indexName')
  @ApiOperation({
    summary: 'Clean up redundant GIN indexes to optimize performance',
    description: 'Drops duplicate search_vector indexes while keeping the optimized one',
  })
  @ApiResponse({
    status: 200,
    description: 'Index cleanup results',
  })
  async cleanupRedundantIndexes(@Param('indexName') indexName: string) {
    try {
      const results = {
        phase: 'Index Cleanup Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        steps: [],
      };

      // Step 1: Check current index sizes and usage
      const indexStatsQuery = `
        SELECT 
          i.indexname,
          pg_size_pretty(pg_relation_size(i.indexname::regclass)) as size,
          COALESCE(s.idx_scan, 0) as scans,
          COALESCE(s.idx_tup_read, 0) as tuples_read
        FROM pg_indexes i
        LEFT JOIN pg_stat_user_indexes s ON i.indexname = s.indexrelname
        WHERE i.tablename = 'search_documents'
        AND i.indexname LIKE '%search_vector%'
        ORDER BY pg_relation_size(i.indexname::regclass) DESC
      `;

      const beforeIndexes = await this.dataSource.query(indexStatsQuery);
      results.steps.push({
        step: 1,
        action: 'Check current search_vector indexes',
        result: beforeIndexes,
      });

      // Step 2: Drop redundant indexes (keep only the optimized one)
      const indexesToDrop = ['idx_search_vector', 'idx_search_documents_search_vector'];

      const dropResults = [];
      for (const indexName of indexesToDrop) {
        try {
          await this.dataSource.query(`DROP INDEX IF EXISTS ${indexName}`);
          dropResults.push({ index: indexName, status: 'DROPPED' });
        } catch (error) {
          dropResults.push({ index: indexName, status: 'ERROR', error: error.message });
        }
      }

      results.steps.push({
        step: 2,
        action: 'Drop redundant indexes',
        result: dropResults,
      });

      // Step 3: Check final index status
      const afterIndexes = await this.dataSource.query(indexStatsQuery);
      results.steps.push({
        step: 3,
        action: 'Final index status',
        result: afterIndexes,
      });

      // Step 4: Calculate space savings
      const beforeSize = beforeIndexes.reduce((total, idx) => {
        const sizeStr = idx.size;
        const sizeNum = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
        return total + sizeNum;
      }, 0);

      const afterSize = afterIndexes.reduce((total, idx) => {
        const sizeStr = idx.size;
        const sizeNum = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
        return total + sizeNum;
      }, 0);

      results.steps.push({
        step: 4,
        action: 'Space savings calculation',
        result: {
          before: `~${beforeSize.toFixed(0)}MB`,
          after: `~${afterSize.toFixed(0)}MB`,
          saved: `~${(beforeSize - afterSize).toFixed(0)}MB`,
          percentSaved: `${(((beforeSize - afterSize) / beforeSize) * 100).toFixed(1)}%`,
        },
      });

      return results;
    } catch (error) {
      return {
        phase: 'Index Cleanup Optimization',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('create-covering-indexes/:indexName')
  @ApiOperation({
    summary: 'Create covering indexes to eliminate heap table access',
    description:
      'Creates optimized covering indexes that include document content to avoid heap lookups',
  })
  @ApiResponse({
    status: 200,
    description: 'Covering index creation results',
  })
  async createCoveringIndexes(@Param('indexName') indexName: string) {
    try {
      const results = {
        phase: 'Covering Index Creation - Priority 1 Fix',
        indexName,
        timestamp: new Date().toISOString(),
        steps: [],
      };

      // Step 1: Check current indexes
      const currentIndexesQuery = `
        SELECT 
          i.indexname,
          i.indexdef,
          pg_size_pretty(pg_relation_size(i.indexname::regclass)) as size,
          COALESCE(s.idx_scan, 0) as scans
        FROM pg_indexes i
        LEFT JOIN pg_stat_user_indexes s ON i.indexname = s.indexrelname
        WHERE i.tablename IN ('search_documents', 'documents')
        AND i.indexname LIKE '%covering%'
        ORDER BY pg_relation_size(i.indexname::regclass) DESC
      `;

      const beforeIndexes = await this.dataSource.query(currentIndexesQuery);
      results.steps.push({
        step: 1,
        action: 'Check existing covering indexes',
        result: beforeIndexes,
      });

      // Step 2: Create covering index for search_documents (most critical)
      const searchDocsCoveringQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_documents_covering_optimized 
        ON search_documents (index_name, search_vector) 
        INCLUDE (document_id, field_weights, created_at, updated_at)
      `;

      try {
        await this.dataSource.query(searchDocsCoveringQuery);
        results.steps.push({
          step: 2,
          action: 'Create search_documents covering index',
          result: { status: 'SUCCESS', index: 'idx_search_documents_covering_optimized' },
        });
      } catch (error) {
        results.steps.push({
          step: 2,
          action: 'Create search_documents covering index',
          result: { status: 'ERROR', error: error.message },
        });
      }

      // Step 3: Create covering index for documents table
      const documentsCoveringQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_covering_optimized 
        ON documents (index_name, document_id) 
        INCLUDE (content, metadata, created_at, updated_at)
      `;

      try {
        await this.dataSource.query(documentsCoveringQuery);
        results.steps.push({
          step: 3,
          action: 'Create documents covering index',
          result: { status: 'SUCCESS', index: 'idx_documents_covering_optimized' },
        });
      } catch (error) {
        results.steps.push({
          step: 3,
          action: 'Create documents covering index',
          result: { status: 'ERROR', error: error.message },
        });
      }

      // Step 4: Create materialized vector covering index
      const materializedCoveringQuery = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_materialized_vector_covering 
        ON search_documents (index_name, materialized_vector) 
        INCLUDE (document_id, field_weights, search_vector)
        WHERE materialized_vector IS NOT NULL
      `;

      try {
        await this.dataSource.query(materializedCoveringQuery);
        results.steps.push({
          step: 4,
          action: 'Create materialized vector covering index',
          result: { status: 'SUCCESS', index: 'idx_materialized_vector_covering' },
        });
      } catch (error) {
        results.steps.push({
          step: 4,
          action: 'Create materialized vector covering index',
          result: { status: 'ERROR', error: error.message },
        });
      }

      // Step 5: Check final covering indexes
      const afterIndexes = await this.dataSource.query(currentIndexesQuery);
      results.steps.push({
        step: 5,
        action: 'Final covering indexes status',
        result: afterIndexes,
      });

      // Step 6: Force PostgreSQL to analyze the new indexes
      try {
        await this.dataSource.query('ANALYZE search_documents');
        await this.dataSource.query('ANALYZE documents');
        results.steps.push({
          step: 6,
          action: 'Analyze tables for new indexes',
          result: { status: 'SUCCESS' },
        });
      } catch (error) {
        results.steps.push({
          step: 6,
          action: 'Analyze tables for new indexes',
          result: { status: 'ERROR', error: error.message },
        });
      }

      return results;
    } catch (error) {
      return {
        phase: 'Covering Index Creation - Priority 1 Fix',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('fix-dual-indexing/:indexName')
  @ApiOperation({
    summary: 'Fix dual indexing architecture conflict',
    description: 'Resolves conflict between old indexing service and PostgreSQL search engine',
  })
  @ApiResponse({
    status: 200,
    description: 'Dual indexing fix results',
  })
  async fixDualIndexing(@Param('indexName') indexName: string) {
    try {
      const results = {
        phase: 'Dual Indexing Architecture Fix - Priority 1',
        indexName,
        timestamp: new Date().toISOString(),
        steps: [],
      };

      // Step 1: Analyze current indexing conflicts
      const conflictAnalysisQuery = `
        SELECT 
          'search_documents' as table_name,
          COUNT(*) as document_count,
          COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as search_vector_count,
          COUNT(CASE WHEN materialized_vector IS NOT NULL THEN 1 END) as materialized_vector_count
        FROM search_documents 
        WHERE index_name = $1
        UNION ALL
        SELECT 
          'documents' as table_name,
          COUNT(*) as document_count,
          0 as search_vector_count,
          0 as materialized_vector_count
        FROM documents 
        WHERE index_name = $1
      `;

      const conflictAnalysis = await this.dataSource.query(conflictAnalysisQuery, [indexName]);
      results.steps.push({
        step: 1,
        action: 'Analyze indexing conflicts',
        result: conflictAnalysis,
      });

      // Step 2: Check for orphaned documents (in documents but not in search_documents)
      const orphanedDocsQuery = `
        SELECT d.document_id, d.index_name
        FROM documents d
        LEFT JOIN search_documents sd ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE d.index_name = $1 AND sd.document_id IS NULL
        LIMIT 10
      `;

      const orphanedDocs = await this.dataSource.query(orphanedDocsQuery, [indexName]);
      results.steps.push({
        step: 2,
        action: 'Check for orphaned documents',
        result: { count: orphanedDocs.length, sample: orphanedDocs },
      });

      // Step 3: Sync missing search_documents from documents table
      if (orphanedDocs.length > 0) {
        const syncQuery = `
          INSERT INTO search_documents (document_id, index_name, search_vector, field_weights)
          SELECT 
            d.document_id,
            d.index_name,
            setweight(to_tsvector('english', coalesce(d.content->>'name', '')), 'A') ||
            setweight(to_tsvector('english', coalesce(d.content->>'title', '')), 'A') ||
            setweight(to_tsvector('english', coalesce(d.content->>'description', '')), 'B') ||
            setweight(to_tsvector('english', coalesce(d.content->>'category_name', '')), 'B') ||
            setweight(to_tsvector('english', coalesce(d.content->>'tags', '')), 'C') as search_vector,
            '{}'::jsonb as field_weights
          FROM documents d
          LEFT JOIN search_documents sd ON d.document_id = sd.document_id AND d.index_name = sd.index_name
          WHERE d.index_name = $1 AND sd.document_id IS NULL
          ON CONFLICT (document_id, index_name) DO NOTHING
        `;

        const syncResult = await this.dataSource.query(syncQuery, [indexName]);
        results.steps.push({
          step: 3,
          action: 'Sync orphaned documents to search_documents',
          result: { synced_count: syncResult?.length || 0 },
        });
      } else {
        results.steps.push({
          step: 3,
          action: 'Sync orphaned documents to search_documents',
          result: { synced_count: 0, message: 'No orphaned documents found' },
        });
      }

      // Step 4: Update materialized vectors for documents missing them
      const updateMaterializedQuery = `
        UPDATE search_documents 
        SET materialized_vector = 
          setweight(to_tsvector('english', coalesce(d.content->>'name', '')), 'A') ||
          setweight(to_tsvector('english', coalesce(d.content->>'title', '')), 'A') ||
          setweight(to_tsvector('english', coalesce(d.content->>'description', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(d.content->>'category_name', '')), 'B') ||
          setweight(to_tsvector('english', coalesce(d.content->>'tags', '')), 'C')
        FROM documents d
        WHERE search_documents.document_id = d.document_id 
        AND search_documents.index_name = d.index_name
        AND search_documents.index_name = $1
        AND search_documents.materialized_vector IS NULL
      `;

      const updateResult = await this.dataSource.query(updateMaterializedQuery, [indexName]);
      results.steps.push({
        step: 4,
        action: 'Update missing materialized vectors',
        result: { updated_count: updateResult?.length || 0 },
      });

      // Step 5: Final consistency check
      const finalCheckQuery = `
        SELECT 
          COUNT(*) as total_documents,
          COUNT(CASE WHEN sd.document_id IS NOT NULL THEN 1 END) as indexed_documents,
          COUNT(CASE WHEN sd.materialized_vector IS NOT NULL THEN 1 END) as materialized_documents,
          ROUND(
            COUNT(CASE WHEN sd.document_id IS NOT NULL THEN 1 END)::decimal / 
            COUNT(*)::decimal * 100, 2
          ) as indexing_coverage_percent,
          ROUND(
            COUNT(CASE WHEN sd.materialized_vector IS NOT NULL THEN 1 END)::decimal / 
            COUNT(*)::decimal * 100, 2
          ) as materialized_coverage_percent
        FROM documents d
        LEFT JOIN search_documents sd ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE d.index_name = $1
      `;

      const finalCheck = await this.dataSource.query(finalCheckQuery, [indexName]);
      results.steps.push({
        step: 5,
        action: 'Final consistency check',
        result: finalCheck[0],
      });

      return results;
    } catch (error) {
      return {
        phase: 'Dual Indexing Architecture Fix - Priority 1',
        indexName,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'FAILED',
      };
    }
  }

  @Get('add-search-columns/:indexName')
  @ApiOperation({
    summary: 'Add search columns to documents table',
    description:
      'Adds search_vector, field_weights, and materialized_vector columns to documents table',
  })
  async addSearchColumns(@Param('indexName') indexName: string) {
    try {
      // Read and execute the add columns script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'add-search-columns.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the script
      await this.dataSource.query(script);

      // Verify the columns were added
      const columnsQuery = `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'documents' 
        AND column_name IN ('search_vector', 'field_weights', 'materialized_vector')
        ORDER BY column_name
      `;
      const columns = await this.dataSource.query(columnsQuery);

      return {
        status: 'success',
        message: 'Search columns added to documents table',
        indexName,
        columns: columns,
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

  @Get('proper-consolidation/:indexName')
  @ApiOperation({
    summary: 'Proper table consolidation with batched migration',
    description: 'Migrates search_documents data into documents table using batched approach to avoid timeouts',
  })
  async properConsolidation(@Param('indexName') indexName: string) {
    try {
      // Read and execute the proper consolidation script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'proper-consolidation.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the script
      await this.dataSource.query(script);

      // Verify the consolidation
      const docCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const searchDocCountQuery = `SELECT COUNT(*) as count FROM search_documents WHERE index_name = $1`;
      const vectorCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND search_vector IS NOT NULL`;
      const materializedCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND materialized_vector IS NOT NULL`;

      const [docCount, searchDocCount, vectorCount, materializedCount] = await Promise.all([
        this.dataSource.query(docCountQuery, [indexName]),
        this.dataSource.query(searchDocCountQuery, [indexName]),
        this.dataSource.query(vectorCountQuery, [indexName]),
        this.dataSource.query(materializedCountQuery, [indexName]),
      ]);

      return {
        status: 'success',
        message: 'Proper table consolidation completed with batched migration',
        indexName,
        results: {
          documents: parseInt(docCount[0]?.count || '0'),
          searchDocuments: parseInt(searchDocCount[0]?.count || '0'),
          documentsWithVectors: parseInt(vectorCount[0]?.count || '0'),
          documentsWithMaterialized: parseInt(materializedCount[0]?.count || '0'),
        },
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

  @Get('consolidate-tables/:indexName')
  @ApiOperation({
    summary: 'Consolidate dual-table architecture into single table',
    description:
      'Migrates search_documents data into documents table and creates optimized indexes',
  })
  async consolidateTables(@Param('indexName') indexName: string) {
    try {
      // Read and execute the consolidation script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'consolidate-tables.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the migration script
      await this.dataSource.query(script);

      // Verify the consolidation
      const docCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const searchDocCountQuery = `SELECT COUNT(*) as count FROM search_documents WHERE index_name = $1`;
      const vectorCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND search_vector IS NOT NULL`;

      const [docCount, searchDocCount, vectorCount] = await Promise.all([
        this.dataSource.query(docCountQuery, [indexName]),
        this.dataSource.query(searchDocCountQuery, [indexName]),
        this.dataSource.query(vectorCountQuery, [indexName]),
      ]);

      return {
        status: 'success',
        message: 'Table consolidation completed successfully',
        indexName,
        results: {
          documents: parseInt(docCount[0]?.count || '0'),
          searchDocuments: parseInt(searchDocCount[0]?.count || '0'),
          documentsWithVectors: parseInt(vectorCount[0]?.count || '0'),
        },
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

  @Get('migrate-search-data/:indexName')
  @ApiOperation({
    summary: 'Migrate search data from search_documents to documents table',
    description: 'Copies search vectors and field weights from search_documents to documents table',
  })
  async migrateSearchData(@Param('indexName') indexName: string) {
    try {
      // Read and execute the migration script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'migrate-search-data.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the script
      await this.dataSource.query(script);

      // Verify the migration
      const docCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1`;
      const searchDocCountQuery = `SELECT COUNT(*) as count FROM search_documents WHERE index_name = $1`;
      const vectorCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND search_vector IS NOT NULL`;
      const materializedCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND materialized_vector IS NOT NULL`;

      const [docCount, searchDocCount, vectorCount, materializedCount] = await Promise.all([
        this.dataSource.query(docCountQuery, [indexName]),
        this.dataSource.query(searchDocCountQuery, [indexName]),
        this.dataSource.query(vectorCountQuery, [indexName]),
        this.dataSource.query(materializedCountQuery, [indexName]),
      ]);

      return {
        status: 'success',
        message: 'Search data migration completed',
        indexName,
        results: {
          documents: parseInt(docCount[0]?.count || '0'),
          searchDocuments: parseInt(searchDocCount[0]?.count || '0'),
          documentsWithVectors: parseInt(vectorCount[0]?.count || '0'),
          documentsWithMaterialized: parseInt(materializedCount[0]?.count || '0'),
        },
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

  @Get('generate-search-vectors/:indexName')
  @ApiOperation({
    summary: 'Generate search vectors from document content',
    description: 'Creates search vectors directly from document content for single-table search',
  })
  async generateSearchVectors(@Param('indexName') indexName: string) {
    try {
      // Read and execute the script
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), 'scripts', 'generate-search-vectors.sql');
      const script = fs.readFileSync(scriptPath, 'utf8');

      // Execute the script
      await this.dataSource.query(script);

      // Verify the generation
      const vectorCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND search_vector IS NOT NULL`;
      const materializedCountQuery = `SELECT COUNT(*) as count FROM documents WHERE index_name = $1 AND materialized_vector IS NOT NULL`;

      const [vectorCount, materializedCount] = await Promise.all([
        this.dataSource.query(vectorCountQuery, [indexName]),
        this.dataSource.query(materializedCountQuery, [indexName]),
      ]);

      return {
        status: 'success',
        message: 'Search vectors generated from document content',
        indexName,
        results: {
          documentsWithVectors: parseInt(vectorCount[0]?.count || '0'),
          documentsWithMaterialized: parseInt(materializedCount[0]?.count || '0'),
        },
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
}
