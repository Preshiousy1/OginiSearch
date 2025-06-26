import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { IndexService } from '../index/index.service';
import { QueryProcessorService } from './query-processor.service';
import { SearchQueryDto, SuggestQueryDto, SearchResponseDto } from '../api/dtos/search.dto';
import { SearchExecutorService } from './search-executor.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { QueryExecutionPlan, RawQuery } from './interfaces/query-processor.interface';
import { SearchQuery } from './interfaces/query-processor.interface';
import { SearchRequest, SearchResponse } from './interfaces/search.interface';

interface WildcardConfig {
  value: string;
  boost?: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly indexService: IndexService,
    private readonly queryProcessor: QueryProcessorService,
    private readonly searchExecutor: SearchExecutorService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
  ) {}

  async search(
    indexName: string,
    searchQuery: SearchQueryDto,
  ): Promise<Partial<SearchResponseDto>> {
    this.logger.log(`Searching in index ${indexName}: ${JSON.stringify(searchQuery.query)}`);

    try {
      // Get index
      const index = await this.indexService.getIndex(indexName);
      if (!index) {
        throw new NotFoundException(`Index ${indexName} not found`);
      }

      // Convert search query to internal format
      const { executionPlan, options, startTime } = this.convertToSearchRequest(searchQuery);

      // Execute search
      const searchResult = await this.searchExecutor.executeQuery(
        indexName,
        executionPlan,
        options,
      );

      // Format response
      const response = {
        data: {
          total: searchResult.totalHits,
          maxScore: searchResult.maxScore,
          hits: searchResult.hits.map(hit => ({
            id: hit.id,
            index: indexName,
            score: hit.score,
            source: hit.document,
          })),
        },
        took: Date.now() - startTime,
      };

      return response;
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`, error.stack);
      throw new BadRequestException(`Search error: ${error.message}`);
    }
  }

  private convertToSearchRequest(dto: SearchQueryDto): {
    executionPlan: QueryExecutionPlan;
    options: any;
    startTime: number;
  } {
    const startTime = Date.now();

    // Handle wildcard query
    const wildcardQuery =
      typeof dto.query === 'object' && dto.query?.wildcard
        ? typeof dto.query.wildcard === 'string'
          ? dto.query.wildcard
          : 'field' in dto.query.wildcard
          ? {
              field: dto.query.wildcard.field,
              value: dto.query.wildcard.value,
              boost: dto.query.wildcard.boost,
            }
          : {
              field: Object.keys(dto.query.wildcard)[0],
              ...Object.values(dto.query.wildcard)[0],
            }
        : undefined;

    const rawQuery: RawQuery = {
      type: typeof dto.query === 'string' ? 'term' : 'object',
      value: typeof dto.query === 'string' ? dto.query : undefined,
      query:
        typeof dto.query === 'string'
          ? undefined
          : {
              match: dto.query?.match && {
                field: dto.query.match.field,
                value: dto.query.match.value,
              },
              term: dto.query?.term,
              wildcard: wildcardQuery,
              match_all: dto.query?.match_all,
            },
      fields: dto.fields,
    };

    const processedQuery = this.queryProcessor.processQuery(rawQuery);

    return {
      executionPlan: processedQuery.executionPlan,
      options: {
        from: dto.from || 0,
        size: dto.size || 10,
        sort: dto.sort,
        filter: dto.filter,
      },
      startTime,
    };
  }

  private normalizeWildcardQuery(wildcard: any): { field?: string; value: string; boost?: number } {
    if (typeof wildcard === 'string') {
      return {
        field: '_all',
        value: wildcard,
      };
    }

    if ('field' in wildcard && 'value' in wildcard) {
      return {
        field: wildcard.field,
        value: wildcard.value,
        boost: wildcard.boost,
      };
    }

    const [field, config] = Object.entries(wildcard)[0] as [string, WildcardConfig];
    return {
      field,
      value: config.value,
      boost: config.boost,
    };
  }

  async suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<any[]> {
    this.logger.log(`Getting suggestions in ${indexName} for: ${suggestQuery.text}`);

    // Check if index exists
    try {
      await this.indexService.getIndex(indexName);
    } catch (error) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }

    try {
      const field = suggestQuery.field || '_all';
      const size = suggestQuery.size || 5;
      const inputText = suggestQuery.text.toLowerCase();
      const allTerms = this.termDictionary.getTerms();

      // Get all terms for the specified field
      const fieldTerms = allTerms.filter(term => term.startsWith(`${field}:`));

      // Structure to hold our suggestions with scores
      interface Suggestion {
        text: string;
        score: number;
        freq: number;
        distance: number;
      }

      const suggestions = new Map<string, Suggestion>();

      // Process each term
      for (const term of fieldTerms) {
        const actualTerm = term.split(':')[1];

        // Skip if the term is too short
        if (actualTerm.length < 2) continue;

        // Calculate Levenshtein distance for fuzzy matching
        const distance = this.levenshteinDistance(inputText, actualTerm);
        const maxDistance = Math.min(3, Math.floor(actualTerm.length / 3));

        // Consider terms that either:
        // 1. Start with the input text (prefix match)
        // 2. Are within acceptable edit distance (fuzzy match)
        // 3. Contain the input text (substring match)
        if (
          actualTerm.startsWith(inputText) ||
          distance <= maxDistance ||
          actualTerm.includes(inputText)
        ) {
          const postingList = await this.termDictionary.getPostingList(term);
          const freq = postingList ? postingList.size() : 0;

          // Calculate score based on multiple factors
          let score = 0;

          // Prefix matches get highest base score
          if (actualTerm.startsWith(inputText)) {
            score += 100;
          }

          // Exact matches get perfect score
          if (actualTerm === inputText) {
            score += 200;
          }

          // Substring matches get medium score
          if (actualTerm.includes(inputText) && !actualTerm.startsWith(inputText)) {
            score += 50;
          }

          // Adjust score based on edit distance (closer = better)
          score += maxDistance - distance;

          // Adjust score based on term frequency (more frequent = better)
          score += Math.log1p(freq) * 10;

          // Adjust score based on length difference (closer to input length = better)
          const lengthDiff = Math.abs(actualTerm.length - inputText.length);
          score -= lengthDiff * 2;

          suggestions.set(actualTerm, {
            text: actualTerm,
            score,
            freq,
            distance,
          });
        }
      }

      // Convert to array and sort by score
      const sortedSuggestions = Array.from(suggestions.values())
        .sort((a, b) => {
          // First by score
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;

          // Then by frequency if scores are equal
          const freqDiff = b.freq - a.freq;
          if (freqDiff !== 0) return freqDiff;

          // Finally by edit distance if both score and freq are equal
          return a.distance - b.distance;
        })
        .slice(0, size);

      return sortedSuggestions;
    } catch (error) {
      this.logger.error(`Suggestion error: ${error.message}`);
      throw new BadRequestException(`Suggestion error: ${error.message}`);
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   * This helps in finding similar terms for fuzzy matching
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] =
            Math.min(
              dp[i - 1][j - 1], // substitution
              dp[i - 1][j], // deletion
              dp[i][j - 1], // insertion
            ) + 1;
        }
      }
    }

    return dp[m][n];
  }

  private getHighlights(hit: any, queryText: string): Record<string, string[]> {
    const highlights: Record<string, string[]> = {};

    // Extract text from content fields
    const content = hit.document?.content;
    if (!content) return highlights;

    // Create simple highlights by finding the query terms in the content
    const terms = queryText.toLowerCase().split(/\s+/);

    Object.entries(content).forEach(([field, value]) => {
      if (typeof value === 'string') {
        const matches = terms
          .map(term => {
            const regex = new RegExp(`(.{0,50})${term}(.{0,50})`, 'gi');
            const match = regex.exec(value);
            return match ? `...${match[1]}${match[0]}${match[2]}...` : null;
          })
          .filter(Boolean);

        if (matches.length > 0) {
          highlights[field] = matches;
        }
      }
    });

    return highlights;
  }

  private getFacets(results: any, facetFields: string[]): Record<string, any> {
    const facets: Record<string, any> = {};

    for (const field of facetFields) {
      const buckets = [];
      const valueCount = new Map<string, number>();

      // Count occurrences of each value for the facet field
      for (const hit of results.hits) {
        if (hit.document[field]) {
          const value = hit.document[field].toString();
          valueCount.set(value, (valueCount.get(value) || 0) + 1);
        }
      }

      // Convert to buckets
      for (const [key, count] of valueCount.entries()) {
        buckets.push({ key, count });
      }

      // Sort by count (descending)
      buckets.sort((a, b) => b.count - a.count);

      facets[field] = { buckets };
    }

    return facets;
  }

  async getTermStats(indexName: string): Promise<Array<{ term: string; freq: number }>> {
    const terms = this.termDictionary.getTerms();
    const stats = await Promise.all(
      terms.map(async term => {
        const postingList = await this.termDictionary.getPostingList(term);
        return {
          term,
          freq: postingList ? postingList.size() : 0,
        };
      }),
    );
    return stats;
  }

  async clearDictionary(indexName: string): Promise<{ message: string }> {
    this.logger.log(`Clearing term dictionary for index ${indexName}`);

    try {
      // Check if index exists
      await this.indexService.getIndex(indexName);

      // Call cleanup on the term dictionary
      await this.termDictionary.cleanup();

      return { message: 'Term dictionary cleared successfully' };
    } catch (error) {
      this.logger.error(`Error clearing term dictionary: ${error.message}`);
      throw new BadRequestException(`Error clearing term dictionary: ${error.message}`);
    }
  }
}
