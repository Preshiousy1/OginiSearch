import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { IndexService } from '../index/index.service';
import { QueryProcessorService } from './query-processor.service';
import { SearchQueryDto, SuggestQueryDto, SearchResponseDto } from '../api/dtos/search.dto';
import { SearchExecutorService } from './search-executor.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { RawQuery } from './interfaces/query-processor.interface';

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

    // Check if index exists
    try {
      await this.indexService.getIndex(indexName);
    } catch (error) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }

    try {
      const startTime = Date.now();

      // Prepare raw query format for the query processor
      const rawQuery: RawQuery = {
        query: searchQuery.query,
        fields: searchQuery.fields,
        offset: searchQuery.from,
        limit: searchQuery.size,
        filters: searchQuery.filter,
      };

      // Process the query
      const processedQuery = await this.queryProcessor.processQuery(rawQuery);

      this.logger.debug(`Processed query: ${JSON.stringify(processedQuery)}`);

      // Execute the search
      const results = await this.searchExecutor.executeQuery(
        indexName,
        processedQuery.executionPlan,
        {
          from: searchQuery.from || 0,
          size: searchQuery.size || 10,
          sort: searchQuery.sort,
          filter: searchQuery.filter,
        },
      );

      // Format results
      const formattedResults = {
        data: {
          total: results.totalHits,
          maxScore: results.maxScore,
          hits: results.hits.map(hit => ({
            id: hit.id,
            index: indexName,
            score: hit.score,
            source: hit.document,
            highlight:
              searchQuery.highlight && processedQuery.parsedQuery.text
                ? this.getHighlights(hit, processedQuery.parsedQuery.text)
                : undefined,
          })),
        },
        took: Date.now() - startTime, // Add processing time in milliseconds
      };

      // Add facets if requested
      if (searchQuery.facets && searchQuery.facets.length > 0) {
        formattedResults['facets'] = this.getFacets(results, searchQuery.facets);
      }

      return formattedResults;
    } catch (error) {
      this.logger.error(`Search error: ${error.message}`);
      throw new BadRequestException(`Search error: ${error.message}`);
    }
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
    // Simple highlight implementation
    const highlights: Record<string, string[]> = {};
    const queryTerms = queryText.toLowerCase().split(/\s+/);

    for (const [field, value] of Object.entries(hit.document)) {
      if (typeof value === 'string') {
        const fieldValue = value.toString();
        let hasMatch = false;

        for (const term of queryTerms) {
          if (fieldValue.toLowerCase().includes(term)) {
            hasMatch = true;
            const regex = new RegExp(`(${term})`, 'gi');
            const highlighted = fieldValue.replace(regex, '<em>$1</em>');

            if (!highlights[field]) {
              highlights[field] = [];
            }

            highlights[field].push(highlighted);
            break;
          }
        }
      }
    }

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
}
