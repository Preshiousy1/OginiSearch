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
      // Get field-specific terms that start with the prefix
      const field = suggestQuery.field || '_all';
      const allTerms = this.termDictionary.getTerms();
      const fieldPrefix = `${field}:${suggestQuery.text.toLowerCase()}`;

      const matchingTerms = allTerms
        .filter(term => term.startsWith(fieldPrefix))
        .map(term => {
          const actualTerm = term.split(':')[1];
          const postingList = this.termDictionary.getPostingList(term);

          return {
            text: actualTerm,
            score: 1.0 / (1 + allTerms.indexOf(term)), // Simple scoring based on term frequency
            freq: postingList.size(),
          };
        })
        .sort((a, b) => b.freq - a.freq)
        .slice(0, suggestQuery.size || 5);

      return matchingTerms;
    } catch (error) {
      this.logger.error(`Suggestion error: ${error.message}`);
      throw new BadRequestException(`Suggestion error: ${error.message}`);
    }
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
}
