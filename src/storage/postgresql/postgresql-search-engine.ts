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
  async search(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<{ data: any; metrics: SearchMetrics }> {
    const startTime = Date.now();
    console.log(`[PROFILE] PostgreSQL search started`);

    const metrics: SearchMetrics = {
      queryParsing: 0,
      execution: 0,
      highlighting: 0,
      faceting: 0,
      total: 0,
      planStats: null,
    };

    try {
      // Check Redis cache first (primary cache)
      const cacheStart = Date.now();
      const cacheKey = this.redisCache.generateKey(indexName, searchQuery);
      const cachedResult = await this.redisCache.get(cacheKey);
      console.log(`[PROFILE] Redis cache check took: ${Date.now() - cacheStart}ms`);

      if (cachedResult) {
        metrics.execution = Date.now() - startTime;
        metrics.total = metrics.execution;
        console.log(`[PROFILE] Redis cache hit, returning in: ${metrics.execution}ms`);
        return { data: cachedResult, metrics };
      }

      // Fallback to in-memory cache
      const memoryCacheStart = Date.now();
      const memoryCacheKey = this.optimizedCache.generateKey(indexName, searchQuery);
      const memoryCachedResult = this.optimizedCache.get(memoryCacheKey);
      console.log(`[PROFILE] Memory cache check took: ${Date.now() - memoryCacheStart}ms`);

      if (memoryCachedResult) {
        metrics.execution = Date.now() - startTime;
        metrics.total = metrics.execution;
        console.log(`[PROFILE] Memory cache hit, returning in: ${metrics.execution}ms`);
        return { data: memoryCachedResult, metrics };
      }

      // Execute standard search
      const searchStart = Date.now();
      const searchResult = await this.executeStandardSearch(indexName, searchQuery);
      console.log(`[PROFILE] Execute standard search took: ${Date.now() - searchStart}ms`);

      // Cache results in both Redis and memory
      const cacheSetStart = Date.now();
      const isPopularQuery = this.isPopularQuery(searchQuery);
      const ttl = isPopularQuery ? 600 : 60; // 10 minutes for popular, 1 minute for others

      // Cache in Redis (primary)
      await this.redisCache.set(cacheKey, searchResult.data, ttl);

      // Cache in memory (fallback)
      this.optimizedCache.set(memoryCacheKey, searchResult.data);

      console.log(
        `[PROFILE] Cache set took: ${
          Date.now() - cacheSetStart
        }ms (Redis TTL: ${ttl}s, Popular: ${isPopularQuery})`,
      );

      metrics.execution = Date.now() - startTime;
      metrics.total = metrics.execution;

      this.logger.log(
        `Search completed for index '${indexName}': Found ${searchResult.data.total} results in ${metrics.execution}ms`,
      );

      return { data: searchResult.data, metrics };
    } catch (error) {
      this.logger.error(`Search failed for index '${indexName}': ${error.message}`);
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

  private buildCountQuery(indexName: string, searchTerm: string, filter?: any): string {
    // Normalize search term by stripping wildcard characters for maximum efficiency
    const normalizedTerm = this.normalizeSearchQuery(searchTerm);

    // Handle match_all queries
    if (normalizedTerm === '*' || normalizedTerm === '') {
      return `
        SELECT COUNT(*) as total
        FROM documents
        WHERE index_name = $1
      `;
    }

    // Use optimized full-text search for basic queries (much faster than ILIKE)
    if (this.shouldUseSimpleTextSearch(normalizedTerm)) {
      return `
        SELECT COUNT(*) as total
        FROM documents
        WHERE index_name = $1
          AND search_vector IS NOT NULL
          AND search_vector @@ plainto_tsquery('english', $2)
      `;
    }

    // Use full-text search for complex queries (multiple words, special characters)
    return `
      SELECT COUNT(*) as total
      FROM documents
      WHERE index_name = $1
        AND search_vector IS NOT NULL
        AND COALESCE(materialized_vector, search_vector) @@ plainto_tsquery('english', $2)
    `;
  }

  private async executeStandardSearch(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<any> {
    const startTime = Date.now();
    console.log(`[PROFILE] executeStandardSearch started`);

    const extractStart = Date.now();
    const searchTerm = this.extractSearchTerm(searchQuery);
    console.log(
      `[PROFILE] Extract search term took: ${Date.now() - extractStart}ms, term: ${searchTerm}`,
    );

    const size = Math.min(searchQuery.size || 10, 100); // Cap at 100
    const from = searchQuery.from || 0;

    try {
      // Build optimized query with parallel execution hints
      const buildQueryStart = Date.now();
      const mainQuery = this.buildOptimizedSearchQuery(
        indexName,
        searchTerm,
        size,
        from,
        searchQuery.filter,
      );
      console.log(`[PROFILE] Build main query took: ${Date.now() - buildQueryStart}ms`);

      // Build count query
      const buildCountStart = Date.now();
      const countQuery = this.buildCountQuery(indexName, searchTerm, searchQuery.filter);
      console.log(`[PROFILE] Build count query took: ${Date.now() - buildCountStart}ms`);

      // Build parameters array based on query type
      const paramStart = Date.now();
      let params: any[];
      let countParams: any[];

      if (searchTerm === '*' || searchTerm === '') {
        // Match_all query - only needs index, size, from
        params = [indexName, size, from];
        countParams = [indexName];
      } else if (searchTerm.includes('*') || searchTerm.includes('?')) {
        // Wildcard query - needs pattern, index, size, from
        const pattern = searchTerm.replace(/\*/g, '%').replace(/\?/g, '_');
        params = [pattern, indexName, size, from];
        countParams = [indexName, pattern];
      } else {
        // Regular text query - needs search term, index, size, from
        params = [searchTerm, indexName, size, from];
        countParams = [indexName, searchTerm];
      }
      console.log(`[PROFILE] Build parameters took: ${Date.now() - paramStart}ms`);

      // Execute queries in parallel
      const queryStart = Date.now();
      const [results, countResult] = await Promise.all([
        this.dataSource.query(mainQuery, params),
        this.dataSource.query(countQuery, countParams),
      ]);
      console.log(`[PROFILE] Execute parallel queries took: ${Date.now() - queryStart}ms`);

      const processStart = Date.now();
      const total = parseInt(countResult[0]?.total || '0');

      const responseData = {
        data: {
          hits: results.map((row: any) => ({
            id: row.document_id,
            index: indexName,
            score: row.rank,
            source: row.content,
          })),
          total: total.toString(),
          maxScore: results.length > 0 ? Math.max(...results.map((r: any) => r.rank)) : 0,
        },
        pagination: {
          currentPage: Math.floor(from / size) + 1,
          totalPages: Math.ceil(total / size),
          pageSize: size,
          hasNext: from + size < total,
          hasPrevious: from > 0,
          totalResults: total.toString(),
        },
        took: Date.now() - Date.now(), // Will be calculated by caller
      };
      console.log(`[PROFILE] Process results took: ${Date.now() - processStart}ms`);
      console.log(`[PROFILE] executeStandardSearch total: ${Date.now() - startTime}ms`);

      return responseData;
    } catch (error) {
      if (error.message.includes('statement_timeout')) {
        throw new Error('Search query timed out. Please try a more specific search term.');
      }
      throw error;
    }
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
   * This converts all queries to simple text search while maintaining functionality
   */
  private normalizeSearchQuery(searchTerm: string): string {
    if (!searchTerm) return '';

    // Strip all wildcard characters (* and ?) and trim
    const normalized = searchTerm.replace(/[\*\?]/g, '').trim();

    // If we end up with empty string, return original
    return normalized || searchTerm;
  }

  /**
   * Determine if query should use simple text search or full-text search
   * Simple text search is much faster for single words and basic queries
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

  /**
   * Extract search term from parsed query object
   */
  private extractTermFromParsedQuery(query: any): string {
    if (typeof query === 'string') {
      return query;
    }

    // Handle match query
    if (query.type === 'term') {
      return query.value || '';
    }

    // Handle wildcard query
    if (query.type === 'wildcard') {
      return query.value || query.pattern || '';
    }

    // Handle match_all query
    if (query.type === 'match_all') {
      return '*';
    }

    // Handle boolean query
    if (query.type === 'boolean' && query.clauses) {
      return query.clauses.map((clause: any) => this.extractTermFromParsedQuery(clause)).join(' ');
    }

    // Handle phrase query
    if (query.type === 'phrase' && query.terms) {
      return query.terms.join(' ');
    }

    return '';
  }

  /**
   * Build optimized search query for single table architecture
   */
  private buildOptimizedSearchQuery(
    indexName: string,
    searchTerm: string,
    size: number,
    from: number,
    filter?: any,
  ): string {
    // Normalize search term by stripping wildcard characters for maximum efficiency
    const normalizedTerm = this.normalizeSearchQuery(searchTerm);

    // Handle match_all queries (when searchTerm is '*' or empty)
    if (normalizedTerm === '*' || normalizedTerm === '') {
      return `
        SELECT
          document_id,
          content,
          metadata,
          field_weights,
          1.0 as rank
        FROM documents
        WHERE index_name = $1
          ${filter ? `AND ${filter}` : ''}
        ORDER BY document_id
        LIMIT $2 OFFSET $3
      `;
    }

    // Use optimized full-text search for basic queries (much faster than ILIKE)
    if (this.shouldUseSimpleTextSearch(normalizedTerm)) {
      return `
        SELECT
          document_id,
          content,
          metadata,
          field_weights,
          1.0 as rank
        FROM documents
        WHERE index_name = $2
          AND search_vector IS NOT NULL
          AND search_vector @@ plainto_tsquery('english', $1)
          ${filter ? `AND ${filter}` : ''}
        ORDER BY document_id
        LIMIT $3 OFFSET $4
      `;
    }

    // Use full-text search for complex queries (multiple words, special characters)
    return `
      SELECT
        document_id,
        content,
        metadata,
        field_weights,
        ts_rank_cd(COALESCE(materialized_vector, search_vector), plainto_tsquery('english', $1)) as rank
      FROM documents
      WHERE index_name = $2
        AND search_vector IS NOT NULL
        AND COALESCE(materialized_vector, search_vector) @@ plainto_tsquery('english', $1)
        ${filter ? `AND ${filter}` : ''}
      ORDER BY rank DESC, document_id
      LIMIT $3 OFFSET $4
    `;
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
}
