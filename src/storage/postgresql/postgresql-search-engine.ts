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
import { SearchDocument } from './entities/search-document.entity';
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
import { DynamicIndexManagerService } from './dynamic-index-manager.service';
import { PostgreSQLQueryBuilderService } from './query-builder.service';
import { PostgreSQLResultProcessorService } from './result-processor.service';
import { PostgreSQLPerformanceMonitorService } from './performance-monitor.service';
import { TypoToleranceService } from '../../search/typo-tolerance.service';
import { OptimizedQueryCacheService, CacheStats } from './optimized-query-cache.service';
import { QueryBuilderFactory } from './query-builders/query-builder-factory';
import { BM25RankingService } from './bm25-ranking.service';
import { FilterBuilderService } from './filter-builder.service';
import { AdaptiveQueryOptimizerService } from './adaptive-query-optimizer.service';
import { SearchConfigurationService } from './search-configuration.service';
import { SearchMetricsService } from './search-metrics.service';

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
    private readonly documentProcessor: PostgreSQLDocumentProcessor,
    private readonly analysisAdapter: PostgreSQLAnalysisAdapter,
    private readonly queryProcessor: QueryProcessorService,
    private readonly indexStats: PostgreSQLIndexStats,
    private readonly dynamicIndexManager: DynamicIndexManagerService,
    private readonly queryBuilder: PostgreSQLQueryBuilderService,
    private readonly resultProcessor: PostgreSQLResultProcessorService,
    private readonly performanceMonitor: PostgreSQLPerformanceMonitorService,
    private readonly typoToleranceService: TypoToleranceService,
    private readonly optimizedCache: OptimizedQueryCacheService,
    private readonly queryBuilderFactory: QueryBuilderFactory,
    private readonly bm25RankingService: BM25RankingService,
    private readonly filterBuilderService: FilterBuilderService,
    private readonly adaptiveQueryOptimizer: AdaptiveQueryOptimizerService,
    private readonly searchConfig: SearchConfigurationService,
    private readonly searchMetrics: SearchMetricsService,
  ) {}

  async onModuleInit() {
    await this.loadIndicesFromDatabase();
    // Initialize dynamic trigram indexes for optimal ILIKE performance
    await this.dynamicIndexManager.initializeOptimalIndexes();
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
    const metrics: SearchMetrics = {
      queryParsing: 0,
      execution: 0,
      highlighting: 0,
      faceting: 0,
      total: 0,
      planStats: null,
    };

    try {
      // Phase 4.3: Apply adaptive query optimization (async, non-blocking)
      let optimizedQuery = searchQuery;
      const patternKey = `${indexName}:${JSON.stringify(searchQuery.query)}`;
      const cachedOptimization = this.adaptiveQueryOptimizer['optimizationCache']?.get(patternKey);

      if (cachedOptimization) {
        // Use cached optimization (fast path)
        optimizedQuery = cachedOptimization;
      } else {
        // Trigger async optimization for future requests (non-blocking)
        this.adaptiveQueryOptimizer
          .optimizeQuery(indexName, searchQuery, { totalDocuments: this.indexStats.totalDocuments })
          .catch(error => {
            this.logger.debug(`Async optimization failed: ${error.message}`);
          });
      }

      // Check optimized cache first
      const cacheKey = this.optimizedCache.generateKey(indexName, optimizedQuery);
      const cachedResult = this.optimizedCache.get(cacheKey);

      if (cachedResult) {
        metrics.execution = Date.now() - startTime;
        metrics.total = metrics.execution;

        // Phase 5: Record cache hit metrics (ultra-lightweight, async)
        setImmediate(() => {
          this.searchMetrics.recordQuery(indexName, 'cache_hit', metrics.execution, true);
        });

        return { data: cachedResult, metrics };
      }

      // Convert search query to tsquery for PostgreSQL full-text search
      let tsquery = '';
      if (typeof searchQuery.query === 'string') {
        tsquery = searchQuery.query;
      } else if (searchQuery.query?.match?.value) {
        tsquery = String(searchQuery.query.match.value);
      } else if (searchQuery.query?.wildcard?.value) {
        const wildcardValue = searchQuery.query.wildcard.value;
        tsquery = typeof wildcardValue === 'string' ? wildcardValue : String(wildcardValue.value);
      }

      // URGENT: Revert to optimized legacy search until decomposed issues are fixed
      this.logger.debug(
        `[DEBUG] Executing search: index=${indexName}, tsquery="${tsquery}", hasFilter=${!!searchQuery.filter}`,
      );
      const searchResult = await this.executeSearch(indexName, tsquery, searchQuery);
      this.logger.debug(
        `[DEBUG] Search result: totalHits=${searchResult.totalHits}, hits=${searchResult.hits.length}`,
      );

      const response = {
        hits: searchResult.hits.map(hit => ({
          id: hit.id,
          score: hit.score,
          source: hit.document,
        })),
        total: searchResult.totalHits,
        maxScore: searchResult.maxScore,
      };

      // Cache the result using optimized cache
      this.optimizedCache.set(cacheKey, response);

      metrics.execution = Date.now() - startTime;
      metrics.total = metrics.execution;

      // Phase 4.3: Record query execution for learning (async, non-blocking)
      setImmediate(() => {
        this.adaptiveQueryOptimizer.recordQueryExecution(
          indexName,
          searchQuery, // Use original query for pattern learning
          metrics.execution,
          response.total,
          true, // success
        );

        // Phase 5: Record search metrics (ultra-lightweight)
        const queryType =
          typeof searchQuery.query === 'string'
            ? 'string'
            : Object.keys(searchQuery.query || {})[0] || 'unknown';
        this.searchMetrics.recordQuery(indexName, queryType, metrics.execution, false);
      });

      return { data: response, metrics };
    } catch (error) {
      this.logger.error('Search error:', error);
      throw new BadRequestException(`Search error: ${error.message}`);
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

      // If still no results, use fuzzy matching with TypoToleranceService
      if (results.length === 0) {
        try {
          // Get field terms from database for typo tolerance
          // Extract individual words from the field values for better fuzzy matching
          // Order by frequency to get most common words first
          const fieldTermsQuery = `
            WITH words AS (
              SELECT unnest(string_to_array(lower(d.content->>'${field}'), ' ')) as term
              FROM documents d
              WHERE d.index_name = $1 
                AND d.content->>'${field}' IS NOT NULL
                AND LENGTH(d.content->>'${field}') > 1
            ),
            word_counts AS (
              SELECT term, COUNT(*) as frequency
              FROM words
              WHERE LENGTH(term) > 2
                AND term ~ '^[a-zA-Z]+$'  -- Only alphabetic words
              GROUP BY term
            )
            SELECT term
            FROM word_counts
            ORDER BY frequency DESC
            LIMIT 1000`;

          const fieldTermsResult = await this.dataSource.query(fieldTermsQuery, [indexName]);
          const fieldTerms = fieldTermsResult.map(row => `${field}:${row.term}`);

          // Get fuzzy suggestions using TypoToleranceService
          const fuzzySuggestions = await this.typoToleranceService.getSuggestions(
            fieldTerms,
            text,
            size,
          );

          // Convert fuzzy suggestions to expected format
          results = fuzzySuggestions.map((suggestion, index) => ({
            suggestion: suggestion.text,
            id: `fuzzy_${index}`,
            category: 'Suggested spelling',
          }));

          this.logger.debug(`Found ${results.length} fuzzy suggestions for "${text}"`);
        } catch (fuzzyError) {
          this.logger.warn(`Fuzzy matching failed: ${fuzzyError.message}`);
        }
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
   * Add a single document to PostgreSQL index
   */
  async addDocument(
    indexName: string,
    documentId: string,
    document: Record<string, any>,
  ): Promise<void> {
    this.logger.debug(`Adding document ${documentId} to PostgreSQL index ${indexName}`);

    try {
      await this.validateIndexExists(indexName);

      // Process document for PostgreSQL
      const processed = await this.documentProcessor.processForPostgreSQL(
        { id: documentId, source: document },
        { indexName, indexConfig: this.indices.get(indexName) },
      );

      // Create entity for database storage
      const entity = this.documentProcessor.createSearchDocumentEntity(processed, { indexName });

      // Insert or update document
      await this.dataSource.query(
        `INSERT INTO search_documents (index_name, doc_id, content, search_vector, field_lengths, boost_factor)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (index_name, doc_id) 
         DO UPDATE SET 
           content = $3, 
           search_vector = $4, 
           field_lengths = $5, 
           boost_factor = $6, 
           updated_at = NOW()`,
        [
          entity.indexName,
          entity.docId,
          JSON.stringify(entity.content),
          entity.searchVector,
          JSON.stringify(entity.fieldLengths),
          entity.boostFactor,
        ],
      );

      this.logger.debug(`Document ${documentId} added successfully`);
    } catch (error) {
      this.logger.error(`Failed to add document ${documentId}: ${error.message}`);
      throw error;
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
   * Execute PostgreSQL search using decomposed architecture
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

    this.logger.debug(`[executeSearch] Starting search for "${tsquery}" in index "${indexName}"`);

    // Phase 3 Decomposition: Use QueryBuilder service for search analysis
    const queryInfo = this.queryBuilder.analyzeSearchTerm(searchQuery.query, tsquery);
    const candidateLimit = Math.min(size * 10, 200);

    this.logger.debug(
      `[executeSearch] Query info: searchTerm="${queryInfo.searchTerm}", candidateLimit=${candidateLimit}`,
    );

    // Phase 3 Decomposition: Use PerformanceMonitor for instrumented execution
    try {
      // Step 1: Try main PostgreSQL full-text search
      const mainQuery = this.queryBuilder.buildMainQuery(
        indexName,
        queryInfo.searchTerm,
        candidateLimit,
      );
      const { result: mainResult, metrics: mainMetrics } =
        await this.performanceMonitor.executeWithMonitoring(
          mainQuery.sql,
          mainQuery.params,
          'main_search',
          queryInfo.searchTerm,
          indexName,
        );

      this.logger.debug(
        `[executeSearch] Main query results: ${mainResult.length} candidates found`,
      );

      // Check if we need alternative strategies
      const strategy = this.queryBuilder.getQueryStrategy(queryInfo, mainResult.length > 0);

      this.logger.debug(`[executeSearch] Query strategy selected: ${strategy}`);

      if (strategy === 'main') {
        // Process main results with BM25 ranking
        return await this.resultProcessor.processSearchResults(
          mainResult,
          queryInfo.searchTerm,
          from,
          size,
        );
      }

      // Step 2: Try prefix search for simple trailing wildcards
      if (strategy === 'prefix' && queryInfo.prefixTerm) {
        const prefixQuery = this.queryBuilder.buildPrefixQuery(
          indexName,
          queryInfo.prefixTerm,
          candidateLimit,
        );
        const { result: prefixResult } = await this.performanceMonitor.executeWithMonitoring(
          prefixQuery.sql,
          prefixQuery.params,
          'prefix_search',
          queryInfo.prefixTerm,
          indexName,
        );

        if (prefixResult.length > 0) {
          return await this.resultProcessor.processSearchResults(
            prefixResult,
            queryInfo.searchTerm,
            from,
            size,
          );
        }
      }

      // Step 3: Fallback to ILIKE search for complex patterns
      if (strategy === 'fallback') {
        const fallbackQuery = this.queryBuilder.buildFallbackQuery(
          indexName,
          queryInfo.searchTerm,
          searchQuery,
          candidateLimit,
          from,
        );
        const { result: fallbackResult } = await this.performanceMonitor.executeWithMonitoring(
          fallbackQuery.sql,
          fallbackQuery.params,
          'fallback_search',
          queryInfo.searchTerm,
          indexName,
        );

        if (fallbackResult.length > 0) {
          return await this.resultProcessor.processFallbackResults(
            fallbackResult,
            queryInfo.searchTerm,
            size,
          );
        }
      }

      // No results found
      return this.resultProcessor.createEmptyResult();
    } catch (error) {
      this.logger.error(`Search execution failed: ${error.message}`);
      return this.resultProcessor.createEmptyResult();
    }
  }

  /**
   * Phase 3 Decomposition: Streamlined BM25 re-ranking using BM25RankingService
   */
  private async bm25Reranking(
    candidates: any[],
    searchTerm: string,
    indexName: string,
  ): Promise<Array<{ id: string; score: number; document: Record<string, any> }>> {
    // Phase 5: Use dynamic configuration instead of hardcoded values
    return await this.bm25RankingService.rankDocuments(
      candidates,
      searchTerm,
      this.indexStats,
      {}, // Empty options - will use dynamic config from SearchConfigurationService
      indexName,
    );
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
   * Process a batch of documents
   */
  private async processBatch(
    indexName: string,
    documents: Array<{ id: string; document: Record<string, any> }>,
  ): Promise<void> {
    for (const doc of documents) {
      await this.addDocument(indexName, doc.id, doc.document);
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
   * Get optimization recommendations for an index
   */
  getOptimizationRecommendations(indexName: string) {
    return this.adaptiveQueryOptimizer.getOptimizationRecommendations(indexName);
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

    this.logger.debug(`Decomposed Search SQL: ${sql}`);
    this.logger.debug(`Decomposed Search Params: ${JSON.stringify(params)}`);

    // Execute with performance monitoring
    const { result: rows } = await this.performanceMonitor.executeWithMonitoring(
      sql,
      params,
      'decomposed_search',
      JSON.stringify(searchQuery.query),
      indexName,
    );

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
   * Phase 3 Decomposition: Streamlined buildSearchQuery using QueryBuilderFactory
   */
  private async buildSearchQuery(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<{ sql: string; params: any[] }> {
    const { query, size = 10, from = 0 } = searchQuery;
    const params: any[] = [indexName];
    let paramIndex = 2;

    // Use QueryBuilderFactory to get appropriate builder
    const queryBuilder = this.queryBuilderFactory.create(query);
    const queryResult = queryBuilder.build(
      indexName,
      query,
      params,
      paramIndex,
      searchQuery.fields,
    );

    // Base query structure with builder result and total count
    let sql = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        COUNT(*) OVER() as total_count,
        ${queryResult.sql}`;

    // Add filters using FilterBuilderService
    if (searchQuery.filter) {
      const filterResult = this.filterBuilderService.buildConditions(
        searchQuery.filter,
        queryResult.params,
        queryResult.nextParamIndex,
      );
      sql += filterResult.sql;
      paramIndex = filterResult.nextParamIndex;
    } else {
      paramIndex = queryResult.nextParamIndex;
    }

    // Add pagination parameters
    queryResult.params.push(size);
    queryResult.params.push(from);

    // Add ORDER BY, LIMIT, and OFFSET
    sql += `
      ORDER BY score DESC, document_id
      LIMIT $${queryResult.params.length - 1} OFFSET $${queryResult.params.length}`;

    this.logger.debug(`Phase 3 Decomposed SQL: ${sql}`);
    this.logger.debug(`Phase 3 Decomposed params: ${JSON.stringify(queryResult.params)}`);

    return { sql: sql, params: queryResult.params };
  }

  private buildFilterConditions(filter: any, params: any[], startIndex: number): string {
    let sql = '';
    let paramIndex = startIndex;

    // Handle bool filters with must/should/must_not clauses
    if (filter.bool) {
      const boolClauses: string[] = [];

      // Process MUST clauses (AND conditions)
      if (filter.bool.must && Array.isArray(filter.bool.must)) {
        for (const mustClause of filter.bool.must) {
          const clauseSql = this.buildSingleFilterClause(mustClause, params, paramIndex);
          if (clauseSql) {
            boolClauses.push(clauseSql.sql);
            paramIndex = clauseSql.nextParamIndex;
          }
        }
      }

      // Process SHOULD clauses (OR conditions)
      if (filter.bool.should && Array.isArray(filter.bool.should)) {
        const shouldClauses: string[] = [];
        for (const shouldClause of filter.bool.should) {
          const clauseSql = this.buildSingleFilterClause(shouldClause, params, paramIndex);
          if (clauseSql) {
            shouldClauses.push(clauseSql.sql);
            paramIndex = clauseSql.nextParamIndex;
          }
        }
        if (shouldClauses.length > 0) {
          boolClauses.push(`(${shouldClauses.join(' OR ')})`);
        }
      }

      // Process MUST_NOT clauses (NOT conditions)
      if (filter.bool.must_not && Array.isArray(filter.bool.must_not)) {
        for (const mustNotClause of filter.bool.must_not) {
          const clauseSql = this.buildSingleFilterClause(mustNotClause, params, paramIndex);
          if (clauseSql) {
            boolClauses.push(`NOT (${clauseSql.sql})`);
            paramIndex = clauseSql.nextParamIndex;
          }
        }
      }

      // Combine all bool clauses with AND
      if (boolClauses.length > 0) {
        sql += ` AND (${boolClauses.join(' AND ')})`;
      }
    }

    // Handle simple term filters (backward compatibility)
    if (filter.term) {
      const clauseSql = this.buildSingleFilterClause({ term: filter.term }, params, paramIndex);
      if (clauseSql) {
        sql += ` AND ${clauseSql.sql}`;
        paramIndex = clauseSql.nextParamIndex;
      }
    }

    // Handle range filters
    if (filter.range) {
      Object.entries(filter.range).forEach(([field, conditions]) => {
        Object.entries(conditions as any).forEach(([op, value]) => {
          const operator = this.getRangeOperator(op);
          const fieldSql = this.getFieldReference(field);

          if (typeof value === 'number') {
            sql += ` AND (${fieldSql})::numeric ${operator} $${paramIndex}::numeric`;
          } else {
            sql += ` AND ${fieldSql} ${operator} $${paramIndex}`;
          }
          params.push(value);
          paramIndex++;
        });
      });
    }

    return sql;
  }

  /**
   * Build a single filter clause (term, range, etc.)
   */
  private buildSingleFilterClause(
    clause: any,
    params: any[],
    paramIndex: number,
  ): { sql: string; nextParamIndex: number } | null {
    if (clause.term) {
      return this.buildTermClause(clause.term, params, paramIndex);
    }
    if (clause.range) {
      return this.buildRangeClause(clause.range, params, paramIndex);
    }
    if (clause.match) {
      return this.buildMatchClause(clause.match, params, paramIndex);
    }
    return null;
  }

  /**
   * Build a term clause
   */
  private buildTermClause(
    term: any,
    params: any[],
    paramIndex: number,
  ): { sql: string; nextParamIndex: number } {
    let sql = '';
    let nextParamIndex = paramIndex;

    // Handle nested term structure: { field: 'fieldName', value: 'fieldValue' }
    if (term.field && term.value !== undefined) {
      const field = term.field;
      const value = term.value;
      const fieldSql = this.getFieldReference(field);

      if (Array.isArray(value)) {
        sql = `${fieldSql} = ANY($${paramIndex}::text[])`;
        params.push(value);
      } else {
        sql = `${fieldSql} = $${paramIndex}::text`;
        params.push(String(value));
      }
      nextParamIndex = paramIndex + 1;
    } else {
      // Handle flat structure: { fieldName: 'fieldValue' }
      const [field, value] = Object.entries(term)[0];
      const fieldSql = this.getFieldReference(field);

      if (Array.isArray(value)) {
        sql = `${fieldSql} = ANY($${paramIndex}::text[])`;
        params.push(value);
      } else {
        sql = `${fieldSql} = $${paramIndex}::text`;
        params.push(String(value));
      }
      nextParamIndex = paramIndex + 1;
    }

    return { sql, nextParamIndex };
  }

  /**
   * Build a range clause
   */
  private buildRangeClause(
    range: any,
    params: any[],
    paramIndex: number,
  ): { sql: string; nextParamIndex: number } {
    const clauses: string[] = [];
    let nextParamIndex = paramIndex;

    Object.entries(range).forEach(([field, conditions]) => {
      Object.entries(conditions as any).forEach(([op, value]) => {
        const operator = this.getRangeOperator(op);
        const fieldSql = this.getFieldReference(field);

        if (typeof value === 'number') {
          clauses.push(`(${fieldSql})::numeric ${operator} $${nextParamIndex}::numeric`);
        } else {
          clauses.push(`${fieldSql} ${operator} $${nextParamIndex}`);
        }
        params.push(value);
        nextParamIndex++;
      });
    });

    return { sql: clauses.join(' AND '), nextParamIndex };
  }

  /**
   * Build a match clause
   */
  private buildMatchClause(
    match: any,
    params: any[],
    paramIndex: number,
  ): { sql: string; nextParamIndex: number } {
    const field = match.field || 'content';
    const value = match.value;
    const fieldSql = this.getFieldReference(field);

    const sql = `${fieldSql} ILIKE '%' || $${paramIndex} || '%'`;
    params.push(value);

    return { sql, nextParamIndex: paramIndex + 1 };
  }

  /**
   * Determine whether a field should be referenced from content or metadata
   */
  private getFieldReference(field: string): string {
    // Fields that are typically stored in content (document data)
    const contentFields = [
      'name',
      'title',
      'description',
      'category_name',
      'sub_category_name',
      'is_active',
      'is_verified',
      'is_blocked',
      'is_featured',
      'price',
      'id_number',
      'slug',
      'tags',
      'business_name',
      'property_end_date',
      'property_start_date',
      'property_discounted_price',
    ];

    // Fields that are typically stored in metadata (system/processing data)
    const metadataFields = [
      'index_name',
      'document_id',
      'created_at',
      'updated_at',
      'processing_status',
      'index_version',
      'search_vector',
    ];

    if (contentFields.includes(field)) {
      return `d.content->>'${field}'`;
    } else if (metadataFields.includes(field)) {
      return `d.metadata->>'${field}'`;
    } else {
      // Default to content for unknown fields
      return `d.content->>'${field}'`;
    }
  }

  private isWildcardPattern(value: string): boolean {
    return value.includes('*') || value.includes('?');
  }

  private convertWildcardToLikePattern(
    pattern: string | { value: string; boost?: number },
  ): string {
    if (typeof pattern === 'string') {
      return pattern.replace(/\*/g, '%').replace(/\?/g, '_');
    }
    return pattern.value.replace(/\*/g, '%').replace(/\?/g, '_');
  }

  private buildWildcardCondition(field: string, pattern: string, paramIndex: number): string {
    const hasLeadingWildcard = pattern.startsWith('*');
    const baseScore = hasLeadingWildcard ? 0.5 : 1.0; // Penalize leading wildcards

    if (field === '_all') {
      return `
        WHEN d.content::text ILIKE $${paramIndex}
        THEN ${baseScore} * (1.0 / (1 + length($${paramIndex}) - length(replace($${paramIndex}, '%', ''))))
      `;
    }

    return `
      WHEN d.content->>'${field}' ILIKE $${paramIndex}
      THEN ${baseScore} * (1.0 / (1 + length($${paramIndex}) - length(replace($${paramIndex}, '%', ''))))
    `;
  }

  private getRangeOperator(op: string): string {
    switch (op) {
      case 'gt':
        return '>';
      case 'gte':
        return '>=';
      case 'lt':
        return '<';
      case 'lte':
        return '<=';
      default:
        return '=';
    }
  }

  /**
   * Get suggestions for a given search term using trigram similarity
   */
  async getSuggestions(
    indexName: string,
    text: string,
    field = '_all',
    size = 5,
  ): Promise<Array<{ text: string; score: number; freq: number }>> {
    try {
      // Enable pg_trgm extension if not already enabled
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

      let query: string;
      const params: any[] = [indexName, text, size];

      if (field === '_all') {
        // Search across all text fields
        query = `
          WITH distinct_values AS (
            SELECT DISTINCT
              jsonb_object_keys(content) as field,
              content->>jsonb_object_keys(content) as value
            FROM search_documents
            WHERE index_name = $1
              AND content->>jsonb_object_keys(content) IS NOT NULL
          ),
          similarities AS (
            SELECT 
              value as text,
              similarity(value, $2) as score,
              COUNT(*) as freq
            FROM distinct_values
            WHERE 
              similarity(value, $2) > 0.3
              AND value != $2
            GROUP BY value
            ORDER BY score DESC, freq DESC
            LIMIT $3
          )
          SELECT * FROM similarities
          WHERE score > 0
          ORDER BY score DESC, freq DESC
        `;
      } else {
        // Search in specific field
        query = `
          WITH distinct_values AS (
            SELECT DISTINCT
              content->>'${field}' as value,
              COUNT(*) as freq
            FROM search_documents
            WHERE 
              index_name = $1
              AND content->>'${field}' IS NOT NULL
            GROUP BY content->>'${field}'
          )
          SELECT 
            value as text,
            similarity(value, $2) as score,
            freq
          FROM distinct_values
          WHERE 
            similarity(value, $2) > 0.3
            AND value != $2
          ORDER BY score DESC, freq DESC
          LIMIT $3
        `;
      }

      const results = await this.dataSource.query(query, params);

      // Format and normalize scores
      return results.map((row: any) => ({
        text: row.text,
        score: parseFloat(row.score),
        freq: parseInt(row.freq, 10),
      }));
    } catch (error) {
      this.logger.error(`Suggestion error: ${error.message}`);
      throw new BadRequestException(`Suggestion error: ${error.message}`);
    }
  }

  /**
   * Get fuzzy matches for a term using trigram similarity
   */
  private async getFuzzyMatches(field: string, term: string, similarity = 0.3): Promise<string[]> {
    const query = `
      SELECT DISTINCT content->>'${field}' as value
      FROM search_documents
      WHERE 
        content->>'${field}' IS NOT NULL
        AND similarity(content->>'${field}', $1) > $2
      ORDER BY similarity(content->>'${field}', $1) DESC
      LIMIT 5
    `;

    const results = await this.dataSource.query(query, [term, similarity]);
    return results.map((row: any) => row.value);
  }

  /**
   * Enhance search results with fuzzy matching when exact matches are few
   */
  private async enhanceWithFuzzyMatches(
    indexName: string,
    field: string,
    term: string,
    exactMatches: number,
  ): Promise<string> {
    // If we have enough exact matches, don't do fuzzy matching
    if (exactMatches >= 5) {
      return term;
    }

    // Get fuzzy matches
    const fuzzyMatches = await this.getFuzzyMatches(field, term);

    // If we found fuzzy matches, include them in the search
    if (fuzzyMatches.length > 0) {
      return `(${term} | ${fuzzyMatches.join(' | ')})`;
    }

    return term;
  }

  /**
   * Get query execution plan analysis
   */
  private async analyzeQueryPlan(sql: string, params: any[]): Promise<any> {
    try {
      const plan = await this.dataSource.query(`EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`, params);
      return {
        plan: plan[0]['QUERY PLAN'][0],
        warnings: this.analyzeQueryPlanForWarnings(plan[0]['QUERY PLAN'][0]),
      };
    } catch (error) {
      this.logger.error(`Query plan analysis error: ${error.message}`);
      return null;
    }
  }

  /**
   * Analyze query plan for potential performance issues
   */
  private analyzeQueryPlanForWarnings(plan: any): string[] {
    const warnings: string[] = [];

    // Check for sequential scans on large tables
    if (plan.Plan['Node Type'] === 'Seq Scan' && plan['Plan Rows'] > 1000) {
      warnings.push('Sequential scan detected on large table - consider adding an index');
    }

    // Check for high cost operations
    if (plan['Total Cost'] > 1000) {
      warnings.push('High cost operation detected - query might need optimization');
    }

    // Check for large result sets
    if (plan['Plan Rows'] > 10000) {
      warnings.push('Large result set - consider adding LIMIT or additional filters');
    }

    return warnings;
  }

  /**
   * Get highlighted snippets for search results
   */
  private async getHighlights(
    hit: any,
    searchQuery: SearchQueryDto,
  ): Promise<Record<string, string[]>> {
    const highlights: Record<string, string[]> = {};
    const searchText =
      typeof searchQuery.query === 'string'
        ? searchQuery.query
        : searchQuery.query.match?.value || '';

    // Configure highlight options
    const options = "StartSel='<em>', StopSel='</em>', MaxWords=35, MinWords=15, ShortWord=3";

    // Get highlights for each text field
    for (const [field, value] of Object.entries(hit.source)) {
      if (typeof value === 'string') {
        const query = `
          SELECT ts_headline(
            'english',
            $1,
            plainto_tsquery('english', $2),
            $3
          ) as highlight
        `;

        const result = await this.dataSource.query(query, [value, searchText, options]);

        if (result?.[0]?.highlight) {
          highlights[field] = [result[0].highlight];
        }
      }
    }

    return highlights;
  }

  /**
   * Get facet aggregations for specified fields
   */
  private async getFacets(
    indexName: string,
    facetFields: string[],
  ): Promise<Record<string, Array<{ key: string; count: number }>>> {
    const facets: Record<string, Array<{ key: string; count: number }>> = {};

    for (const field of facetFields) {
      // Handle array fields differently
      const isArrayField = await this.isArrayField(indexName, field);

      const query = isArrayField
        ? `
          WITH array_values AS (
            SELECT jsonb_array_elements_text(content->'${field}') as value
            FROM search_documents
            WHERE index_name = $1
              AND content ? '${field}'
              AND jsonb_typeof(content->'${field}') = 'array'
          )
          SELECT 
            value as key,
            COUNT(*) as count
          FROM array_values
          GROUP BY value
          ORDER BY count DESC
          LIMIT 10
        `
        : `
          SELECT 
            content->>'${field}' as key,
            COUNT(*) as count
          FROM search_documents
          WHERE index_name = $1
            AND content ? '${field}'
          GROUP BY content->>'${field}'
          ORDER BY count DESC
          LIMIT 10
        `;

      const results = await this.dataSource.query(query, [indexName]);

      if (results?.length > 0) {
        facets[field] = results.map(row => ({
          key: row.key,
          count: parseInt(row.count, 10),
        }));
      }
    }

    return facets;
  }

  /**
   * Check if a field typically contains array values
   */
  private async isArrayField(indexName: string, field: string): Promise<boolean> {
    const query = `
      SELECT jsonb_typeof(content->'${field}') as type
      FROM search_documents
      WHERE index_name = $1
        AND content ? '${field}'
      LIMIT 1
    `;

    const result = await this.dataSource.query(query, [indexName]);
    return result?.[0]?.type === 'array';
  }

  /**
   * Handle array field operations with optimized performance
   */
  private async handleArrayFieldQuery(
    field: string,
    values: any[],
    operation: 'any' | 'all' | 'exact' = 'any',
  ): Promise<{ sql: string; params: any[] }> {
    // Validate array values
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException(`Invalid array values for field ${field}`);
    }

    let sql: string;
    const params = values;

    switch (operation) {
      case 'any':
        // Match if any array element matches any of the values
        sql = `
          jsonb_exists_any(
            CASE jsonb_typeof(content->'${field}')
              WHEN 'array' THEN content->'${field}'
              ELSE jsonb_build_array(content->'${field}')
            END,
            array[${values.map((_, i) => `$${i + 1}::text`).join(', ')}]
          )
        `;
        break;

      case 'all':
        // Match if all provided values exist in the array
        sql = `
          (
            SELECT bool_and(elem::text = ANY (
              SELECT jsonb_array_elements_text(
                CASE jsonb_typeof(content->'${field}')
                  WHEN 'array' THEN content->'${field}'
                  ELSE jsonb_build_array(content->'${field}')
                END
              )
            ))
            FROM jsonb_array_elements_text($1::jsonb) elem
          )
        `;
        params.unshift(JSON.stringify(values));
        break;

      case 'exact':
        // Match if arrays are exactly equal (same elements, same order)
        sql = `
          CASE jsonb_typeof(content->'${field}')
            WHEN 'array' THEN content->'${field}' = $1::jsonb
            ELSE content->'${field}' = $1::jsonb->0
          END
        `;
        params.unshift(JSON.stringify(values));
        break;

      default:
        throw new BadRequestException(`Invalid array operation: ${operation}`);
    }

    return { sql, params };
  }

  /**
   * Get array field statistics for optimization
   */
  private async getArrayFieldStats(
    indexName: string,
    field: string,
  ): Promise<{
    totalValues: number;
    uniqueValues: number;
    avgArrayLength: number;
    maxArrayLength: number;
  }> {
    const query = `
      WITH array_stats AS (
        SELECT 
          jsonb_array_length(content->'${field}') as array_length,
          jsonb_array_elements_text(content->'${field}') as array_value
        FROM search_documents
        WHERE index_name = $1
          AND jsonb_typeof(content->'${field}') = 'array'
      )
      SELECT
        COUNT(array_value) as total_values,
        COUNT(DISTINCT array_value) as unique_values,
        AVG(array_length) as avg_length,
        MAX(array_length) as max_length
      FROM array_stats
    `;

    const result = await this.dataSource.query(query, [indexName]);

    return {
      totalValues: parseInt(result[0].total_values || '0', 10),
      uniqueValues: parseInt(result[0].unique_values || '0', 10),
      avgArrayLength: parseFloat(result[0].avg_length || '0'),
      maxArrayLength: parseInt(result[0].max_length || '0', 10),
    };
  }

  /**
   * Optimize array field query based on statistics
   */
  private async optimizeArrayQuery(
    indexName: string,
    field: string,
    values: any[],
  ): Promise<{ sql: string; params: any[] }> {
    const stats = await this.getArrayFieldStats(indexName, field);

    // Choose optimal query strategy based on statistics
    if (stats.uniqueValues / stats.totalValues > 0.8) {
      // High cardinality: Use GIN index for exact matching
      return this.handleArrayFieldQuery(field, values, 'exact');
    } else if (stats.avgArrayLength <= 5) {
      // Small arrays: Use simple array operations
      return this.handleArrayFieldQuery(field, values, 'any');
    } else {
      // Large arrays: Use optimized containment checks
      return {
        sql: `
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(content->'${field}') elem
            WHERE elem = ANY($1::text[])
          )
        `,
        params: [values],
      };
    }
  }

  /**
   * Log query execution plan for performance analysis (Phase 2.3)
   */
  private async logQueryPlan(sql: string, params: any[], queryType: string): Promise<void> {
    try {
      const explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`;
      const planResult = await this.dataSource.query(explainQuery, params);

      if (planResult && planResult[0] && planResult[0]['QUERY PLAN']) {
        const plan = planResult[0]['QUERY PLAN'][0];
        const executionTime = plan['Execution Time'];
        const planningTime = plan['Planning Time'];

        this.logger.warn(`Query Plan Analysis (${queryType}):`, {
          executionTime: `${executionTime}ms`,
          planningTime: `${planningTime}ms`,
          totalTime: `${executionTime + planningTime}ms`,
          nodeType: plan.Plan['Node Type'],
          actualRows: plan.Plan['Actual Rows'],
          actualLoops: plan.Plan['Actual Loops'],
        });
      }
    } catch (error) {
      this.logger.debug(`Failed to get query plan: ${error.message}`);
    }
  }
}
