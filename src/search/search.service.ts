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
import { TieredRankingService } from './services/tiered-ranking.service';
import { TypoToleranceService, TypoCorrection } from './typo-tolerance.service';
import { DictionaryService } from './services/dictionary.service';
import { RedisCacheService } from '../storage/postgresql/redis-cache.service';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly cacheEnabled: boolean;
  private readonly cacheTtl: number;

  constructor(
    private readonly postgresSearchEngine: PostgreSQLSearchEngine,
    private readonly entityExtractionService: EntityExtractionService,
    private readonly locationProcessorService: LocationProcessorService,
    private readonly queryExpansionService: QueryExpansionService,
    private readonly geographicFilterService: GeographicFilterService,
    private readonly multiSignalRankingService: MultiSignalRankingService,
    private readonly tieredRankingService: TieredRankingService,
    private readonly typoToleranceService: TypoToleranceService,
    private readonly dataSource: DataSource,
    private readonly dictionaryService: DictionaryService,
    private readonly redisCache: RedisCacheService,
  ) {
    // Cache configuration
    this.cacheEnabled = true; // Enable Redis caching
    this.cacheTtl = 300; // 5 minutes default TTL
  }

  /**
   * Execute search with intelligent processing and typo tolerance
   */
  async search(indexName: string, searchQuery: SearchQueryDto): Promise<SearchResponseDto> {
    const startTime = Date.now();
    const originalQuery = this.getQueryText(searchQuery);

    try {
      // 🚀 AGGRESSIVE OPTIMIZATION: Skip typo tolerance for fast queries
      let typoCorrection = null;
      let searchQueryToUse = searchQuery;
      let queryTextToUse = originalQuery;
      let highScoringSuggestions: string[] = [];
      let intelligentInfo: any = null;

      // 🚀 OPTIMIZATION: Process typo tolerance in parallel with initial search
      // This saves 100-200ms by not waiting for typo correction before starting search
      const isLikelyCorrect = await this.dictionaryService.isQueryLikelyCorrect(originalQuery);

      // 🚀 OPTIMIZATION: Check cache first before executing search
      const cacheKey = this.redisCache.generateKey(indexName, searchQuery);
      const cachedResult = await this.getCachedSearchResult(cacheKey);

      let searchResults: any;
      if (cachedResult) {
        // Cached results are already fully processed, return immediately
        if (cachedResult && cachedResult.data) {
          const response: SearchResponseDto = {
            ...cachedResult,
            took: Date.now() - startTime,
            // Preserve typoTolerance if it exists in cached result
            typoTolerance: cachedResult.typoTolerance || null,
          };
          this.logger.log(
            `✅ Cache HIT! Returning cached result for "${originalQuery}" in ${response.took}ms`,
          );
          return response;
        }
        // If cached result structure is invalid, fall through to normal search
        this.logger.warn(`⚠️ Cached result has invalid structure, falling back to normal search`);
      }

      if (!cachedResult || !cachedResult.data) {
        // 🚀 OPTIMIZATION: Start typo tolerance, intelligent processing, and original search in parallel
        const [originalResults, typoCorrectionResult, intelligentInfoResult] =
          await Promise.allSettled([
            this.executeSearch(indexName, searchQuery), // Original query search
            // Only process typo tolerance if query is long enough and likely incorrect
            originalQuery.length > 3 && !isLikelyCorrect
              ? this.processTypoTolerance(indexName, originalQuery)
              : Promise.resolve(null),
            // Start intelligent query processing in parallel
            this.processIntelligentQuery(originalQuery),
          ]);

        // Extract results
        const originalResultsValue =
          originalResults.status === 'fulfilled' ? originalResults.value : null;
        typoCorrection =
          typoCorrectionResult.status === 'fulfilled' ? typoCorrectionResult.value : null;
        intelligentInfo =
          intelligentInfoResult.status === 'fulfilled' ? intelligentInfoResult.value : null;

        // 4. Check if we have good results from original query
        if (originalResultsValue && originalResultsValue.data?.hits?.length > 0) {
          searchResults = originalResultsValue;
          // Cache the result for future requests
          await this.cacheSearchResult(cacheKey, searchResults);
          // NO TYPO CORRECTION NEEDED - we have results!
        } else {
          // 5. No results from original query - use typo correction if available
          // Typo correction was already processed in parallel, check if we have it
          if (
            typoCorrection &&
            typoCorrection.confidence > 0.1 && // Lowered from 0.3 to 0.1 (10%)
            typoCorrection.corrections.length > 0
          ) {
            // Get high-scoring suggestions (only the best one to avoid parallel search timeouts)
            highScoringSuggestions = typoCorrection.suggestions
              .filter(suggestion => suggestion.score > 1500) // Only include very high confidence corrections
              .map(suggestion => suggestion.text);

            // Use the corrected query - maintain the same query structure as original
            if (typeof searchQuery.query === 'string') {
              searchQueryToUse = {
                ...searchQuery,
                query: typoCorrection.correctedQuery,
              };
            } else if (searchQuery.query?.match) {
              searchQueryToUse = {
                ...searchQuery,
                query: {
                  match: {
                    value: typoCorrection.correctedQuery,
                  },
                },
              };
            } else {
              // Fallback to string format
              searchQueryToUse = {
                ...searchQuery,
                query: typoCorrection.correctedQuery,
              };
            }
            queryTextToUse = typoCorrection.correctedQuery;

            // Execute search with corrected query (already have typo correction from parallel processing)
            searchResults = await this.executeSearch(indexName, searchQueryToUse);
            // Cache the result
            await this.cacheSearchResult(cacheKey, searchResults);
          } else {
            // No good typo correction - use original results (empty)
            searchResults = originalResultsValue || { data: { hits: [], total: '0' } };
            // Cache even empty results
            await this.cacheSearchResult(cacheKey, searchResults);
          }
        }

        // 🚀 PARALLEL SEARCH OPTIMIZATION: If we have multiple high-scoring suggestions, search them in parallel
        // Only proceed if we don't have cached results
        if (!cachedResult) {
          // Skip if we already have good results from original query
          if (highScoringSuggestions.length > 1) {
            // 🚀 AGGRESSIVE OPTIMIZATION: Check if we have a single dominant suggestion
            if (
              highScoringSuggestions.length === 2 &&
              typoCorrection.suggestions[0].score > 800 &&
              typoCorrection.suggestions[1].score < 700
            ) {
              // 🚀 FAST PATH: Single dominant suggestion - skip parallel search
              const dominantQuery = {
                ...searchQuery,
                query: highScoringSuggestions[0],
              };
              searchResults = await this.executeSearch(indexName, dominantQuery);
            } else {
              // 🚀 AGGRESSIVE OPTIMIZATION: Limit to TOP 2 suggestions for speed
              const topSuggestions = highScoringSuggestions.slice(0, 2);

              // Create search queries for TOP suggestions only
              const allSearchQueries = topSuggestions.map(suggestion => ({
                ...searchQuery,
                query: suggestion,
              }));

              // 🚀 OPTIMIZATION: Check all cache keys in parallel before starting searches
              const cacheKeys = allSearchQueries.map(query =>
                this.redisCache.generateKey(indexName, query),
              );
              const cacheResults = await Promise.all(
                cacheKeys.map(key => this.getCachedSearchResult(key)),
              );

              // 🚀 OPTIMIZATION: Start searches and rank as results arrive (streaming)
              const searchPromises = allSearchQueries.map(async (query, index) => {
                try {
                  // 🚀 OPTIMIZATION: Use pre-fetched cache result
                  const cached = cacheResults[index];
                  if (cached) {
                    return cached;
                  }

                  // 🚀 AGGRESSIVE OPTIMIZATION: Execute with 500ms timeout
                  const result = await Promise.race([
                    this.executeSearch(indexName, query),
                    new Promise((_, reject) =>
                      setTimeout(() => reject(new Error('Search timeout')), 500),
                    ),
                  ]);

                  // 🚀 STREAMING OPTIMIZATION: Start ranking immediately for this result set
                  if (result?.data?.hits?.length > 0) {
                    const requestedSize = parseInt((searchQuery.size || '10').toString());
                    const totalResults = parseInt(result.data.total || '0');
                    const ranked = await this.tieredRankingService.rankResults(
                      result.data.hits,
                      query.query,
                      typoCorrection,
                      {
                        requestedSize,
                        totalResults,
                      },
                    );
                    return { ...result, data: { ...result.data, hits: ranked } };
                  }

                  // Cache the result for future requests
                  const resultCacheKey = this.redisCache.generateKey(indexName, query);
                  await this.cacheSearchResult(resultCacheKey, result);

                  return result;
                } catch (error) {
                  this.logger.warn(`⚠️ Search failed for "${query.query}": ${error.message}`);
                  return null;
                }
              });

              // 🚀 OPTIMIZATION: Wait for all results (they're already ranked as they arrive)
              const firstResults = await Promise.allSettled(searchPromises);

              // Process completed results immediately with proper error handling
              const allSearchResults = firstResults
                .filter(
                  result => result.status === 'fulfilled' && result.value && result.value.data,
                )
                .map(result => (result as PromiseFulfilledResult<any>).value);

              // OPTIMIZATION: Stream results instead of full merging with null safety
              const allHits = allSearchResults
                .filter(
                  result =>
                    result && result.data && result.data.hits && Array.isArray(result.data.hits),
                )
                .map(result => result.data.hits)
                .flat();

              // 🚀 OPTIMIZATION: Parallel chunked deduplication for large arrays
              const uniqueHits = await this.deduplicateHitsParallel(allHits);

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
            }
          } else if (highScoringSuggestions.length === 1 && !searchResults) {
            // Only run corrected query if we have exactly 1 suggestion AND no results yet
            // OPTIMIZATION: Add Redis caching for search results
            // Generate cache key using RedisCacheService for consistency
            const cacheKey = this.redisCache.generateKey(indexName, searchQueryToUse);

            const cachedResult = await this.getCachedSearchResult(cacheKey);

            if (!cachedResult) {
              searchResults = await this.executeSearch(indexName, searchQueryToUse);
              // Cache the result for future requests (5 minute TTL)
              await this.cacheSearchResult(cacheKey, searchResults);
            } else {
              this.logger.log(
                `📋 Cache HIT! Using cached search result for "${searchQueryToUse.query}"`,
              );
              searchResults = cachedResult;
            }
          }
        }
        // If searchResults is already set (from original query), skip the else block entirely

        // 🚀 OPTIMIZATION: Process geographic filtering and ranking in parallel
        let finalResults = searchResults;
        if (searchResults.data.hits.length > 0) {
          // Process geographic filtering and tiered ranking in parallel
          const geoFilterStart = Date.now();
          const [locationFiltered, rankedResults] = await Promise.all([
            // Geographic filtering (if location available)
            intelligentInfo?.locationResult?.hasLocation
              ? this.geographicFilterService.filterByLocation(
                  searchResults.data.hits,
                  intelligentInfo.locationResult,
                )
              : Promise.resolve(searchResults.data.hits),
            // Start tiered ranking immediately (doesn't depend on geographic filtering)
            (() => {
              const requestedSize = parseInt(searchQuery.size?.toString() || '10');
              const totalResults = parseInt(searchResults.data.total || '0');
              return this.tieredRankingService.rankResults(
                searchResults.data.hits,
                queryTextToUse,
                typoCorrection,
                {
                  ...intelligentInfo,
                  requestedSize,
                  totalResults,
                },
              );
            })(),
          ]);
          const geoFilterTime = Date.now() - geoFilterStart;

          // If geographic filtering was applied, sort by location relevance and merge with ranked results
          if (
            intelligentInfo?.locationResult?.hasLocation &&
            locationFiltered !== searchResults.data.hits
          ) {
            // locationFiltered is GeographicResult[], we need to pass original results array
            const locationRanked = this.geographicFilterService.sortByLocationRelevance(
              locationFiltered,
              searchResults.data.hits, // Pass original results array, not locationResult object
            );
            // Re-rank the location-filtered results to combine location and tiered ranking
            const requestedSize = parseInt(searchQuery.size?.toString() || '10');
            const totalResults = parseInt(searchResults.data.total || '0');
            const finalRanked = await this.tieredRankingService.rankResults(
              locationRanked,
              queryTextToUse,
              typoCorrection,
              {
                ...intelligentInfo,
                requestedSize,
                totalResults,
              },
            );
            finalResults = {
              ...searchResults,
              data: {
                ...searchResults.data,
                hits: finalRanked,
              },
            };
          } else {
            // Use tiered ranking results (no geographic filtering)
            finalResults = {
              ...searchResults,
              data: {
                ...searchResults.data,
                hits: rankedResults,
              },
            };
          }

          // 🎯 SLICE TO ORIGINAL REQUESTED SIZE: We fetched more for better ranking
          const originalSize =
            finalResults._originalSize || parseInt(searchQuery.size?.toString() || '10');
          const hitsToSlice = finalResults.data.hits;
          const slicedResults = hitsToSlice.slice(0, originalSize);

          finalResults = {
            ...finalResults,
            data: {
              ...finalResults.data,
              hits: slicedResults,
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
              const requestedSize = parseInt(searchQuery.size?.toString() || '10');
              const totalResults = parseInt(fallbackResults.data.total || '0');
              const fallbackRankedResults = await this.tieredRankingService.rankResults(
                fallbackResults.data.hits,
                simplifiedQuery,
                typoCorrection,
                {
                  ...intelligentInfo,
                  requestedSize,
                  totalResults,
                },
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
      }
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
      // Only process typo tolerance for queries longer than 2 characters
      if (!query || query.trim().length < 3) {
        return null;
      }

      // Since dictionary already determined this is a typo, use fast typo correction
      const fields = ['name', 'title', 'description', 'category_name', 'profile'];
      const typoCorrection = await this.typoToleranceService.correctQuery(indexName, query, fields);

      // Return if we have corrections or high-scoring suggestions
      if (
        (typoCorrection.corrections.length > 0 && typoCorrection.confidence > 0.1) ||
        (typoCorrection.suggestions.length > 0 && typoCorrection.suggestions[0].score > 400)
      ) {
        // If we have suggestions but no corrections, use the best suggestion
        if (typoCorrection.corrections.length === 0 && typoCorrection.suggestions.length > 0) {
          const bestSuggestion = typoCorrection.suggestions[0];
          typoCorrection.correctedQuery = bestSuggestion.text;
          typoCorrection.confidence = Math.min(0.95, bestSuggestion.score / 1000);
          typoCorrection.corrections = [
            {
              original: query,
              corrected: bestSuggestion.text,
              confidence: typoCorrection.confidence,
            },
          ];
        }

        return typoCorrection;
      }

      return null;
    } catch (error) {
      this.logger.error(`❌ Typo tolerance processing failed: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Execute the actual search with AGGRESSIVE optimization
   * Fetches more candidates for better health-based ranking
   */
  private async executeSearch(indexName: string, searchQuery: SearchQueryDto): Promise<any> {
    const startTime = Date.now();

    try {
      // 🎯 QUALITY OPTIMIZATION: Fetch more candidates for multi-signal re-ranking
      // This allows health/rating to influence results without slowing down queries
      const originalSize = parseInt(searchQuery.size?.toString() || '10');
      const fetchMultiplier = 3; // Fetch 3x more for better ranking pool (balanced speed vs quality)
      const expandedQuery = {
        ...searchQuery,
        size: Math.min(originalSize * fetchMultiplier, 75), // Cap at 75 to optimize speed
      };

      // 🚀 OPTIMIZED: Increase timeout to 10 seconds for production reliability
      const result = await Promise.race([
        this.postgresSearchEngine.search(indexName, expandedQuery),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PostgreSQL search timeout')), 10000),
        ),
      ]);

      const searchTime = Date.now() - startTime;
      if (searchTime > 500) {
        const queryText = this.getQueryText(searchQuery);
        this.logger.warn(`⚠️ Slow search detected: ${searchTime}ms for "${queryText}"`);
      }

      // Store original requested size for later slicing after multi-signal ranking
      result._originalSize = originalSize;

      return result;
    } catch (error) {
      const searchTime = Date.now() - startTime;
      this.logger.error(`❌ PostgreSQL search failed after ${searchTime}ms: ${error.message}`);

      // 🚀 AGGRESSIVE OPTIMIZATION: Use ultra-fast fallback search
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
      const query = this.getQueryText(searchQuery);

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

      // Add timeout to ultra-fast query
      const results = await Promise.race([
        this.dataSource.query(ultraFastQuery, [indexName, query]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Ultra-fast query timeout')), 3000),
        ),
      ]);

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
      const query = this.getQueryText(searchQuery);

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
    if (!this.cacheEnabled) {
      return null;
    }

    try {
      const cached = await this.redisCache.get(cacheKey);
      if (cached) {
        this.logger.log(`✅ Cache HIT for key: ${cacheKey}`);
      }
      return cached;
    } catch (error) {
      this.logger.warn(`⚠️ Cache retrieval failed for key ${cacheKey}: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache search result in Redis
   */
  private async cacheSearchResult(cacheKey: string, result: any): Promise<void> {
    if (!this.cacheEnabled) {
      return;
    }

    try {
      await this.redisCache.set(cacheKey, result, this.cacheTtl);
    } catch (error) {
      this.logger.warn(`⚠️ Cache storage failed for key ${cacheKey}: ${error.message}`);
    }
  }

  /**
   * Parallel chunked deduplication for large arrays
   */
  private async deduplicateHitsParallel(hits: any[]): Promise<any[]> {
    // Fast path for small arrays
    if (hits.length <= 100) {
      return this.deduplicateHitsSequential(hits);
    }

    // Parallel chunked deduplication for large arrays
    const chunkSize = Math.max(100, Math.ceil(hits.length / 4)); // 4 parallel chunks
    const chunks: any[][] = [];

    for (let i = 0; i < hits.length; i += chunkSize) {
      chunks.push(hits.slice(i, i + chunkSize));
    }

    // Process chunks in parallel
    const chunkResults = await Promise.all(
      chunks.map(async chunk => {
        return new Promise<Array<{ id: string; hit: any }>>(resolve => {
          setImmediate(() => {
            const seen = new Set<string>();
            const unique: Array<{ id: string; hit: any }> = [];

            for (const hit of chunk) {
              if (hit.id && !seen.has(hit.id)) {
                seen.add(hit.id);
                unique.push({ id: hit.id, hit });
              }
            }
            resolve(unique);
          });
        });
      }),
    );

    // Merge chunk results and deduplicate across chunks
    const finalSeen = new Set<string>();
    const uniqueHits: any[] = [];

    for (const chunkResult of chunkResults) {
      for (const { id, hit } of chunkResult) {
        if (!finalSeen.has(id)) {
          finalSeen.add(id);
          uniqueHits.push(hit);
        }
      }
    }

    return uniqueHits.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  /**
   * Sequential deduplication for small arrays
   */
  private deduplicateHitsSequential(hits: any[]): any[] {
    const seenIds = new Set();
    const uniqueHits: any[] = [];

    for (const hit of hits) {
      if (hit.id && !seenIds.has(hit.id)) {
        seenIds.add(hit.id);
        uniqueHits.push(hit);
      }
    }

    return uniqueHits.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  /**
   * Merge and deduplicate search results by document ID (legacy method)
   */
  private mergeAndDeduplicateHits(hits: any[]): any[] {
    return this.deduplicateHitsSequential(hits);
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
