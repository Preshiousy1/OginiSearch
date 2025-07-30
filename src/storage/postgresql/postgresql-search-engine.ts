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
  ) {}

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
    const metrics: SearchMetrics = {
      queryParsing: 0,
      execution: 0,
      highlighting: 0,
      faceting: 0,
      total: 0,
      planStats: null,
    };

    try {
      // Convert search query to tsquery for PostgreSQL full-text search
      let tsquery = '';
      if (typeof searchQuery.query === 'string') {
        tsquery = searchQuery.query;
      } else if (searchQuery.query?.match?.value) {
        tsquery = searchQuery.query.match.value;
      } else if (searchQuery.query?.wildcard?.value) {
        const wildcardValue = searchQuery.query.wildcard.value;
        tsquery = typeof wildcardValue === 'string' ? wildcardValue : wildcardValue.value;
      }

      // Use the new executeSearch method with proper ranking
      const searchResult = await this.executeSearch(indexName, tsquery, searchQuery);

      metrics.execution = Date.now() - startTime;
      metrics.total = metrics.execution;

      return {
        data: {
          hits: searchResult.hits.map(hit => ({
            id: hit.id,
            score: hit.score,
            source: hit.document,
          })),
          total: searchResult.totalHits,
          maxScore: searchResult.maxScore,
        },
        metrics,
      };
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

      // Filter and format results
      return results
        .filter(row => row.suggestion && row.suggestion.toLowerCase().includes(text.toLowerCase()))
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
   * Execute PostgreSQL search
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
    const { from = 0, size = 10, sort } = searchQuery;
    const query = searchQuery.query;

    // Business ranking configuration
    const businessRankingFields = {
      has_featured_model: { weight: 1000, type: 'boolean' },
      is_confirmed: { weight: 500, type: 'boolean' },
      is_verified: { weight: 300, type: 'boolean' },
      is_active: { weight: 200, type: 'boolean' },
      health: { weight: 100, type: 'numeric' },
      updated_at: { weight: 50, type: 'date' },
    };

    // Build ranking score calculation
    const businessRankingParts = [];
    for (const [field, config] of Object.entries(businessRankingFields)) {
      if (config.type === 'boolean') {
        businessRankingParts.push(
          `(CASE WHEN d.content->>'${field}' = 'true' THEN ${config.weight} ELSE 0 END)`,
        );
      } else if (config.type === 'numeric') {
        businessRankingParts.push(
          `(COALESCE((d.content->>'${field}')::numeric, 0) * ${config.weight / 100})`,
        );
      } else if (config.type === 'date') {
        businessRankingParts.push(
          `(EXTRACT(EPOCH FROM (d.content->>'${field}')::timestamp) * ${config.weight / 1000000})`,
        );
      }
    }

    // Build the SQL query
    const params: any[] = [indexName];
    let paramIndex = 2; // Start from $2 since $1 is indexName

    // Handle search conditions
    let searchCondition = '';
    let searchQueryParam = '';

    // Handle different query types
    if (typeof query === 'object' && query.match) {
      const { field, value } = query.match;
      if (this.isWildcardPattern(value)) {
        // Handle wildcard patterns with ILIKE
        const likePattern = this.convertWildcardToLikePattern(value);
        searchCondition = `d.content->>'${field || 'name'}' ILIKE $${paramIndex}`;
        params.push(likePattern);
        paramIndex++;
      } else {
        // Handle regular text search with tsvector
        searchQueryParam = this.convertToTsQuery(value);
        searchCondition = `sd.search_vector @@ to_tsquery('english', $${paramIndex})`;
        params.push(searchQueryParam);
        paramIndex++;
      }
    } else if (typeof query === 'object' && query.wildcard) {
      const { field, value } = query.wildcard;
      const likePattern = this.convertWildcardToLikePattern(value);
      searchCondition = `d.content->>'${field}' ILIKE $${paramIndex}`;
      params.push(likePattern);
      paramIndex++;
    } else if (tsquery && tsquery.trim() !== '') {
      // Handle string queries
      searchQueryParam = this.convertToTsQuery(tsquery);
      searchCondition = `sd.search_vector @@ to_tsquery('english', $${paramIndex})`;
      params.push(searchQueryParam);
      paramIndex++;
    }

    // Combine relevance score with business ranking
    const relevanceScore = searchQueryParam
      ? `ts_rank_cd(sd.search_vector, to_tsquery('english', $${paramIndex - 1}))`
      : '1.0';
    const finalScore = `(${relevanceScore} * 1000) + ${businessRankingParts.join(' + ')}`;
    const businessScore = businessRankingParts.join(' + ');

    // First, get the total count of matches (without LIMIT/OFFSET)
    const countQuery = `
      SELECT COUNT(*) as total_count
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1 ${searchCondition ? `AND ${searchCondition}` : ''}`;

    const countParams = [indexName];
    if (searchCondition && searchCondition.includes('$')) {
      // Add the search parameters for the count query
      const searchParams = params.slice(1, paramIndex - 1); // Exclude indexName and LIMIT/OFFSET params
      countParams.push(...searchParams);
    }

    // Execute count query to get total matches
    const countResult = await this.dataSource.query(countQuery, countParams);
    const totalHits = parseInt(countResult[0]?.total_count || '0', 10);

    // Add LIMIT and OFFSET parameters for the main query
    params.push(size, from);

    const sqlQuery = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        ${finalScore} as score,
        ${relevanceScore} as relevance_score,
        ${businessScore} as business_score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1 ${searchCondition ? `AND ${searchCondition}` : ''}
      ORDER BY score DESC, d.content->>'updated_at' DESC
      LIMIT $${paramIndex}::integer OFFSET $${paramIndex + 1}::integer`;

    try {
      const result = await this.dataSource.query(sqlQuery, params);

      const hits = result.map((row: any) => ({
        id: row.document_id,
        score: parseFloat(row.score) || 0,
        document: row.content,
        relevance_score: parseFloat(row.relevance_score) || 0,
        business_score: parseFloat(row.business_score) || 0,
      }));

      const maxScore = hits.length > 0 ? Math.max(...hits.map(h => h.score)) : 0;

      return {
        totalHits, // ✅ Now returns total matches across all pages
        maxScore,
        hits,
      };
    } catch (error) {
      this.logger.error('Search error:', error);
      throw error;
    }
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

  private async buildSearchQuery(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<{ sql: string; params: any[] }> {
    const { query, size = 10, from = 0 } = searchQuery;
    const params: any[] = [indexName];
    let paramIndex = 2;

    // Base query structure
    let sql = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,`;

    if (typeof query === 'string') {
      // Simple text query
      params.push(query);
      sql += `
        ts_rank_cd(sd.search_vector, plainto_tsquery('english', $${paramIndex}::text)) as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1
        AND sd.search_vector @@ plainto_tsquery('english', $${paramIndex}::text)`;
      paramIndex++;
    } else {
      // Complex query object
      if (query.match_all) {
        sql += `
        1.0 * ${query.match_all.boost || 1.0} as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1`;
      } else if (query.match) {
        params.push(query.match.value);
        sql += `
        ts_rank_cd(sd.search_vector, plainto_tsquery('english', $${paramIndex}::text)) as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1
        AND sd.search_vector @@ plainto_tsquery('english', $${paramIndex}::text)`;
        paramIndex++;
      } else if (query.term) {
        const [field, value] = Object.entries(query.term)[0];
        params.push(value);
        sql += `
        1.0 as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1
        AND d.metadata->>'${field}' = $${paramIndex}::text`;
        paramIndex++;
      } else if (query.wildcard) {
        let field: string;
        let wildcardValue: string;
        let boost = 1.0;

        if ('field' in query.wildcard && 'value' in query.wildcard) {
          field = query.wildcard.field as string;
          wildcardValue = String(query.wildcard.value);
          boost = typeof query.wildcard.boost === 'number' ? query.wildcard.boost : 1.0;
        } else {
          const [f, pattern] = Object.entries(query.wildcard)[0];
          field = f;
          if (typeof pattern === 'object' && 'value' in pattern) {
            wildcardValue = String(pattern.value);
            boost = typeof pattern.boost === 'number' ? pattern.boost : 1.0;
          } else {
            wildcardValue = String(pattern);
          }
        }

        const likePattern = wildcardValue.replace(/\*/g, '%').replace(/\?/g, '_');
        params.push(likePattern);

        // Handle _all field by searching across specified fields or entire content
        if (field === '_all') {
          // If searchQuery.fields is provided, search across those specific fields
          if (searchQuery.fields && searchQuery.fields.length > 0) {
            const fieldConditions = searchQuery.fields
              .map(f => `d.content->>'${f.replace('.keyword', '')}' ILIKE $${paramIndex}::text`)
              .join(' OR ');
            sql += `
          ${boost}::float as score
        FROM search_documents sd
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = $1
          AND (${fieldConditions})`;
          } else {
            // Fallback to searching entire content JSON as text
            sql += `
          ${boost}::float as score
        FROM search_documents sd
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = $1
          AND d.content::text ILIKE $${paramIndex}::text`;
          }
        } else {
          // Handle .keyword subfields by extracting the base field name
          const baseField = field.includes('.keyword') ? field.split('.')[0] : field;
          sql += `
          ${boost}::float as score
        FROM search_documents sd
        JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
        WHERE sd.index_name = $1
          AND d.content->>'${baseField}' ILIKE $${paramIndex}::text`;
        }
        paramIndex++;
      } else if (query.bool) {
        sql += `
        1.0 as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1`;

        if (query.bool.must) {
          query.bool.must.forEach((mustClause: any) => {
            if (mustClause.match) {
              params.push(mustClause.match.value);
              sql += ` AND d.content->>'${mustClause.match.field}' ILIKE '%' || $${paramIndex}::text || '%'`;
              paramIndex++;
            }
          });
        }

        if (query.bool.should) {
          const shouldClauses: string[] = [];
          query.bool.should.forEach((shouldClause: any) => {
            if (shouldClause.match) {
              params.push(shouldClause.match.value);
              shouldClauses.push(
                `d.content->>'${shouldClause.match.field}' ILIKE '%' || $${paramIndex}::text || '%'`,
              );
              paramIndex++;
            }
          });
          if (shouldClauses.length > 0) {
            sql += ` AND (${shouldClauses.join(' OR ')})`;
          }
        }

        if (query.bool.must_not) {
          query.bool.must_not.forEach((mustNotClause: any) => {
            if (mustNotClause.match) {
              params.push(mustNotClause.match.value);
              sql += ` AND NOT (d.content->>'${mustNotClause.match.field}' ILIKE '%' || $${paramIndex}::text || '%')`;
              paramIndex++;
            }
          });
        }
      }
    }

    // Add filters if present
    if (searchQuery.filter) {
      const filterSql = this.buildFilterConditions(searchQuery.filter, params, paramIndex);
      sql += filterSql;
      // Update paramIndex based on the number of parameters added by the filter
      paramIndex = params.length + 1;
    }

    // Add pagination parameters at the end
    params.push(size);
    params.push(from);

    // Add ORDER BY, LIMIT, and OFFSET with the correct parameter numbers
    sql += `
      ORDER BY score DESC, document_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    this.logger.debug(`Final SQL: ${sql}`);
    this.logger.debug(`Final params: ${JSON.stringify(params)}`);

    return { sql, params };
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
        sql = `${fieldSql} = $${paramIndex}`;
        params.push(value);
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
        sql = `${fieldSql} = $${paramIndex}`;
        params.push(value);
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
}
