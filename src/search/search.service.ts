import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
import { TypoToleranceService, TypoCorrection } from './typo-tolerance.service';
import { DictionaryService } from './services/dictionary.service';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly postgresSearchEngine: PostgreSQLSearchEngine,
    private readonly entityExtractionService: EntityExtractionService,
    private readonly locationProcessorService: LocationProcessorService,
    private readonly queryExpansionService: QueryExpansionService,
    private readonly geographicFilterService: GeographicFilterService,
    private readonly multiSignalRankingService: MultiSignalRankingService,
    private readonly typoToleranceService: TypoToleranceService,
    private readonly dataSource: DataSource,
    private readonly dictionaryService: DictionaryService,
  ) {}

  /**
   * Execute search with intelligent processing and typo tolerance
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    const originalQuery = this.getQueryText(searchQuery);

    try {
      this.logger.log(`[PROFILE] Search started for: ${JSON.stringify(searchQuery)}`);

      // 🚀 AGGRESSIVE OPTIMIZATION: Skip typo tolerance for fast queries
      let typoCorrection = null;
      let searchQueryToUse = searchQuery;
      let queryTextToUse = originalQuery;
      let highScoringSuggestions: string[] = [];

      // 🚀 HYBRID PARALLEL APPROACH: Run original query AND typo correction simultaneously
      const isLikelyCorrect = await this.dictionaryService.isQueryLikelyCorrect(originalQuery);
      this.logger.log(
        `🔍 Dictionary check for "${originalQuery}": likely correct = ${isLikelyCorrect}`,
      );

      // Start both searches in parallel - no waiting!
      const searchPromises = [];

      // 1. Always start original query search immediately (handles legitimate words like "amala")
      const originalSearchPromise = this.executeSearch(indexName, searchQuery);
      searchPromises.push({
        promise: originalSearchPromise,
        type: 'original',
        query: originalQuery,
      });

      // 2. Only start typo correction if dictionary says it's a typo AND original query finds no results
      // We'll check this after the original search completes

      // 3. Wait for original search to complete first (fastest path)
      const originalResults = await originalSearchPromise;
      let searchResults: any;

      // 4. Check if we have good results from original query
      if (originalResults.data.hits.length > 2) {
        this.logger.log(
          `✅ Original query found ${originalResults.data.hits.length} results - using fast path`,
        );
        searchResults = originalResults;
        // NO TYPO CORRECTION NEEDED - we have results!
      } else {
        // 5. No results from original query - only NOW start typo correction
        this.logger.log(`❌ Original query found no results - starting typo correction`);

        // Run typo correction for queries with few results (regardless of dictionary check)
        if (originalQuery.length > 3) {
          this.logger.log(`🔍 DEBUG: About to call processTypoTolerance for "${originalQuery}"`);
          try {
            typoCorrection = await this.processTypoTolerance(indexName, originalQuery);

            if (
              typoCorrection &&
              typoCorrection.confidence > 0.1 && // Lowered from 0.3 to 0.1 (10%)
              typoCorrection.corrections.length > 0
            ) {
              // Get high-scoring suggestions
              highScoringSuggestions = typoCorrection.suggestions
                .filter(suggestion => suggestion.score > 50) // Lowered from 400 to 50
                .map(suggestion => suggestion.text);

              this.logger.log(
                `🎯 Using corrected query: "${originalQuery}" → "${typoCorrection.correctedQuery}"`,
              );
              this.logger.log(
                `🔍 High-scoring suggestions (>400): ${highScoringSuggestions.join(', ')}`,
              );

              // Use the corrected query
              searchQueryToUse = {
                ...searchQuery,
                query: typoCorrection.correctedQuery,
              };
              queryTextToUse = typoCorrection.correctedQuery;

              // Execute search with corrected query
              searchResults = await this.executeSearch(indexName, searchQueryToUse);
            } else {
              // No good typo correction - use original results (empty)
              searchResults = originalResults;
            }
          } catch (error) {
            this.logger.warn(`⚠️ Typo correction failed: ${error.message}`);
            searchResults = originalResults;
          }
        } else {
          // Dictionary says it's correct, so no typo correction needed
          searchResults = originalResults;
        }
      }

      // 🚀 PARALLEL SEARCH OPTIMIZATION: If we have multiple high-scoring suggestions, search them in parallel
      if (highScoringSuggestions.length > 1) {
        // 🚀 AGGRESSIVE OPTIMIZATION: Check if we have a single dominant suggestion
        if (
          highScoringSuggestions.length === 2 &&
          typoCorrection.suggestions[0].score > 800 &&
          typoCorrection.suggestions[1].score < 700
        ) {
          // 🚀 FAST PATH: Single dominant suggestion - skip parallel search
          this.logger.log(
            `🚀 FAST PATH: Single dominant suggestion detected, skipping parallel search`,
          );
          const dominantQuery = {
            ...searchQuery,
            query: highScoringSuggestions[0],
          };
          searchResults = await this.executeSearch(indexName, dominantQuery);
        } else {
          // 🚀 AGGRESSIVE OPTIMIZATION: Limit to TOP 2 suggestions for speed
          const topSuggestions = highScoringSuggestions.slice(0, 2);
          this.logger.log(
            `⚡ AGGRESSIVE OPTIMIZATION: Executing TOP ${topSuggestions.length} searches for maximum speed`,
          );

          // Create search queries for TOP suggestions only
          const allSearchQueries = topSuggestions.map(suggestion => ({
            ...searchQuery,
            query: suggestion,
          }));

          // 🚀 AGGRESSIVE OPTIMIZATION: Execute with aggressive timeout
          const startTime = Date.now();

          // Start searches with 500ms timeout for each
          const searchPromises = allSearchQueries.map(async query => {
            try {
              // 🚀 AGGRESSIVE OPTIMIZATION: Check cache first with immediate return
              const cacheKey = `search:${indexName}:${query.query}:${JSON.stringify(query)}`;
              const cached = await this.getCachedSearchResult(cacheKey);
              if (cached) {
                this.logger.log(`📋 CACHE HIT! Using cached result for "${query.query}"`);
                return cached;
              }

              // 🚀 AGGRESSIVE OPTIMIZATION: Execute with 500ms timeout
              const result = await Promise.race([
                this.executeSearch(indexName, query),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Search timeout')), 500),
                ),
              ]);

              // Cache the result for future requests
              await this.cacheSearchResult(cacheKey, result);

              return result;
            } catch (error) {
              this.logger.warn(`⚠️ Search failed for "${query.query}": ${error.message}`);
              return null;
            }
          });

          // 🚀 AGGRESSIVE OPTIMIZATION: Wait for first 2 results only
          const firstResults = await Promise.allSettled(searchPromises);
          const parallelTime = Date.now() - startTime;

          // Process completed results immediately with proper error handling
          const allSearchResults = firstResults
            .filter(result => result.status === 'fulfilled' && result.value && result.value.data)
            .map(result => (result as PromiseFulfilledResult<any>).value);

          this.logger.log(`⚡ Parallel search execution completed in ${parallelTime}ms`);
          this.logger.log(
            `📊 Valid search results: ${allSearchResults.length}/${firstResults.length}`,
          );

          // OPTIMIZATION: Stream results instead of full merging with null safety
          const allHits = allSearchResults
            .filter(
              result =>
                result && result.data && result.data.hits && Array.isArray(result.data.hits),
            )
            .map(result => result.data.hits)
            .flat();

          // Fast deduplication using Set for O(1) performance
          const seenIds = new Set();
          const uniqueHits: any[] = [];

          for (const hit of allHits) {
            if (hit.id && !seenIds.has(hit.id)) {
              seenIds.add(hit.id);
              uniqueHits.push(hit);
            }
          }

          // Sort by score (highest first) - only top results
          const topHits = uniqueHits
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, parseInt((searchQuery.size || '10').toString()));

          // Calculate total from all searches with safety check
          const totalResults =
            allSearchResults.length > 0
              ? Math.max(
                  ...allSearchResults
                    .filter(r => r && r.data)
                    .map(r => parseInt(r.data.total) || 0),
                )
              : 0;

          // Safety check: if no valid results, create empty result structure
          if (allSearchResults.length === 0) {
            this.logger.warn(`⚠️ No valid search results found, creating empty result structure`);
            searchResults = {
              data: {
                hits: [],
                total: '0',
              },
            };
          } else {
            searchResults = {
              data: {
                hits: topHits,
                total: totalResults.toString(),
              },
            };
          }

          this.logger.log(
            `⚡ Optimized: ${topHits.length} unique results from ${highScoringSuggestions.length} parallel searches in ${parallelTime}ms`,
          );
        }
      } else {
        // Fallback: Execute single search for corrected query
        this.logger.log(
          `🔍 Executing single search for corrected query: "${searchQueryToUse.query}"`,
        );
        // OPTIMIZATION: Add Redis caching for search results
        const cacheKey = `search:${indexName}:${searchQueryToUse.query}:${JSON.stringify(
          searchQueryToUse,
        )}`;
        const cachedResult = await this.getCachedSearchResult(cacheKey);

        if (!cachedResult) {
          searchResults = await this.executeSearch(indexName, searchQueryToUse);
          // Cache the result for future requests (5 minute TTL)
          await this.cacheSearchResult(cacheKey, searchResults);
        } else {
          this.logger.log(`📋 Using cached search result for "${searchQueryToUse.query}"`);
          searchResults = cachedResult;
        }
      }

      // 🚀 AGGRESSIVE OPTIMIZATION: Skip intelligent processing for speed
      let intelligentInfo = null;
      if (searchResults.data.hits.length > 0) {
        // Only process intelligent features if we have results
        const intelligentInfoPromise = this.processIntelligentQuery(queryTextToUse);
        intelligentInfo = await intelligentInfoPromise;
      }

      // 🚀 AGGRESSIVE OPTIMIZATION: Skip geographic processing for speed
      let finalResults = searchResults;
      if (intelligentInfo?.locationResult?.hasLocation && searchResults.data.hits.length > 0) {
        // Only apply geographic filtering if we have results and location
        const locationFiltered = await this.geographicFilterService.filterByLocation(
          searchResults.data.hits,
          intelligentInfo.locationResult,
        );
        const locationRanked = await this.geographicFilterService.sortByLocationRelevance(
          locationFiltered,
          intelligentInfo.locationResult,
        );
        finalResults = {
          ...searchResults,
          data: {
            ...searchResults.data,
            hits: locationRanked,
          },
        };
      }

      // 🚀 AGGRESSIVE OPTIMIZATION: Skip multi-signal ranking for speed
      if (finalResults.data.hits.length > 0) {
        // Only apply ranking if we have results
        const rankedResults = await this.multiSignalRankingService.rankResults(
          finalResults.data.hits,
          queryTextToUse,
          intelligentInfo,
        );

        finalResults = {
          ...finalResults,
          data: {
            ...finalResults.data,
            hits: rankedResults,
          },
        };
      }

      // Fallback strategy: if no results, try simplified query
      if (finalResults.data.hits.length === 0 && intelligentInfo?.businessTypes?.length > 0) {
        const simplifiedQuery = this.buildSimplifiedQuery(queryTextToUse, intelligentInfo);
        if (simplifiedQuery !== queryTextToUse) {
          const fallbackResults = await this.postgresSearchEngine.search(indexName, {
            ...searchQueryToUse,
            query: simplifiedQuery,
          });

          if (fallbackResults.data.hits.length > 0) {
            const fallbackRankedResults = await this.multiSignalRankingService.rankResults(
              fallbackResults.data.hits,
              simplifiedQuery,
              intelligentInfo,
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

      // Add typo tolerance information to response
      const response: SearchResponseDto = {
        ...finalResults,
        took: Date.now() - startTime,
        typoTolerance: typoCorrection,
      };

      this.logger.log(
        `Search completed for index '${indexName}': Found ${finalResults.data.total} results in ${response.took}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error(`Search error for index '${indexName}': ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Process typo tolerance in parallel with search
   */
  private async processTypoTolerance(
    indexName: string,
    query: string,
  ): Promise<TypoCorrection | null> {
    try {
      this.logger.log(
        `🔍 Starting typo tolerance processing for: "${query}" in index: ${indexName}`,
      );
      this.logger.log(`🔍 DEBUG: processTypoTolerance called for "${query}"`);

      // Only process typo tolerance for queries longer than 2 characters
      if (!query || query.trim().length < 3) {
        this.logger.log(`⚠️ Query too short for typo tolerance: "${query}"`);
        return null;
      }

      this.logger.log(`✅ Query length OK, processing typo tolerance...`);

      // Since dictionary already determined this is a typo, use fast typo correction
      const typoCorrection = await this.typoToleranceService.correctQuery(indexName, query, [
        'name',
        'title',
        'description',
        'category_name',
        'profile',
      ]);

      this.logger.log(`📝 Typo correction result:`, JSON.stringify(typoCorrection, null, 2));

      // Only return if there are actual corrections
      if (typoCorrection.corrections.length > 0 && typoCorrection.confidence > 0.2) {
        this.logger.log(
          `🎯 Typo correction found: "${query}" → "${typoCorrection.correctedQuery}" (confidence: ${typoCorrection.confidence})`,
        );
        return typoCorrection;
      }

      this.logger.log(`ℹ️ No significant typo corrections found for: "${query}"`);
      this.logger.log(`ℹ️ Suggestions found: ${typoCorrection.suggestions.length}`);
      this.logger.log(`ℹ️ Corrections found: ${typoCorrection.corrections.length}`);
      this.logger.log(`ℹ️ Confidence: ${typoCorrection.confidence}`);
      this.logger.log(`ℹ️ Typo correction object: ${JSON.stringify(typoCorrection, null, 2)}`);
      return null;
    } catch (error) {
      this.logger.error(`❌ Typo tolerance processing failed: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Execute the actual search with AGGRESSIVE optimization
   */
  private async executeSearch(indexName: string, searchQuery: SearchQueryDto): Promise<any> {
    const startTime = Date.now();

    try {
      // 🚀 OPTIMIZED: Increase timeout to 2 seconds for better reliability
      const result = await Promise.race([
        this.postgresSearchEngine.search(indexName, searchQuery),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PostgreSQL search timeout')), 2000),
        ),
      ]);

      const searchTime = Date.now() - startTime;
      if (searchTime > 500) {
        this.logger.warn(`⚠️ Slow search detected: ${searchTime}ms for "${searchQuery.query}"`);
      }

      return result;
    } catch (error) {
      const searchTime = Date.now() - startTime;
      this.logger.error(`❌ PostgreSQL search failed after ${searchTime}ms: ${error.message}`);

      // 🚀 AGGRESSIVE OPTIMIZATION: Use ultra-fast fallback search
      this.logger.log(`🚀 Using ULTRA-FAST fallback search for "${searchQuery.query}"`);
      return await this.ultraFastFallbackSearch(indexName, searchQuery);
    }
  }

  /**
   * ULTRA-FAST fallback search using optimized database queries
   */
  private async ultraFastFallbackSearch(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<any> {
    try {
      const query = searchQuery.query || '';

      // 🚀 ULTRA-FAST query with correct column names and minimal processing
      const ultraFastQuery = `
        SELECT 
          d.document_id as id,
          d.content->>'name' as name,
          d.content->>'category_name' as category,
          d.content->>'profile' as profile,
          CASE 
            WHEN d.content->>'name' ILIKE $2 || '%' THEN 1.0
            WHEN d.content->>'name' ILIKE '%' || $2 || '%' THEN 0.8
            WHEN d.content->>'category_name' ILIKE '%' || $2 || '%' THEN 0.6
            ELSE 0.4
          END as score
        FROM documents d
        WHERE d.index_name = $1 
          AND (
            d.content->>'name' ILIKE '%' || $2 || '%'
            OR d.content->>'category_name' ILIKE '%' || $2 || '%'
          )
        ORDER BY score DESC, d.content->>'name' ILIKE $2 || '%' DESC
        LIMIT ${searchQuery.size || 10}
      `;

      const results = await this.dataSource.query(ultraFastQuery, [indexName, query]);

      return {
        data: {
          hits: results.map((row: any) => ({
            id: row.id,
            score: row.score,
            source: {
              name: row.name,
              category_name: row.category,
              profile: row.profile,
            },
          })),
          total: results.length.toString(),
        },
      };
    } catch (fallbackError) {
      this.logger.error(`❌ Ultra-fast fallback search also failed: ${fallbackError.message}`);
      // 🚀 LAST RESORT: Return empty results instead of throwing
      return {
        data: {
          hits: [],
          total: '0',
        },
      };
    }
  }

  /**
   * Fast fallback search using simple database queries (kept for compatibility)
   */
  private async fastFallbackSearch(indexName: string, searchQuery: SearchQueryDto): Promise<any> {
    try {
      const query = searchQuery.query || '';

      // SIMPLE, FAST query that bypasses complex PostgreSQL search
      const simpleQuery = `
        SELECT 
          d.id,
          d.content->>'name' as name,
          d.content->>'category_name' as category,
          d.content->>'profile' as profile,
          0.5 as score
        FROM documents d
        WHERE d.index_name = $1 
          AND (
            d.content->>'name' ILIKE '%' || $2 || '%'
            OR d.content->>'category_name' ILIKE '%' || $2 || '%'
          )
        ORDER BY d.content->>'name' ILIKE $2 || '%' DESC,
                 d.content->>'name' ILIKE '%' || $2 || '%' DESC
        LIMIT 10
      `;

      const results = await this.dataSource.query(simpleQuery, [indexName, query]);

      return {
        data: {
          hits: results.map((row: any) => ({
            id: row.id,
            score: row.score,
            source: {
              name: row.name,
              category_name: row.category,
              profile: row.profile,
            },
          })),
          total: results.length.toString(),
        },
      };
    } catch (fallbackError) {
      this.logger.error(`❌ Fast fallback search also failed: ${fallbackError.message}`);
      throw fallbackError;
    }
  }

  /**
   * Optimize search query for better performance
   */
  private optimizeSearchQuery(searchQuery: SearchQueryDto): SearchQueryDto {
    // OPTIMIZATION: Return optimized query (placeholder for future database optimizations)
    return searchQuery;
  }

  /**
   * Process intelligent query features
   */
  private async processIntelligentQuery(query: string): Promise<any> {
    try {
      const entities = await this.entityExtractionService.extractEntities(query);
      const locationResult = await this.locationProcessorService.processLocationQuery(query);
      const expandedQuery = await this.queryExpansionService.expandQuery(query, [], []);

      return {
        entities,
        locationResult,
        expandedQuery,
        businessTypes: entities.businessTypes,
        services: entities.services,
        modifiers: entities.modifiers,
      };
    } catch (error) {
      this.logger.warn(`Intelligent query processing failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached search result from Redis
   */
  private async getCachedSearchResult(cacheKey: string): Promise<any | null> {
    try {
      // 🚀 AGGRESSIVE OPTIMIZATION: Simple in-memory cache for now
      // This will be replaced with Redis for production
      const cache = (global as any).searchCache || new Map();
      const cached = cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < 300000) {
        // 5 minute TTL
        this.logger.log(`📋 MEMORY CACHE HIT for: ${cacheKey}`);
        return cached.data;
      }

      return null;
    } catch (error) {
      this.logger.warn(`⚠️ Cache retrieval failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache search result in memory (will be Redis in production)
   */
  private async cacheSearchResult(cacheKey: string, result: any): Promise<void> {
    try {
      // 🚀 AGGRESSIVE OPTIMIZATION: Simple in-memory cache for now
      const cache = (global as any).searchCache || new Map();
      cache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });
      (global as any).searchCache = cache;
      this.logger.log(`📋 Cached result for: ${cacheKey}`);
    } catch (error) {
      this.logger.warn(`⚠️ Cache storage failed: ${error.message}`);
    }
  }

  /**
   * Merge and deduplicate search results by document ID
   */
  private mergeAndDeduplicateHits(hits: any[]): any[] {
    const seenIds = new Set();
    const uniqueHits: any[] = [];

    for (const hit of hits) {
      if (hit.id && !seenIds.has(hit.id)) {
        seenIds.add(hit.id);
        uniqueHits.push(hit);
      }
    }

    // Sort by score (highest first)
    return uniqueHits.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  /**
   * Get suggestions with typo tolerance
   */
  async suggest(indexName: string, suggestDto: SuggestQueryDto): Promise<SuggestionResultDto[]> {
    try {
      const { text, field = 'name', size = 5 } = suggestDto;

      if (!text || text.length < 2) {
        return [];
      }

      // Get suggestions with typo tolerance
      const suggestions = await this.typoToleranceService.getSuggestions(
        indexName,
        field,
        text,
        size,
      );

      // Convert to SuggestionResultDto format
      return suggestions.map(suggestion => ({
        text: suggestion.text,
        id: suggestion.text,
        score: suggestion.score,
        distance: suggestion.distance,
        frequency: suggestion.freq,
      }));
    } catch (error) {
      this.logger.error(`Suggestion failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get query text from search query
   */
  private getQueryText(searchQuery: SearchQueryDto): string {
    if (typeof searchQuery.query === 'string') {
      return searchQuery.query;
    }

    if (searchQuery.query?.match?.value) {
      return searchQuery.query.match.value;
    }

    if (searchQuery.query?.wildcard?.value) {
      const wildcardValue = searchQuery.query.wildcard.value;
      return typeof wildcardValue === 'string' ? wildcardValue : wildcardValue.value;
    }

    return '';
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
}
