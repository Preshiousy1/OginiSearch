import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PostgreSQLDocumentProcessor } from './postgresql-document-processor';
import { PostgreSQLAnalysisAdapter } from './postgresql-analysis.adapter';

import { QueryProcessorService } from '../../search/query-processor.service';
import { IndexConfig } from '../../common/interfaces/index.interface';
import {
  SearchQueryDto,
  SearchResponseDto,
  SuggestQueryDto,
  SuggestionResultDto,
} from '../../api/dtos/search.dto';
import { CreateIndexDto, IndexResponseDto } from '../../api/dtos/index.dto';
import { RawQuery } from '../../search/interfaces/query-processor.interface';
import { SearchEngine } from '../../search/interfaces/search-engine.interface';
import { BM25Scorer } from '../../index/bm25-scorer';
import { PostgreSQLIndexStats } from './postgresql-index-stats';
import { PostgreSQLResultProcessorService } from './result-processor.service';
import { PostgreSQLPerformanceMonitorService } from './performance-monitor.service';
import { TypoToleranceService } from '../../search/typo-tolerance.service';
import { OptimizedQueryCacheService, CacheStats } from './optimized-query-cache.service';
import { BM25RankingService } from './bm25-ranking.service';
import { FilterBuilderService } from './filter-builder.service';
import { RedisCacheService } from './redis-cache.service';

export interface PostgreSQLSearchOptions {
  from?: number;
  size?: number;
  sort?: string;
  filter?: Record<string, any>;
  highlight?: boolean;
  facets?: string[];
}

export interface PostgreSQLSearchResult {
  totalHits: number;
  maxScore: number;
  hits: Array<{
    id: string;
    score: number;
    document: Record<string, any>;
    highlights?: Record<string, string[]>;
  }>;
  facets?: Record<string, any>;
  took: number;
}

interface SearchMetrics {
  queryParsing: number;
  execution: number;
  highlighting: number;
  faceting: number;
  total: number;
  planStats?: any;
}

@Injectable()
export class PostgreSQLSearchEngine implements SearchEngine, OnModuleInit {
  private readonly logger = new Logger(PostgreSQLSearchEngine.name);
  private hasNameLowerColumn: boolean | null = null; // Cache column existence check
  private hasCategoryLowerColumn: boolean | null = null;

  /**
   * Clear column cache (call after optimization completes)
   */
  clearColumnCache(): void {
    this.hasNameLowerColumn = null;
    this.hasCategoryLowerColumn = null;
    this.logger.log('Column existence cache cleared - will recheck on next query');
  }
  private readonly indices = new Map<string, IndexConfig>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly optimizedCache: OptimizedQueryCacheService,
    private readonly redisCache: RedisCacheService,
  ) {
    this.logger.log('PostgreSQLSearchEngine initialized');
  }

  async onModuleInit() {
    await this.loadIndicesFromDatabase();
  }

  private async loadIndicesFromDatabase() {
    try {
      const indices = await this.dataSource.query('SELECT * FROM indices');

      for (const index of indices) {
        this.indices.set(index.index_name, {
          searchableAttributes: ['name', 'title', 'description'],
          filterableAttributes: [],
          defaultAnalyzer: 'standard',
          fieldAnalyzers: {},
        });
      }

      this.logger.log(`Loaded ${indices.length} indices from database`);
    } catch (error) {
      this.logger.error(`Failed to load indices from database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search documents using PostgreSQL full-text search
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<any> {
    const startTime = Date.now();

    const searchTerm = this.extractSearchTerm(searchQuery);

    const size = Math.min(searchQuery.size || 10, 100); // Cap at 100
    const from = searchQuery.from || 0;

    try {
      // Build optimized data query
      const { sql: dataSql, params: dataParams } = await this.buildOptimizedSingleQuery(
        indexName,
        searchTerm,
        size,
        from,
        searchQuery.filter,
      );

      // Build optimized count query
      const { sql: countSql, params: countParams } = await this.buildCountQuery(
        indexName,
        searchTerm,
        searchQuery.filter,
      );

      // Execute queries in parallel for better performance
      const [results, countResult] = await Promise.all([
        this.dataSource.query(dataSql, dataParams),
        this.dataSource.query(countSql, countParams),
      ]);

      const queryTime = Date.now() - startTime;

      // 🐌 Simple warning for very slow queries
      if (queryTime > 3000) {
        this.logger.error(
          `🐌 VERY SLOW QUERY (${queryTime}ms) for "${searchTerm}"! Consider:\n` +
            `   1. Run ANALYZE documents;\n` +
            `   2. Check if indexes exist: /debug/verify-search-indexes\n` +
            `   3. Review query structure and filters`,
        );
      } else if (queryTime > 1000) {
        this.logger.warn(`⚠️ Slow query (${queryTime}ms) for "${searchTerm}"`);
      }

      const total = parseInt(countResult[0]?.total_count || '0');

      const responseData = {
        data: {
          hits: results.map((row: any) => ({
            id: row.document_id,
            index: indexName,
            score: row.rank || 1.0,
            source: row.content,
          })),
          total: total.toString(),
          maxScore: results.length > 0 ? Math.max(...results.map((r: any) => r.rank || 1.0)) : 0,
        },
        pagination: {
          currentPage: Math.floor(from / size) + 1,
          totalPages: Math.ceil(total / size),
          pageSize: size,
          hasNext: from + size < total,
          hasPrevious: from > 0,
          totalResults: total.toString(),
        },
        took: Date.now() - startTime,
      };

      return responseData;
    } catch (error) {
      if (error.message.includes('statement_timeout')) {
        throw new Error('Search query timed out. Please try a more specific search term.');
      }
      throw error;
    }
  }

  /**
   * Get suggestions for autocomplete using PostgreSQL
   */
  async suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<SuggestionResultDto[]> {
    this.logger.log(`PostgreSQL suggestions in index ${indexName} for: ${suggestQuery.text}`);

    try {
      await this.validateIndexExists(indexName);

      const { text, field = 'title', size = 5 } = suggestQuery;

      // First try prefix matching (most relevant)
      const prefixQuery = `
        SELECT DISTINCT ON (d.content->>'${field}')
          d.content->>'${field}' as suggestion,
          d.document_id as id,
          d.content->>'category_name' as category
        FROM documents d
        WHERE d.index_name = $1 
          AND d.content->>'${field}' IS NOT NULL
          AND d.content->>'${field}' ILIKE $2
        ORDER BY d.content->>'${field}', d.document_id
        LIMIT $3`;

      let results = await this.dataSource.query(prefixQuery, [indexName, `${text}%`, size]);

      // If no prefix matches, try substring matching
      if (results.length === 0) {
        const substringQuery = `
          SELECT DISTINCT ON (d.content->>'${field}')
            d.content->>'${field}' as suggestion,
            d.document_id as id,
            d.content->>'category_name' as category
          FROM documents d
          WHERE d.index_name = $1 
            AND d.content->>'${field}' IS NOT NULL
            AND d.content->>'${field}' ILIKE $2
          ORDER BY d.content->>'${field}', d.document_id
          LIMIT $3`;
        results = await this.dataSource.query(substringQuery, [indexName, `%${text}%`, size]);
      }

      // If still no results, use simple substring matching as fallback
      if (results.length === 0) {
        const fallbackQuery = `
          SELECT DISTINCT ON (d.content->>'${field}')
            d.content->>'${field}' as suggestion,
            d.document_id as id,
            d.content->>'category_name' as category
          FROM documents d
          WHERE d.index_name = $1 
            AND d.content->>'${field}' IS NOT NULL
            AND LENGTH(d.content->>'${field}') > 2
          ORDER BY d.content->>'${field}', d.document_id
          LIMIT $2`;

        results = await this.dataSource.query(fallbackQuery, [indexName, size]);
      }

      // Filter and format results
      return results
        .filter(row => row.suggestion)
        .slice(0, size)
        .map(row => ({
          text: row.suggestion,
          id: row.id,
          category: row.category,
        }));
    } catch (error) {
      this.logger.error(`PostgreSQL suggestions error: ${error.message}`);
      throw error; // Let the controller handle the error
    }
  }

  /**
   * Check if index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    return this.indices.has(indexName);
  }

  /**
   * Index a document (alias for addDocument)
   */
  async indexDocument(
    indexName: string,
    documentId: string,
    document: Record<string, any>,
  ): Promise<void> {
    return this.addDocument(indexName, documentId, document);
  }

  /**
   * Bulk index documents (alias for addDocuments)
   */
  async bulkIndexDocuments(
    indexName: string,
    documents: Array<{ id: string; document: Record<string, any> }>,
  ): Promise<void> {
    return this.addDocuments(indexName, documents);
  }

  /**
   * Delete an index
   */
  async deleteIndex(indexName: string): Promise<void> {
    this.logger.log(`Deleting PostgreSQL index: ${indexName}`);

    try {
      // Delete from indices table - this will cascade to documents and search_documents
      await this.dataSource.query('DELETE FROM indices WHERE index_name = $1', [indexName]);

      // Remove from memory
      this.indices.delete(indexName);

      this.logger.log(`Index ${indexName} deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete index ${indexName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear dictionary/cache for an index
   */
  async clearDictionary(indexName: string): Promise<{ message: string }> {
    this.logger.log(`Clearing dictionary for PostgreSQL index: ${indexName}`);

    // For PostgreSQL, we can clear any cached data or refresh statistics
    try {
      await this.dataSource.query('ANALYZE search_documents');
      return { message: `Dictionary cleared for index ${indexName}` };
    } catch (error) {
      this.logger.error(`Failed to clear dictionary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get term statistics for an index
   */
  async getTermStats(indexName: string): Promise<Array<{ term: string; freq: number }>> {
    this.logger.log(`Getting term stats for PostgreSQL index: ${indexName}`);

    try {
      // Get most frequent terms from the search_vector
      const stats = await this.dataSource.query(
        `SELECT 
           unnest(tsvector_to_array(search_vector)) as term,
           COUNT(*) as freq
         FROM search_documents 
         WHERE index_name = $1 
         GROUP BY term
         ORDER BY freq DESC
         LIMIT 100`,
        [indexName],
      );

      return stats.map(row => ({
        term: row.term,
        freq: parseInt(row.freq, 10),
      }));
    } catch (error) {
      this.logger.error(`Failed to get term stats: ${error.message}`);
      return [];
    }
  }

  /**
   * Add a single document to PostgreSQL index with individual transaction
   */
  async addDocument(
    indexName: string,
    documentId: string,
    document: Record<string, any>,
  ): Promise<void> {
    this.logger.debug(`Adding document ${documentId} to PostgreSQL index ${indexName}`);

    // Use a query runner for individual transaction management
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.validateIndexExists(indexName);

      // Generate search vector from document content
      const searchVector = this.generateSearchVector(document);

      // Insert or update document using the query runner
      await queryRunner.query(
        `INSERT INTO documents (index_name, document_id, content, metadata, search_vector, materialized_vector, field_weights)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (document_id, index_name) 
         DO UPDATE SET 
           content = $3, 
           metadata = $4,
           search_vector = $5, 
           materialized_vector = $6,
           field_weights = $7, 
           updated_at = NOW()`,
        [
          indexName,
          documentId,
          JSON.stringify(document),
          JSON.stringify({}), // Default empty metadata
          searchVector,
          searchVector, // Use searchVector as materializedVector
          JSON.stringify({}), // Default empty field weights
        ],
      );

      // Commit the transaction
      await queryRunner.commitTransaction();
      this.logger.debug(`Document ${documentId} added successfully`);
    } catch (error) {
      // Rollback the transaction on error
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to add document ${documentId}: ${error.message}`);
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  /**
   * Add multiple documents to PostgreSQL index
   */
  async addDocuments(
    indexName: string,
    documents: Array<{ id: string; document: Record<string, any> }>,
  ): Promise<void> {
    this.logger.log(`Adding ${documents.length} documents to PostgreSQL index ${indexName}`);

    try {
      await this.validateIndexExists(indexName);

      // Process documents in batches
      const batchSize = 100;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await this.processBatch(indexName, batch);
      }

      this.logger.log(
        `Successfully added ${documents.length} documents to PostgreSQL index ${indexName}`,
      );
    } catch (error) {
      this.logger.error(`Failed to add documents: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a document from PostgreSQL index
   */
  async deleteDocument(indexName: string, documentId: string): Promise<void> {
    this.logger.debug(`Deleting document ${documentId} from PostgreSQL index ${indexName}`);

    try {
      const result = await this.dataSource.query(
        'DELETE FROM search_documents WHERE index_name = $1 AND doc_id = $2',
        [indexName, documentId],
      );

      if (result.rowCount === 0) {
        throw new NotFoundException(`Document ${documentId} not found in index ${indexName}`);
      }

      this.logger.debug(`Document ${documentId} deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete document ${documentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new PostgreSQL index
   */
  async createIndex(createIndexDto: CreateIndexDto): Promise<IndexResponseDto> {
    this.logger.log(`Creating PostgreSQL index: ${createIndexDto.name}`);

    try {
      if (this.indices.has(createIndexDto.name)) {
        throw new BadRequestException(`Index ${createIndexDto.name} already exists`);
      }

      // Create index configuration
      const indexConfig: IndexConfig = {
        searchableAttributes: ['name', 'title', 'description'],
        filterableAttributes: [],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {},
      };

      this.indices.set(createIndexDto.name, indexConfig);

      return {
        name: createIndexDto.name,
        status: 'open',
        documentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: createIndexDto.settings || {},
        mappings: createIndexDto.mappings || { properties: {} },
      };
    } catch (error) {
      this.logger.error(`Failed to create PostgreSQL index: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get PostgreSQL index information
   */
  async getIndex(indexName: string): Promise<IndexResponseDto> {
    // If index is not in memory, check database and add to cache if found
    if (!this.indices.has(indexName)) {
      const indexResult = await this.dataSource.query(
        'SELECT settings, document_count FROM indices WHERE index_name = $1',
        [indexName],
      );

      if (indexResult.length === 0) {
        throw new NotFoundException(`Index ${indexName} not found`);
      }

      // Add index to memory cache
      const indexConfig: IndexConfig = {
        searchableAttributes: ['name', 'title', 'description'],
        filterableAttributes: [],
        defaultAnalyzer: 'standard',
        fieldAnalyzers: {},
      };
      this.indices.set(indexName, indexConfig);
      this.logger.log(`Added index ${indexName} to memory cache`);
    }

    // Get index data from database including settings and mappings
    const indexResult = await this.dataSource.query(
      'SELECT settings, document_count FROM indices WHERE index_name = $1',
      [indexName],
    );

    if (indexResult.length === 0) {
      throw new NotFoundException(`Index ${indexName} not found in database`);
    }

    const indexData = indexResult[0];
    const settings = indexData.settings || {};
    const documentCount = parseInt(indexData.document_count || '0', 10);

    // Extract mappings from settings (mappings are stored in settings.mappings)
    const mappings = settings.mappings || { properties: {} };

    return {
      name: indexName,
      status: 'open',
      documentCount,
      createdAt: new Date(),
      updatedAt: new Date(),
      settings,
      mappings,
    };
  }

  /**
   * Update PostgreSQL index configuration
   */
  async updateIndex(indexName: string, config: Partial<IndexConfig>): Promise<IndexResponseDto> {
    this.logger.log(`Updating PostgreSQL index: ${indexName}`);

    try {
      if (!this.indices.has(indexName)) {
        throw new NotFoundException(`Index ${indexName} not found`);
      }

      // Update index configuration
      const currentConfig = this.indices.get(indexName)!;
      const updatedConfig = { ...currentConfig, ...config };
      this.indices.set(indexName, updatedConfig);

      // Return updated index info
      return await this.getIndex(indexName);
    } catch (error) {
      this.logger.error(`Failed to update PostgreSQL index: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert search query to PostgreSQL tsquery
   */
  private convertToTsQuery(searchTerms: string): string {
    if (!searchTerms || searchTerms.trim() === '') {
      return '';
    }

    // Split into individual terms and clean them
    const terms = searchTerms
      .split(/\s+/)
      .map(term => term.toLowerCase().replace(/[^\w]/g, ''))
      .filter(term => term.length > 0);

    if (terms.length === 0) {
      return '';
    }

    // Create a simple OR query for multiple terms
    if (terms.length === 1) {
      return terms[0];
    }

    // For multiple terms, create an OR query
    return terms.join(' | ');
  }

  /**
   * Execute PostgreSQL search using simplified architecture
   */
  private async executeSearch(
    indexName: string,
    tsquery: string,
    searchQuery: SearchQueryDto,
  ): Promise<{
    totalHits: number;
    maxScore: number;
    hits: Array<{ id: string; score: number; document: Record<string, any> }>;
  }> {
    const { from = 0, size = 10 } = searchQuery;
    const candidateLimit = Math.min(size * 10, 200);

    try {
      // Simple PostgreSQL full-text search
      const sql = `
        SELECT 
          d.document_id,
          d.content,
          d.metadata,
          ts_rank_cd(COALESCE(d.materialized_vector, d.search_vector), to_tsquery('english', $1)) as postgresql_score,
          COUNT(*) OVER() as total_count
        FROM documents d
        WHERE d.index_name = $2 
          AND COALESCE(d.materialized_vector, d.search_vector) @@ to_tsquery('english', $1)
        ORDER BY postgresql_score DESC
        LIMIT $3`;

      const params = [tsquery, indexName, candidateLimit];

      const mainResult = await this.dataSource.query(sql, params);

      if (mainResult.length > 0) {
        // Process main results
        const totalHits = mainResult[0]?.total_count || mainResult.length;
        const maxScore = Math.max(...mainResult.map(row => row.postgresql_score || 0));
        const hits = mainResult.slice(from, from + size).map(row => ({
          id: row.document_id,
          score: row.postgresql_score || 0,
          document: row.content,
        }));

        return { totalHits, maxScore, hits };
      }

      // No results found
      return { totalHits: 0, maxScore: 0, hits: [] };
    } catch (error) {
      this.logger.error(`Search execution failed: ${error.message}`);
      return { totalHits: 0, maxScore: 0, hits: [] };
    }
  }

  /**
   * Calculate term frequency in a text field
   */
  private calculateTermFrequency(text: string, term: string): number {
    if (!term) return 0;
    // Remove wildcard characters commonly present in search inputs
    const sanitized = term.replace(/[\*\?]/g, '');
    if (!sanitized) return 0;
    // Escape regex metacharacters
    const escaped = sanitized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  /**
   * Process a batch of documents with individual error handling
   */
  private async processBatch(
    indexName: string,
    documents: Array<{ id: string; document: Record<string, any> }>,
  ): Promise<void> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each document individually to avoid transaction abortion
    for (const doc of documents) {
      try {
        await this.addDocument(indexName, doc.id, doc.document);
        results.success++;
      } catch (error) {
        results.failed++;
        const errorMessage = `Document ${doc.id}: ${error.message}`;
        results.errors.push(errorMessage);
        this.logger.error(errorMessage);

        // Continue processing other documents instead of aborting
        continue;
      }
    }

    // Log batch results
    if (results.failed > 0) {
      this.logger.warn(
        `Batch processing completed with ${results.success} successes and ${results.failed} failures`,
      );
      if (results.errors.length > 0) {
        this.logger.debug(`First few errors: ${results.errors.slice(0, 3).join(', ')}`);
      }
    } else {
      this.logger.debug(`Batch processing completed successfully: ${results.success} documents`);
    }
  }

  /**
   * Validate that index exists
   */
  private async validateIndexExists(indexName: string): Promise<void> {
    const result = await this.dataSource.query('SELECT 1 FROM indices WHERE index_name = $1', [
      indexName,
    ]);
    if (result.length === 0) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }
  }

  /**
   * Clear query cache
   */
  async clearCache(): Promise<void> {
    this.optimizedCache.clear();
    this.logger.log('Query cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.optimizedCache.getStats();
  }

  /**
   * Warm cache with popular queries for better performance
   */
  async warmCache(indexName: string, popularQueries: SearchQueryDto[]): Promise<void> {
    await this.optimizedCache.warmCache(indexName, popularQueries, (idx, query) =>
      this.search(idx, query),
    );
  }

  /**
   * Phase 3 Decomposed Search: SQL-level limiting with proper filtering
   */
  private async executeDecomposedSearch(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<{
    totalHits: number;
    maxScore: number;
    hits: Array<{ id: string; score: number; document: Record<string, any> }>;
  }> {
    // Build optimized SQL query with SQL-level LIMIT and filtering
    const { sql, params } = await this.buildSearchQuery(indexName, searchQuery);

    // Execute query directly
    const rows = await this.dataSource.query(sql, params);

    if (rows.length === 0) {
      return { totalHits: 0, maxScore: 0, hits: [] };
    }

    // Extract total from first row (using SQL window function)
    const totalHits = rows[0]?.total_count || rows.length;

    // Calculate max score
    const maxScore = rows.length > 0 ? Math.max(...rows.map(row => row.score || 0)) : 0;

    // Transform results
    const hits = rows.map(row => ({
      id: row.document_id,
      score: row.score || 0,
      document: row.content,
    }));

    return { totalHits, maxScore, hits };
  }

  /**
   * Build simple search query without complex query builders
   */
  private async buildSearchQuery(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<{ sql: string; params: any[] }> {
    const { query, size = 10, from = 0 } = searchQuery;
    const searchTerm = this.extractSearchTerm(searchQuery);

    const sql = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        ts_rank_cd(COALESCE(d.materialized_vector, d.search_vector), to_tsquery('english', $1)) as score,
        COUNT(*) OVER() as total_count
      FROM documents d
      WHERE d.index_name = $2 
        AND COALESCE(d.materialized_vector, d.search_vector) @@ to_tsquery('english', $1)
      ORDER BY score DESC, document_id
      LIMIT $3 OFFSET $4`;

    const params = [searchTerm, indexName, size, from];

    return { sql, params };
  }

  /**
   * Build optimized count query
   */
  private async buildCountQuery(
    indexName: string,
    searchTerm: string,
    filter?: any,
  ): Promise<{ sql: string; params: any[] }> {
    const normalizedTerm = this.normalizeSearchQuery(searchTerm);
    const lowercasedTerm = normalizedTerm.toLowerCase(); // For comparison with name_lower index
    const filterConditions = this.buildFilterConditions(filter);

    // Check if optimized columns exist (once for the whole function)
    const { nameLower, categoryLower } = await this.checkOptimizedColumnsExist();

    // Handle match_all queries
    if (normalizedTerm === '*' || normalizedTerm === '') {
      const sql = `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          ${filterConditions ? `AND ${filterConditions}` : ''}
      `;
      return { sql, params: [indexName] };
    }

    // Check if wildcard query
    const isWildcard = searchTerm.includes('*') || searchTerm.includes('?');
    const cleanTerm = normalizedTerm.replace(/[*?]/g, '').toLowerCase(); // Lowercase for name_lower comparison

    if (isWildcard) {
      // Count for wildcard queries
      let sql: string;

      if (nameLower && categoryLower) {
        // FAST PATH: Use indexed columns
        sql = `
          SELECT COUNT(*) as total_count
          FROM documents
          WHERE index_name = $1
            AND is_active = true
            AND is_verified = true
            AND is_blocked = false
            AND (
              name_lower LIKE '%' || $2 || '%'
              OR category_lower LIKE '%' || $2 || '%'
            )
            ${filterConditions ? `AND ${filterConditions}` : ''}
        `;
      } else {
        // FALLBACK PATH: Use original query
        sql = `
          SELECT COUNT(*) as total_count
          FROM documents
          WHERE index_name = $1
            AND is_active = true
            AND is_verified = true
            AND is_blocked = false
            AND (
              lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE '%' || $2 || '%'
              OR lower(COALESCE(content->>'category_name', content->>'category', '')) LIKE '%' || $2 || '%'
            )
            ${filterConditions ? `AND ${filterConditions}` : ''}
        `;
      }

      return {
        sql,
        params: [indexName, cleanTerm],
      };
    }

    // Use optimized count for full-text search queries
    let sql: string;

    if (nameLower) {
      // FAST PATH: Use indexed name_lower column
      sql = `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            name_lower LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
          ${filterConditions ? `AND ${filterConditions}` : ''}
      `;
    } else {
      // FALLBACK PATH: Use original query
      sql = `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
          ${filterConditions ? `AND ${filterConditions}` : ''}
      `;
    }

    return {
      sql,
      params: [lowercasedTerm, indexName],
    };
  }

  /**
   * Check if optimized columns exist (cached)
   */
  private async checkOptimizedColumnsExist(): Promise<{
    nameLower: boolean;
    categoryLower: boolean;
  }> {
    if (this.hasNameLowerColumn !== null && this.hasCategoryLowerColumn !== null) {
      return {
        nameLower: this.hasNameLowerColumn,
        categoryLower: this.hasCategoryLowerColumn,
      };
    }

    try {
      const result = await this.dataSource.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'documents' 
          AND column_name IN ('name_lower', 'category_lower')
      `);

      const columns = result.map((r: any) => r.column_name);
      this.hasNameLowerColumn = columns.includes('name_lower');
      this.hasCategoryLowerColumn = columns.includes('category_lower');

      return {
        nameLower: this.hasNameLowerColumn,
        categoryLower: this.hasCategoryLowerColumn,
      };
    } catch (error) {
      // If check fails, assume columns don't exist
      this.hasNameLowerColumn = false;
      this.hasCategoryLowerColumn = false;
      return { nameLower: false, categoryLower: false };
    }
  }

  /**
   * Build optimized single query with window function for count
   */
  private async buildOptimizedSingleQuery(
    indexName: string,
    searchTerm: string,
    size: number,
    from: number,
    filter?: any,
  ): Promise<{ sql: string; params: any[] }> {
    const normalizedTerm = this.normalizeSearchQuery(searchTerm);
    const lowercasedTerm = normalizedTerm.toLowerCase(); // For comparison with name_lower index
    const filterConditions = this.buildFilterConditions(filter);

    // Check if optimized columns exist
    const { nameLower, categoryLower } = await this.checkOptimizedColumnsExist();

    // Handle match_all queries
    if (normalizedTerm === '*' || normalizedTerm === '') {
      const sql = `
        SELECT
          document_id,
          content,
          metadata,
          1.0 as rank
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          ${filterConditions ? `AND ${filterConditions}` : ''}
        ORDER BY document_id
        LIMIT $2 OFFSET $3
      `;
      return { sql, params: [indexName, size, from] };
    }

    // Check if wildcard query (contains * or ?)
    const isWildcard = searchTerm.includes('*') || searchTerm.includes('?');

    if (isWildcard) {
      // WILDCARD SEARCH - Uses trigram indexes
      return this.buildWildcardQuery(indexName, searchTerm, size, from, filterConditions);
    }

    // STANDARD FULL-TEXT SEARCH - Optimized with indexed lowercase columns
    // Uses name_lower and category_lower indexes for fast prefix matching when available
    // Removed expensive ts_rank_cd calculation (tiered ranking handles scoring)

    let sql: string;

    if (nameLower) {
      // FAST PATH: Use indexed name_lower column directly
      sql = `
        SELECT
          document_id,
          content,
          metadata,
          -- Simplified ranking (tiered ranking service handles detailed scoring)
          CASE 
            WHEN name_lower = $1 THEN 1000.0
            WHEN name_lower LIKE $1 || '%' THEN 500.0
            ELSE 100.0
          END as rank
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            name_lower LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
          ${filterConditions ? `AND ${filterConditions}` : ''}
        ORDER BY rank DESC, name_lower
        LIMIT $3 OFFSET $4
      `;
    } else {
      // FALLBACK PATH: Use original query (before optimization) - no COALESCE overhead
      sql = `
        SELECT
          document_id,
          content,
          metadata,
          -- Simplified ranking (tiered ranking service handles detailed scoring)
          CASE 
            WHEN lower(COALESCE(content->>'name', content->>'business_name', '')) = $1 THEN 1000.0
            WHEN lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $1 || '%' THEN 500.0
            ELSE 100.0
          END as rank
        FROM documents
        WHERE index_name = $2
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            lower(COALESCE(content->>'name', content->>'business_name', '')) LIKE $1 || '%'
            OR weighted_search_vector @@ plainto_tsquery('english', $1)
          )
          ${filterConditions ? `AND ${filterConditions}` : ''}
        ORDER BY rank DESC, lower(COALESCE(content->>'name', content->>'business_name', ''))
        LIMIT $3 OFFSET $4
      `;
    }

    return {
      sql,
      params: [lowercasedTerm, indexName, size, from],
    };
  }

  /**
   * Build wildcard query - Uses trigram indexes for pattern matching
   * Optimized for queries like "fazsion*" or "accurate* predict*"
   */
  private buildWildcardQuery(
    indexName: string,
    pattern: string,
    size: number,
    from: number,
    filterConditions?: string,
  ): { sql: string; params: any[] } {
    // Clean wildcards for search
    const cleanTerm = pattern.replace(/[*?]/g, '');

    // 🚀 OPTIMIZED: Use trigram indexes for fast wildcard search
    // This query uses idx_documents_name_trgm and idx_documents_category_trgm
    const sql = `
      SELECT
        document_id,
        content,
        metadata,
        -- Ranking using trigram similarity (uses GIN index)
        GREATEST(
          word_similarity($1, name) * 1000,
          word_similarity($1, category) * 500
        ) as rank
      FROM documents
      WHERE index_name = $2
        -- Use materialized boolean columns (indexed)
        AND (is_active IS NULL OR is_active = true)
        AND (is_verified IS NULL OR is_verified = true)
        AND (is_blocked IS NULL OR is_blocked = false)
        -- Trigram index search (uses idx_documents_name_trgm, idx_documents_category_trgm)
        AND (
          name % $1  -- Trigram similarity operator (uses GIN index!)
          OR category % $1
        )
        ${filterConditions ? `AND ${filterConditions}` : ''}
      ORDER BY rank DESC
      LIMIT $3 OFFSET $4
    `;

    return {
      sql,
      params: [cleanTerm, indexName, size, from],
    };
  }

  /**
   * Build filter conditions from filter object
   */
  private buildFilterConditions(filter?: any): string {
    if (!filter) return '';

    // Handle bool filter
    if (filter.bool) {
      const conditions: string[] = [];

      if (filter.bool.must) {
        filter.bool.must.forEach((clause: any) => {
          const condition = this.buildTermCondition(clause);
          if (condition) conditions.push(condition);
        });
      }

      if (filter.bool.should) {
        const shouldConditions = filter.bool.should
          .map((clause: any) => {
            const condition = this.buildTermCondition(clause);
            return condition;
          })
          .filter(Boolean);

        if (shouldConditions.length > 0) {
          conditions.push(`(${shouldConditions.join(' OR ')})`);
        }
      }

      if (filter.bool.must_not) {
        filter.bool.must_not.forEach((clause: any) => {
          const condition = this.buildTermCondition(clause);
          if (condition) conditions.push(`NOT (${condition})`);
        });
      }

      return conditions.join(' AND ');
    }

    // Handle single term filter
    return this.buildTermCondition(filter);
  }

  /**
   * Build condition for a single term filter
   * Uses materialized columns when available for better performance
   */
  private buildTermCondition(termFilter: any): string {
    if (!termFilter || !termFilter.term) return '';

    const { field, value } = termFilter.term;
    if (!field || value === undefined) return '';

    // 🚀 OPTIMIZATION: Use materialized columns for common boolean filters
    // These have indexes and are MUCH faster than JSONB extraction
    const materializedBooleans = {
      is_active: 'is_active',
      is_verified: 'is_verified',
      is_blocked: 'is_blocked',
    };

    if (field in materializedBooleans && typeof value === 'boolean') {
      const col = materializedBooleans[field];
      return `(${col} IS NULL OR ${col} = ${value})`;
    }

    // Fields that should use LIKE matching for partial text search
    const likeFields = [
      'location_text',
      'description',
      'tags',
      'profile',
      'name',
      'title',
      'category_name',
      'sub_category_name',
    ];

    // Handle boolean values (fallback to JSONB)
    if (typeof value === 'boolean') {
      return `content->>'${field}' = '${value}'`;
    }

    // Handle string values
    if (typeof value === 'string') {
      if (likeFields.includes(field)) {
        // Use ILIKE for text fields to enable partial matching
        return `content->>'${field}' ILIKE '%${value}%'`;
      } else {
        // Use exact match for other string fields
        return `content->>'${field}' = '${value}'`;
      }
    }

    // Handle numeric values
    if (typeof value === 'number') {
      return `content->>'${field}' = '${value}'`;
    }

    return '';
  }

  /**
   * Simple query processing to replace QueryProcessorService
   */
  private processQuery(query: any): string {
    if (typeof query === 'string') {
      return query;
    }

    // Handle match query
    if (query.match) {
      return typeof query.match === 'string' ? query.match : query.match.query || '';
    }

    // Handle match_all query
    if (query.match_all) {
      return '*';
    }

    // Handle wildcard query
    if (query.wildcard) {
      const field = Object.keys(query.wildcard)[0];
      const value = query.wildcard[field];
      return typeof value === 'string' ? value : value.value || '';
    }

    // Handle term query
    if (query.term) {
      const field = Object.keys(query.term)[0];
      const value = query.term[field];
      return typeof value === 'string' ? value : value.value || '';
    }

    // Handle bool query (simplified)
    if (query.bool) {
      const terms: string[] = [];

      if (query.bool.must) {
        query.bool.must.forEach((clause: any) => {
          terms.push(this.processQuery(clause));
        });
      }

      if (query.bool.should) {
        query.bool.should.forEach((clause: any) => {
          terms.push(this.processQuery(clause));
        });
      }

      return terms.join(' ');
    }

    return '';
  }

  /**
   * Determine if a query is popular and should be cached longer
   */
  private isPopularQuery(searchQuery: SearchQueryDto): boolean {
    const queryStr =
      typeof searchQuery.query === 'string' ? searchQuery.query : JSON.stringify(searchQuery.query);

    // Cache common single word searches longer
    const popularTerms = ['hotel', 'restaurant', 'bank', 'school', 'hospital', 'shop', 'store'];
    const isSimpleQuery = typeof searchQuery.query === 'string' && !queryStr.includes('*');
    const isPopularTerm = popularTerms.some(term =>
      queryStr.toLowerCase().includes(term.toLowerCase()),
    );

    return isSimpleQuery && isPopularTerm && (searchQuery.size || 10) <= 20;
  }

  /**
   * Generate search vector from document content
   */
  private generateSearchVector(document: Record<string, any>): string {
    // Extract text content from document
    const textContent = this.extractTextContent(document);

    // Generate tsvector using PostgreSQL function
    return `to_tsvector('english', '${textContent.replace(/'/g, "''")}')`;
  }

  /**
   * Extract text content from document for search vector generation
   */
  private extractTextContent(document: Record<string, any>): string {
    const textParts: string[] = [];

    // Extract common text fields
    if (document.name) textParts.push(document.name);
    if (document.title) textParts.push(document.title);
    if (document.description) textParts.push(document.description);
    if (document.content) textParts.push(document.content);
    if (document.text) textParts.push(document.text);

    // Add all string values as fallback
    Object.values(document).forEach(value => {
      if (typeof value === 'string' && value.length > 0) {
        textParts.push(value);
      }
    });

    return textParts.join(' ');
  }

  /**
   * Extract search term from query - simplified for maximum performance
   */
  private extractSearchTerm(query: SearchQueryDto): string {
    // For simple string queries, just return the query
    if (typeof query.query === 'string') {
      return query.query;
    }

    // For object queries, try to extract the value quickly
    if (query.query && typeof query.query === 'object') {
      const queryObj = query.query as any;

      // Handle match query
      if (queryObj.match) {
        if (typeof queryObj.match === 'string') {
          return queryObj.match;
        }
        if (queryObj.match.value !== undefined) {
          return queryObj.match.value;
        }
        if (queryObj.match.query !== undefined) {
          return queryObj.match.query;
        }
        return '';
      }

      // Handle match_all query
      if (queryObj.match_all !== undefined) {
        return '*';
      }

      // Handle wildcard query
      if (queryObj.wildcard) {
        if (typeof queryObj.wildcard === 'string') {
          return queryObj.wildcard;
        }
        if (queryObj.wildcard.value !== undefined) {
          return queryObj.wildcard.value;
        }
        // Handle field-specific wildcard format: { "title": { "value": "smart*" } }
        const entries = Object.entries(queryObj.wildcard);
        if (entries.length > 0) {
          const [field, config] = entries[0];
          if (typeof config === 'string') {
            return config;
          }
          if (typeof config === 'object' && config && 'value' in config) {
            return (config as any).value;
          }
        }
        return '';
      }

      // Handle term query
      if (queryObj.term) {
        if (typeof queryObj.term === 'string') {
          return queryObj.term;
        }
        if (queryObj.term.value !== undefined) {
          return queryObj.term.value;
        }
        // Handle field-specific term format: { "title": "value" }
        const entries = Object.entries(queryObj.term);
        if (entries.length > 0) {
          const [field, value] = entries[0];
          return typeof value === 'string' ? value : '';
        }
        return '';
      }
    }

    return '';
  }

  /**
   * Normalize search query by stripping wildcard characters for maximum efficiency
   */
  private normalizeSearchQuery(searchTerm: string): string {
    if (!searchTerm) return '';

    // Remove extra whitespace but PRESERVE wildcards (* and ?)
    // We need wildcards for routing to wildcard query handler
    const normalized = searchTerm.trim().replace(/\s+/g, ' ');

    // Handle empty or wildcard-only queries
    if (normalized === '' || normalized === '*') {
      return '*';
    }

    return normalized;
  }

  /**
   * Determine if query should use simple text search or full-text search
   */
  private shouldUseSimpleTextSearch(searchTerm: string): boolean {
    if (!searchTerm || searchTerm === '*' || searchTerm === '') return false;

    // Use simple text search for:
    // 1. Single words (no spaces)
    // 2. Short multi-word queries (2-3 words) - faster than full-text search
    // 3. No special characters (except basic punctuation)
    // 4. Short queries (less than 50 characters)

    const hasMultipleWords = searchTerm.includes(' ');
    const hasSpecialChars = /[^\w\s\-\.]/.test(searchTerm);
    const isShortQuery = searchTerm.length < 50;
    const wordCount = searchTerm.split(/\s+/).length;

    // Use simple text search for single words OR short multi-word queries (2-3 words)
    return (!hasMultipleWords || wordCount <= 3) && !hasSpecialChars && isShortQuery;
  }
}
