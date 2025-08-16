import { Injectable, Logger } from '@nestjs/common';
import { SearchQueryDto } from '../../api/dtos/search.dto';

export interface QueryInfo {
  searchTerm: string;
  hasWildcard: boolean;
  isSimpleTrailingWildcard: boolean;
  prefixTerm?: string;
}

export interface QueryResult {
  sql: string;
  params: any[];
  type: 'main' | 'prefix' | 'fallback';
}

/**
 * PostgreSQL Query Builder Service
 * Handles construction of optimized SQL queries for different search patterns
 */
@Injectable()
export class PostgreSQLQueryBuilderService {
  private readonly logger = new Logger(PostgreSQLQueryBuilderService.name);

  /**
   * Analyze search term to determine query strategy
   */
  analyzeSearchTerm(query: any, tsquery?: string): QueryInfo {
    let searchTerm = '';

    // Extract search term from various query formats
    if (typeof query === 'string') {
      searchTerm = query;
    } else if (query?.match?.value) {
      searchTerm = String(query.match.value);
    } else if (query?.wildcard?.value) {
      searchTerm = String(query.wildcard.value);
    } else if (tsquery && tsquery.trim() !== '') {
      searchTerm = tsquery;
    }

    // Analyze wildcard patterns
    const hasWildcard = /[\*\?]/.test(searchTerm);
    const isSimpleTrailingWildcard = /^[a-zA-Z0-9]+\*$/.test(searchTerm);
    const prefixTerm = isSimpleTrailingWildcard ? searchTerm.replace('*', '') : undefined;

    return {
      searchTerm,
      hasWildcard,
      isSimpleTrailingWildcard,
      prefixTerm,
    };
  }

  /**
   * Build main PostgreSQL full-text search query
   */
  buildMainQuery(indexName: string, searchTerm: string, candidateLimit: number): QueryResult {
    // Fix: Use appropriate tsquery function based on search term
    const hasWildcard = /[\*\?]/.test(searchTerm);
    let tsqueryFunction: string;
    let processedTerm: string;

    if (hasWildcard) {
      // For wildcards: use to_tsquery with proper prefix syntax
      tsqueryFunction = 'to_tsquery';
      processedTerm = searchTerm.replace(/\*/g, ':*').replace(/\?/g, '');
      this.logger.debug(
        `[buildMainQuery] Wildcard detected: "${searchTerm}" -> "${processedTerm}"`,
      );
    } else {
      // For regular terms: use plainto_tsquery
      tsqueryFunction = 'plainto_tsquery';
      processedTerm = searchTerm;
    }

    const sql = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        ts_rank_cd(sd.search_vector, ${tsqueryFunction}('english', $1)) as postgresql_score,
        COUNT(*) OVER() as total_count
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $2 
        AND sd.search_vector @@ ${tsqueryFunction}('english', $1)
      ORDER BY postgresql_score DESC
      LIMIT $3`;

    const params = [processedTerm, indexName, candidateLimit];

    return { sql, params, type: 'main' };
  }

  /**
   * Build optimized prefix query for simple trailing wildcards
   */
  buildPrefixQuery(indexName: string, prefixTerm: string, candidateLimit: number): QueryResult {
    const sql = `
      SELECT 
        d.document_id,
        d.content,
        d.metadata,
        ts_rank_cd(sd.search_vector, to_tsquery('english', $1 || ':*')) as postgresql_score,
        COUNT(*) OVER() as total_count
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $2 
        AND sd.search_vector @@ to_tsquery('english', $1 || ':*')
      ORDER BY postgresql_score DESC
      LIMIT $3`;

    const params = [prefixTerm, indexName, candidateLimit];

    return { sql, params, type: 'prefix' };
  }

  /**
   * Build ILIKE fallback query for complex wildcards
   */
  buildFallbackQuery(
    indexName: string,
    searchTerm: string,
    searchQuery: SearchQueryDto,
    candidateLimit: number,
    from: number,
  ): QueryResult {
    const likePattern = searchTerm.replace(/\*/g, '%').replace(/\?/g, '_');

    // Optimize fallback scope for better performance
    const fields =
      Array.isArray(searchQuery.fields) && searchQuery.fields.length > 0
        ? searchQuery.fields.slice(0, 1) // Limit to first 1 field for speed
        : ['name']; // Only search the most important field by default

    const fieldCondsSelect = fields
      .map(f => `d.content->>'${f.replace('.keyword', '')}' ILIKE $3`)
      .join(' OR ');

    const sql = `
      SELECT 
        d.document_id, 
        d.content, 
        d.metadata, 
        1.0::float AS postgresql_score,
        COUNT(*) OVER() as total_count
      FROM documents d
      WHERE d.index_name = $1 AND (${fieldCondsSelect})
      ORDER BY d.document_id
      LIMIT $2::int OFFSET $4::int`;

    const params = [indexName, candidateLimit, likePattern, from];

    return { sql, params, type: 'fallback' };
  }

  /**
   * Determine optimal query strategy based on search analysis
   */
  getQueryStrategy(
    queryInfo: QueryInfo,
    hasResults: boolean,
  ): 'main' | 'prefix' | 'fallback' | 'none' {
    const { hasWildcard, isSimpleTrailingWildcard } = queryInfo;

    // If main query found results, use them
    if (hasResults) {
      return 'main';
    }

    // For simple trailing wildcards, try prefix search first
    if (isSimpleTrailingWildcard) {
      return 'prefix';
    }

    // For complex wildcards or no results, use fallback
    if (hasWildcard || !hasResults) {
      return 'fallback';
    }

    return 'none';
  }

  /**
   * Get EXPLAIN query for performance analysis
   */
  buildExplainQuery(sql: string): string {
    return `EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`;
  }
}
