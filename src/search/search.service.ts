import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryProcessorService } from './query-processor.service';
import {
  SearchQueryDto,
  SearchResponseDto,
  SuggestQueryDto,
  SuggestionResultDto,
} from '../api/dtos/search.dto';
import { PostgreSQLSearchEngine } from '../storage/postgresql/postgresql-search-engine';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly queryProcessor: QueryProcessorService,
    private readonly postgresSearchEngine: PostgreSQLSearchEngine,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Execute search query and return results
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    console.log(`[PROFILE] Search started for: ${JSON.stringify(searchQuery.query)}`);

    try {
      // Skip all the complex query processing and go directly to PostgreSQL engine
      const searchStart = Date.now();
      const searchResult = await this.postgresSearchEngine.search(indexName, searchQuery);
      console.log(`[PROFILE] PostgreSQL search took: ${Date.now() - searchStart}ms`);

      const formatStart = Date.now();
      const result = this.formatSearchResponse(
        searchResult,
        searchQuery,
        searchQuery,
        indexName,
        startTime,
      );
      console.log(`[PROFILE] Format response took: ${Date.now() - formatStart}ms`);
      console.log(`[PROFILE] Total search took: ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format search response with highlights and facets
   */
  private async formatSearchResponse(
    searchResult: any,
    queryForHighlights: any,
    originalQuery: SearchQueryDto,
    indexName: string,
    startTime: number,
  ): Promise<SearchResponseDto> {
    // Format response with highlights and facets if requested
    const hits = await Promise.all(
      searchResult.data.hits.map(async hit => ({
        id: hit.id,
        index: indexName,
        score: hit.score,
        source: hit.document || hit.source, // Handle both field names
        highlights: originalQuery.highlight
          ? await this.getPostgresHighlights(
              hit,
              this.getQueryText(queryForHighlights.query),
              indexName,
            )
          : undefined,
      })),
    );

    const response: SearchResponseDto = {
      data: {
        total: searchResult.data.total,
        maxScore: hits.length > 0 ? Math.max(...hits.map(h => h.score)) : 0,
        hits,
        pagination: this.calculatePaginationMetadata(
          searchResult.data.total,
          originalQuery.size || 10,
          originalQuery.from || 0,
        ),
      },
      took: Date.now() - startTime,
    };

    // Add facets if requested
    if (originalQuery.facets) {
      response.data['facets'] = await this.getPostgresFacets(indexName, originalQuery.facets);
    }

    return response;
  }

  /**
   * Extract keyword fields for an index
   */
  private async extractKeywordFields(indexName: string): Promise<string[]> {
    try {
      const index = await this.postgresSearchEngine.getIndex(indexName);
      const mappings = index.mappings?.properties || {};

      const keywordFields: string[] = [];
      for (const [field, mapping] of Object.entries(mappings)) {
        const m = mapping as any;
        if (m.type === 'keyword') {
          keywordFields.push(field);
        } else if (
          m.type === 'text' &&
          m.fields &&
          m.fields.keyword &&
          m.fields.keyword.type === 'keyword'
        ) {
          keywordFields.push(field);
        }
      }

      return keywordFields;
    } catch (error) {
      this.logger.warn(`Failed to extract keyword fields for index ${indexName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate pagination metadata
   */
  private calculatePaginationMetadata(total: number, pageSize: number, offset: number) {
    const currentPage = Math.floor(offset / pageSize) + 1;
    const totalPages = Math.ceil(total / pageSize);
    const hasNext = currentPage < totalPages;
    const hasPrevious = currentPage > 1;

    return {
      currentPage,
      totalPages,
      pageSize,
      hasNext,
      hasPrevious,
      totalResults: total,
    };
  }

  /**
   * Extract query text from various query types
   */
  private getQueryText(query: any): string {
    if (typeof query === 'string') {
      return query;
    }
    if (query.match_all) {
      return '';
    }
    if (query.match) {
      return query.match.value;
    }
    if (query.term) {
      const [, value] = Object.entries(query.term)[0];
      return value.toString();
    }
    if (query.wildcard) {
      if ('field' in query.wildcard) {
        return query.wildcard.value;
      }
      const [, pattern] = Object.entries(query.wildcard)[0] as [
        string,
        string | { value: string; boost?: number },
      ];
      return typeof pattern === 'object' && 'value' in pattern ? pattern.value : pattern;
    }
    return '';
  }

  /**
   * Get highlighted snippets using PostgreSQL ts_headline
   */
  private async getPostgresHighlights(
    hit: { id: string; source: any },
    queryText: string,
    indexName: string,
  ): Promise<Record<string, string[]>> {
    const highlights: Record<string, string[]> = {};

    // Configure highlight options
    const options = "StartSel='<em>', StopSel='</em>', MaxWords=35, MinWords=15, ShortWord=3";

    // Get highlights for each text field
    for (const [field, value] of Object.entries(hit.source)) {
      if (typeof value === 'string') {
        const highlightQuery = `
          SELECT ts_headline(
            'english',
            $1,
            plainto_tsquery('english', $2),
            $3
          ) as highlight
        `;

        const result = await this.dataSource.query(highlightQuery, [value, queryText, options]);

        if (result?.[0]?.highlight) {
          highlights[field] = [result[0].highlight];
        }
      }
    }

    return highlights;
  }

  /**
   * Get facets using PostgreSQL aggregations
   */
  private async getPostgresFacets(
    indexName: string,
    facetFields: string[],
  ): Promise<Record<string, Array<{ key: string; count: number }>>> {
    const facets: Record<string, Array<{ key: string; count: number }>> = {};

    for (const field of facetFields) {
      const facetQuery = `
        SELECT 
          content->$1 as key,
          COUNT(*) as count
        FROM search_documents
        WHERE index_name = $2
          AND content ? $1
        GROUP BY content->$1
        ORDER BY count DESC
        LIMIT 10
      `;

      const results = await this.dataSource.query(facetQuery, [field, indexName]);

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
   * Get suggestions using PostgreSQL search engine
   */
  async suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<SuggestionResultDto[]> {
    this.logger.debug(`Getting suggestions for ${suggestQuery.text} in index ${indexName}`);
    return this.postgresSearchEngine.suggest(indexName, suggestQuery);
  }
}
