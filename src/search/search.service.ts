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
import { EntityExtractionService } from './services/entity-extraction.service';
import { LocationProcessorService } from './services/location-processor.service';
import { QueryExpansionService } from './services/query-expansion.service';
import { GeographicFilterService } from './services/geographic-filter.service';
import { MultiSignalRankingService } from './services/multi-signal-ranking.service';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly queryProcessor: QueryProcessorService,
    private readonly postgresSearchEngine: PostgreSQLSearchEngine,
    private readonly dataSource: DataSource,
    private readonly entityExtraction: EntityExtractionService,
    private readonly locationProcessor: LocationProcessorService,
    private readonly queryExpansion: QueryExpansionService,
    private readonly geographicFilter: GeographicFilterService,
    private readonly multiSignalRanking: MultiSignalRankingService,
  ) {}

  /**
   * Execute search query and return results
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    const originalQuery = this.getQueryText(searchQuery.query);

    try {
      // Intelligent query processing for natural language queries
      const enhancedSearchQuery = searchQuery;
      let intelligentInfo = null;

      if (this.shouldUseIntelligentProcessing(searchQuery)) {
        intelligentInfo = await this.processIntelligentQuery(searchQuery);
      }

      // Execute search
      const searchResult = await this.postgresSearchEngine.search(indexName, enhancedSearchQuery);

      // Apply geographic filtering if location context is present
      let finalResults = searchResult;
      if (intelligentInfo?.locationResult?.hasLocation) {
        const locationFilter = this.geographicFilter.parseLocationFilter(
          originalQuery,
          searchQuery.userLocation,
        );

        if (locationFilter.locationType !== 'none') {
          const geographicResults = this.geographicFilter.filterByLocation(
            searchResult.data.hits,
            locationFilter,
            searchQuery.userLocation,
          );

          // Sort by location relevance
          const sortedResults = this.geographicFilter.sortByLocationRelevance(
            geographicResults,
            searchResult.data.hits,
          );

          finalResults = {
            ...searchResult,
            data: {
              ...searchResult.data,
              hits: sortedResults,
              total: sortedResults.length,
            },
          };
        }
      }

      // Apply multi-signal ranking for enhanced result relevance
      const rankedResults = await this.multiSignalRanking.rankResults(
        finalResults.data.hits,
        originalQuery,
        { userLocation: searchQuery.userLocation },
      );

      finalResults = {
        ...finalResults,
        data: {
          ...finalResults.data,
          hits: rankedResults,
        },
      };

      // Fallback strategy: if no results, try simplified query
      if (finalResults.data.hits.length === 0 && intelligentInfo?.businessTypes?.length > 0) {
        const simplifiedQuery = this.buildSimplifiedQuery(originalQuery, intelligentInfo);

        if (simplifiedQuery !== originalQuery) {
          const fallbackResults = await this.postgresSearchEngine.search(indexName, {
            ...searchQuery,
            query: simplifiedQuery,
          });

          if (fallbackResults.data.hits.length > 0) {
            // Apply geographic filtering to fallback results
            if (intelligentInfo?.locationResult?.hasLocation) {
              const locationFilter = this.geographicFilter.parseLocationFilter(
                simplifiedQuery,
                searchQuery.userLocation,
              );

              if (locationFilter.locationType !== 'none') {
                const geographicResults = this.geographicFilter.filterByLocation(
                  fallbackResults.data.hits,
                  locationFilter,
                  searchQuery.userLocation,
                );

                const sortedResults = this.geographicFilter.sortByLocationRelevance(
                  geographicResults,
                  fallbackResults.data.hits,
                );

                fallbackResults.data.hits = sortedResults;
                fallbackResults.data.total = sortedResults.length;
              }
            }

            // Apply ranking to fallback results
            const fallbackRankedResults = await this.multiSignalRanking.rankResults(
              fallbackResults.data.hits,
              simplifiedQuery,
              { userLocation: searchQuery.userLocation },
            );

            finalResults = {
              ...fallbackResults,
              data: {
                ...fallbackResults.data,
                hits: fallbackRankedResults,
              },
            };
          }
        }
      }

      // Format response
      const response: SearchResponseDto = {
        data: {
          hits: finalResults.data.hits,
          total: finalResults.data.total,
          maxScore: finalResults.data.maxScore,
          pagination: this.calculatePaginationMetadata(finalResults.data.total, 10, 0),
        },
        took: Date.now() - startTime,
      };

      return response;
    } catch (error) {
      this.logger.error(`Search failed for index '${indexName}': ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Determine if intelligent processing should be used
   */
  private shouldUseIntelligentProcessing(searchQuery: SearchQueryDto): boolean {
    const queryText = this.getQueryText(searchQuery.query);

    // Skip for wildcard queries
    if (
      typeof searchQuery.query === 'string' &&
      (queryText.includes('*') || queryText.includes('?'))
    ) {
      return false;
    }

    // Skip for match_all queries
    if (
      searchQuery.query &&
      typeof searchQuery.query === 'object' &&
      'match_all' in searchQuery.query
    ) {
      return false;
    }

    // Skip for very short queries
    if (queryText.length < 3) {
      return false;
    }

    // Use intelligent processing for natural language queries
    return true;
  }

  /**
   * Process query with intelligent search features
   */
  private async processIntelligentQuery(searchQuery: SearchQueryDto) {
    const queryText = this.getQueryText(searchQuery.query);

    try {
      // Parallel processing of different query components
      const [entities, locationResult, expansion] = await Promise.all([
        this.entityExtraction.extractEntities(queryText),
        this.locationProcessor.processLocationQuery(queryText),
        this.queryExpansion.expandQuery(queryText, [], []), // Will be updated with entities
      ]);

      // Update expansion with extracted entities
      const finalExpansion = await this.queryExpansion.expandQuery(
        queryText,
        entities.businessTypes,
        entities.services,
      );

      return {
        original: queryText,
        entities,
        locationResult,
        expansion: finalExpansion,
      };
    } catch (error) {
      this.logger.warn(
        `Intelligent processing failed, falling back to original query: ${error.message}`,
      );
      return {
        original: queryText,
        entities: { businessTypes: [], locations: [], services: [], modifiers: [] },
        locationResult: { hasLocation: false },
        expansion: { original: queryText, expanded: queryText, synonyms: [], relatedTerms: [] },
      };
    }
  }

  /**
   * Extract query text from various query types
   */
  private getQueryText(query: any): string {
    if (typeof query === 'string') {
      return query;
    }
    if (query && typeof query === 'object') {
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
    }
    return '';
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
   * Get highlighted snippets using PostgreSQL ts_headline
   */
  private async getPostgresHighlights(
    hit: { id: string; source: any },
    queryText: string,
    indexName: string,
  ): Promise<Record<string, string[]>> {
    try {
      // Simple highlighting implementation
      const highlights: Record<string, string[]> = {};

      // For now, return basic highlighting
      // This can be enhanced with PostgreSQL ts_headline later
      if (hit.source && queryText) {
        const queryTerms = queryText.toLowerCase().split(/\s+/);

        for (const [field, value] of Object.entries(hit.source)) {
          if (typeof value === 'string') {
            const fieldValue = value.toLowerCase();
            const matchedTerms = queryTerms.filter(term => fieldValue.includes(term));

            if (matchedTerms.length > 0) {
              highlights[field] = [value]; // Return full field value for now
            }
          }
        }
      }

      return highlights;
    } catch (error) {
      this.logger.warn(`Failed to generate highlights: ${error.message}`);
      return {};
    }
  }

  /**
   * Build simplified query for fallback strategy
   */
  private buildSimplifiedQuery(originalQuery: string, intelligentInfo: any): string {
    const businessTypes = intelligentInfo.businessTypes || [];
    const locationResult = intelligentInfo.locationResult;

    let simplifiedQuery = '';

    // Add business type
    if (businessTypes.length > 0) {
      simplifiedQuery += businessTypes[0];
    }

    // Add location if present
    if (locationResult?.hasLocation && locationResult.location) {
      simplifiedQuery += ` in ${locationResult.location}`;
    }

    return simplifiedQuery.trim() || originalQuery;
  }

  /**
   * Get facets from PostgreSQL
   */
  private async getPostgresFacets(
    indexName: string,
    facets: string[],
  ): Promise<Record<string, any>> {
    try {
      // Simple facet implementation
      // This can be enhanced with PostgreSQL aggregation queries later
      const facetResults: Record<string, any> = {};

      for (const facet of facets) {
        facetResults[facet] = {
          buckets: [],
          total: 0,
        };
      }

      return facetResults;
    } catch (error) {
      this.logger.warn(`Failed to generate facets: ${error.message}`);
      return {};
    }
  }

  /**
   * Get suggestions for autocomplete
   */
  async suggest(indexName: string, suggestDto: SuggestQueryDto): Promise<SuggestionResultDto[]> {
    try {
      // Simple suggestion implementation
      // This can be enhanced with PostgreSQL trigram matching later
      const suggestions: SuggestionResultDto[] = [];

      // For now, return basic suggestions
      if (suggestDto.text && suggestDto.text.length > 0) {
        suggestions.push({
          text: suggestDto.text + ' suggestion 1',
          id: '1',
        });
        suggestions.push({
          text: suggestDto.text + ' suggestion 2',
          id: '2',
        });
      }

      return suggestions;
    } catch (error) {
      this.logger.error(`Suggestion failed: ${error.message}`);
      throw error;
    }
  }
}
