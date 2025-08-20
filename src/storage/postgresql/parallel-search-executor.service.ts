import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchQueryDto, SearchResponseDto } from '../../api/dtos/search.dto';

@Injectable()
export class ParallelSearchExecutor {
  private readonly logger = new Logger(ParallelSearchExecutor.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Execute search with parallel optimization for large result sets
   * Implements enterprise-level parallel processing strategies
   */
  async executeParallelSearch(
    indexName: string,
    query: SearchQueryDto,
    size = 10,
    from = 0,
  ): Promise<SearchResponseDto> {
    const startTime = Date.now();

    try {
      // Single optimized query with parallel execution
      const searchTerm = this.extractSearchTerm(query);
      const optimizedQuery = this.buildOptimizedSingleQuery(indexName, searchTerm, size, from);
      const results = await this.executeWithParallelWorkers(optimizedQuery, [
        indexName,
        searchTerm,
        size,
        from,
      ]);

      const executionTime = Date.now() - startTime;

      this.logger.log(
        `Parallel search completed for index '${indexName}': ${results.length} results in ${executionTime}ms`,
      );

      return {
        data: {
          total: results.length > 0 ? results[0].total_count || results.length : 0,
          maxScore: results.length > 0 ? Math.max(...results.map(r => r.rank || 0)) : 0,
          hits: results.map(result => ({
            id: result.document_id,
            index: indexName,
            score: result.rank || 0,
            source: result,
          })),
          pagination: {
            currentPage: Math.floor(from / size) + 1,
            totalPages: Math.ceil(
              (results.length > 0 ? results[0].total_count || results.length : 0) / size,
            ),
            pageSize: size,
            hasNext:
              from + size < (results.length > 0 ? results[0].total_count || results.length : 0),
            hasPrevious: from > 0,
            totalResults: results.length > 0 ? results[0].total_count || results.length : 0,
          },
        },
        took: executionTime,
      };
    } catch (error) {
      this.logger.error(`Parallel search failed for index '${indexName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Build single optimized query for parallel execution
   */
  private buildOptimizedSingleQuery(
    indexName: string,
    searchTerm: string,
    size: number,
    from: number,
  ): string {
    return `
      WITH search_results AS (
        SELECT 
          sd.*,
          ts_rank_cd(COALESCE(sd.materialized_vector, sd.search_vector), to_tsquery('english', $2)) as rank,
          COUNT(*) OVER() as total_count
        FROM search_documents sd
        WHERE sd.index_name = $1
          AND COALESCE(sd.materialized_vector, sd.search_vector) @@ to_tsquery('english', $2)
      )
      SELECT * FROM search_results
      ORDER BY rank DESC
      LIMIT $3 OFFSET $4
    `;
  }

  /**
   * Build optimized pre-filter query for parallel execution
   */
  private buildPreFilterQuery(indexName: string, query: SearchQueryDto): string {
    const searchTerm = this.extractSearchTerm(query);

    return `
      SELECT document_id, 
             COALESCE(materialized_vector, search_vector) as search_vector,
             index_name
      FROM search_documents 
      WHERE index_name = $1 
        AND COALESCE(materialized_vector, search_vector) @@ to_tsquery('english', $2)
    `;
  }

  /**
   * Execute query with parallel workers optimization
   */
  private async executeWithParallelWorkers(query: string, params: any[] = []): Promise<any[]> {
    // Set optimized parallel execution parameters (less aggressive)
    await this.dataSource.query('SET max_parallel_workers_per_gather = 2');
    await this.dataSource.query('SET parallel_tuple_cost = 0.5');
    await this.dataSource.query('SET parallel_setup_cost = 500.0');
    await this.dataSource.query('SET min_parallel_table_scan_size = 4194304'); // 4MB in bytes

    return this.dataSource.query(query, params);
  }

  /**
   * Execute parallel ranking and sorting
   */
  private async executeParallelRanking(
    indexName: string,
    preFilterResults: any[],
    query: SearchQueryDto,
    size: number,
    from: number,
  ): Promise<any[]> {
    if (preFilterResults.length === 0) {
      return [];
    }

    const searchTerm = this.extractSearchTerm(query);
    const documentIds = preFilterResults.map(r => r.document_id);

    // Parallel ranking query with optimized sorting
    const rankingQuery = `
      WITH ranked_results AS (
        SELECT 
          sd.*,
          ts_rank_cd(COALESCE(sd.materialized_vector, sd.search_vector), to_tsquery('english', $1)) as rank
        FROM search_documents sd
        WHERE sd.document_id = ANY($2)
          AND sd.index_name = $3
      )
      SELECT * FROM ranked_results
      ORDER BY rank DESC
      LIMIT $4 OFFSET $5
    `;

    return this.dataSource.query(rankingQuery, [searchTerm, documentIds, indexName, size, from]);
  }

  /**
   * Extract search term from query object
   */
  private extractSearchTerm(query: SearchQueryDto): string {
    if (typeof query.query === 'string') {
      return query.query;
    }
    if (query.query?.match?.value) {
      return query.query.match.value;
    }
    if (typeof query.query === 'object' && 'term' in query.query && query.query.term?.value) {
      return query.query.term.value;
    }
    if (
      typeof query.query === 'object' &&
      'wildcard' in query.query &&
      typeof query.query.wildcard === 'object' &&
      'value' in query.query.wildcard
    ) {
      return (query.query.wildcard as { value: string }).value;
    }
    return '';
  }

  /**
   * Execute chunked parallel processing for very large datasets
   */
  async executeChunkedParallelSearch(
    indexName: string,
    query: SearchQueryDto,
    size = 10,
    from = 0,
    chunkSize = 10000,
  ): Promise<SearchResponseDto> {
    const startTime = Date.now();

    try {
      // Get total count first
      const countQuery = `
        SELECT COUNT(*) as total
        FROM search_documents 
        WHERE index_name = $1 
          AND COALESCE(materialized_vector, search_vector) @@ to_tsquery('english', $2)
      `;

      const searchTerm = this.extractSearchTerm(query);
      const countResult = await this.dataSource.query(countQuery, [indexName, searchTerm]);
      const total = parseInt(countResult[0].total);

      if (total === 0) {
        return {
          data: {
            total: 0,
            maxScore: 0,
            hits: [],
            pagination: {
              currentPage: 1,
              totalPages: 0,
              hasNext: false,
              hasPrevious: false,
              pageSize: size,
              totalResults: total,
            },
          },
          took: Date.now() - startTime,
        };
      }

      // Execute chunked parallel search
      const results = await this.executeChunkedSearch(indexName, searchTerm, size, from, chunkSize);

      const executionTime = Date.now() - startTime;

      return {
        data: {
          total,
          maxScore: results.length > 0 ? Math.max(...results.map(r => r.rank || 0)) : 0,
          hits: results,
          pagination: {
            currentPage: Math.floor(from / size) + 1,
            totalPages: Math.ceil(total / size),
            hasNext: from + size < total,
            hasPrevious: from > 0,
            pageSize: size,
            totalResults: total,
          },
        },
        took: executionTime,
      };
    } catch (error) {
      this.logger.error(`Chunked parallel search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute search in chunks for memory efficiency
   */
  private async executeChunkedSearch(
    indexName: string,
    searchTerm: string,
    size: number,
    from: number,
    chunkSize: number,
  ): Promise<any[]> {
    const results: any[] = [];
    let currentOffset = from;
    let remainingSize = size;

    while (remainingSize > 0 && results.length < size) {
      const currentChunkSize = Math.min(chunkSize, remainingSize);

      const chunkQuery = `
        SELECT 
          sd.*,
          ts_rank_cd(COALESCE(sd.materialized_vector, sd.search_vector), to_tsquery('english', $1)) as rank
        FROM search_documents sd
        WHERE sd.index_name = $2
          AND COALESCE(sd.materialized_vector, sd.search_vector) @@ to_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $3 OFFSET $4
      `;

      const chunkResults = await this.dataSource.query(chunkQuery, [
        searchTerm,
        indexName,
        currentChunkSize,
        currentOffset,
      ]);

      results.push(...chunkResults);

      if (chunkResults.length < currentChunkSize) {
        break; // No more results
      }

      currentOffset += currentChunkSize;
      remainingSize -= currentChunkSize;
    }

    return results.slice(0, size);
  }
}
