import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryProcessorService } from './query-processor.service';
import { SearchExecutorService } from './search-executor.service';
import { SearchQueryDto, SearchResponseDto, SuggestQueryDto } from '../api/dtos/search.dto';
import { PostgreSQLSearchEngine } from '../storage/postgresql/postgresql-search-engine';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly queryProcessor: QueryProcessorService,
    private readonly searchExecutor: SearchExecutorService,
    private readonly postgresSearchEngine: PostgreSQLSearchEngine,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Execute search query and return results
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    this.logger.debug(`Executing search query on index ${indexName}`);

    try {
      // Execute search using PostgreSQL engine
      const searchResult = await this.postgresSearchEngine.search(indexName, searchQuery);

      // Format response with highlights and facets if requested
      const hits = await Promise.all(
        searchResult.data.hits.map(async hit => ({
          id: hit.id,
          index: indexName,
          score: hit.score,
          source: hit.document,
          highlights: searchQuery.highlight
            ? await this.getPostgresHighlights(hit, this.getQueryText(searchQuery.query), indexName)
            : undefined,
        })),
      );

      const response: SearchResponseDto = {
        data: {
          total: searchResult.data.total,
          maxScore: hits.length > 0 ? Math.max(...hits.map(h => h.score)) : 0,
          hits,
        },
        took: Date.now() - startTime,
      };

      // Add facets if requested
      if (searchQuery.facets) {
        response.data['facets'] = await this.getPostgresFacets(indexName, searchQuery.facets);
      }

      return response;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      throw error;
    }
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
  async suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<string[]> {
    this.logger.debug(`Getting suggestions for ${suggestQuery.text} in index ${indexName}`);
    return this.postgresSearchEngine.suggest(indexName, suggestQuery);
  }
}
