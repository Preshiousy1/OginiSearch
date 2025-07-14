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
import { SearchQueryDto, SearchResponseDto, SuggestQueryDto } from '../../api/dtos/search.dto';
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
      // Build the search query
      const { sql, params } = await this.buildSearchQuery(indexName, searchQuery);

      // Log the SQL query and parameters for debugging
      this.logger.debug('Generated SQL:', { sql, params });

      // Execute the search query
      const result = await this.dataSource.query(sql, params);

      metrics.execution = Date.now() - startTime;
      metrics.total = metrics.execution;

      return {
        data: {
          hits: result.map((row: any) => ({
            id: row.document_id,
            score: row.score,
            document: row.content,
          })),
          total: result.length,
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
  async suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<string[]> {
    this.logger.log(`PostgreSQL suggestions in index ${indexName} for: ${suggestQuery.text}`);

    try {
      await this.validateIndexExists(indexName);

      const { text, field = 'title', size = 5 } = suggestQuery;

      // First try prefix matching (most relevant)
      const prefixQuery = `
        SELECT DISTINCT d.content->>'${field}' as suggestion
        FROM documents d
        WHERE d.index_name = $1 
          AND d.content->>'${field}' IS NOT NULL
          AND d.content->>'${field}' ILIKE $2
        ORDER BY d.content->>'${field}'
        LIMIT $3`;

      let results = await this.dataSource.query(prefixQuery, [indexName, `${text}%`, size]);

      // If no prefix matches, try substring matching
      if (results.length === 0) {
        const substringQuery = `
          SELECT DISTINCT d.content->>'${field}' as suggestion
          FROM documents d
          WHERE d.index_name = $1 
            AND d.content->>'${field}' IS NOT NULL
            AND d.content->>'${field}' ILIKE $2
          ORDER BY d.content->>'${field}'
          LIMIT $3`;
        results = await this.dataSource.query(substringQuery, [indexName, `%${text}%`, size]);
      }

      // Filter and format results
      return results
        .map(row => row.suggestion)
        .filter(suggestion => suggestion && suggestion.toLowerCase().includes(text.toLowerCase()))
        .slice(0, size);
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
  private convertToTsQuery(searchQuery: SearchQueryDto): string {
    if (typeof searchQuery.query === 'string') {
      return searchQuery.query.split(/\s+/).join(' & ');
    }

    const query = searchQuery.query;

    // Handle match query
    if (query.match?.field && query.match.value) {
      return query.match.value.split(/\s+/).join(' & ');
    }

    // Handle term query
    if (query.term?.field && query.term.value) {
      return query.term.value;
    }

    // Handle boolean query
    if (query.bool) {
      const conditions: string[] = [];

      if (query.bool.must) {
        const mustConditions = query.bool.must.map(q => this.convertToTsQuery({ query: q }));
        conditions.push(`(${mustConditions.join(' & ')})`);
      }

      if (query.bool.should) {
        const shouldConditions = query.bool.should.map(q => this.convertToTsQuery({ query: q }));
        conditions.push(`(${shouldConditions.join(' | ')})`);
      }

      if (query.bool.must_not) {
        const mustNotConditions = query.bool.must_not.map(
          q => `!(${this.convertToTsQuery({ query: q })})`,
        );
        conditions.push(...mustNotConditions);
      }

      return conditions.join(' & ');
    }

    // Handle range query
    if (query.range?.field) {
      const { field, gt, gte, lt, lte } = query.range;
      const conditions: string[] = [];

      if (gt !== undefined) conditions.push(`${field} > ${gt}`);
      if (gte !== undefined) conditions.push(`${field} >= ${gte}`);
      if (lt !== undefined) conditions.push(`${field} < ${lt}`);
      if (lte !== undefined) conditions.push(`${field} <= ${lte}`);

      return conditions.join(' & ');
    }

    return '';
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
    const { from = 0, size = 10 } = searchQuery;
    const query = searchQuery.query;

    // Base query parts
    let whereClause = 'sd.index_name = $1';
    const params: any[] = [indexName];
    let paramIndex = 2;

    // Handle text search
    if (tsquery && tsquery.trim() !== '') {
      whereClause += ` AND sd.search_vector @@ to_tsquery('english', $${paramIndex})`;
      params.push(tsquery);
      paramIndex++;
    }

    // Handle term query
    if (typeof query === 'object' && query.term) {
      const [field, value] = Object.entries(query.term)[0];
      whereClause += ` AND (d.metadata->>'${field}' = $${paramIndex} OR jsonb_exists_any(d.metadata->'${field}', ARRAY[$${paramIndex}]))`;
      params.push(value);
      paramIndex++;
    }

    // Handle range query
    if (typeof query === 'object' && query.range) {
      const { field, gt, gte, lt, lte } = query.range;
      if (gt !== undefined) {
        whereClause += ` AND (d.metadata->>'${field}')::numeric > $${paramIndex}`;
        params.push(gt);
        paramIndex++;
      }
      if (gte !== undefined) {
        whereClause += ` AND (d.metadata->>'${field}')::numeric >= $${paramIndex}`;
        params.push(gte);
        paramIndex++;
      }
      if (lt !== undefined) {
        whereClause += ` AND (d.metadata->>'${field}')::numeric < $${paramIndex}`;
        params.push(lt);
        paramIndex++;
      }
      if (lte !== undefined) {
        whereClause += ` AND (d.metadata->>'${field}')::numeric <= $${paramIndex}`;
        params.push(lte);
        paramIndex++;
      }
    }

    // Build the full query
    const sqlQuery = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        CASE 
          WHEN $2 IS NOT NULL AND $2 != '' THEN ts_rank_cd(sd.search_vector, to_tsquery('english', $2))
          ELSE 1.0
        END as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE ${whereClause}
      ORDER BY score DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    // Log the query and parameters
    this.logger.debug('Executing search query:', {
      query: sqlQuery,
      params: [...params, size, from],
    });

    // Execute search
    const results = await this.dataSource.query(sqlQuery, [...params, size, from]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE ${whereClause}`;

    // Log the count query
    this.logger.debug('Executing count query:', {
      query: countQuery,
      params,
    });

    const countResult = await this.dataSource.query(countQuery, params);

    const totalHits = parseInt(countResult[0]?.total || '0', 10);

    const hits = results.map(row => ({
      id: row.document_id,
      score: parseFloat(row.score || '0'),
      document: { ...row.content, ...row.metadata },
    }));

    const maxScore = hits.length > 0 ? Math.max(...hits.map(h => h.score)) : 0;

    return { totalHits, maxScore, hits };
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
      // Update paramIndex based on the number of parameters added
      paramIndex = params.length + 1;
    }

    // Add pagination parameters at the end
    params.push(size);
    params.push(from);

    // Add ORDER BY, LIMIT, and OFFSET with the correct parameter numbers
    sql += `
      ORDER BY score DESC, document_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    return { sql, params };
  }

  private buildFilterConditions(filter: any, params: any[], startIndex: number): string {
    let sql = '';
    let paramIndex = startIndex;

    if (filter.term) {
      const [field, value] = Object.entries(filter.term)[0];
      if (Array.isArray(value)) {
        sql += ` AND d.metadata->>'${field}' = ANY($${paramIndex}::text[])`;
        params.push(value);
        paramIndex++;
      } else {
        sql += ` AND d.metadata->>'${field}' = $${paramIndex}`;
        params.push(value);
        paramIndex++;
      }
    }

    if (filter.range) {
      Object.entries(filter.range).forEach(([field, conditions]) => {
        Object.entries(conditions as any).forEach(([op, value]) => {
          const operator = this.getRangeOperator(op);
          if (field === 'createdAt' || field === 'updatedAt') {
            sql += ` AND (d.metadata->>'${field}')::timestamp ${operator} $${paramIndex}::timestamp`;
          } else if (typeof value === 'number') {
            sql += ` AND (d.metadata->>'${field}')::numeric ${operator} $${paramIndex}::numeric`;
          } else {
            sql += ` AND d.metadata->>'${field}' ${operator} $${paramIndex}`;
          }
          params.push(value);
          paramIndex++;
        });
      });
    }

    return sql;
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
