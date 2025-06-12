import { Injectable } from '@nestjs/common';
import {
  QueryProcessor,
  RawQuery,
  ProcessedQuery,
  Query,
  TermQuery,
  PhraseQuery,
  BooleanQuery,
  WildcardQuery,
  MatchAllQuery,
  QueryExecutionPlan,
} from './interfaces/query-processor.interface';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { QueryPlannerService } from './query-planner.service';

@Injectable()
export class QueryProcessorService implements QueryProcessor {
  constructor(
    private readonly analyzerRegistryService: AnalyzerRegistryService,
    private readonly queryPlanner: QueryPlannerService,
  ) {}

  /**
   * Process a raw query into structured query objects
   */
  processQuery(rawQuery: RawQuery): ProcessedQuery {
    // Parse and normalize query
    const parsedQuery = this.parseQuery(rawQuery);

    // Create execution plan
    const executionPlan = this.queryPlanner.createPlan(parsedQuery);

    return {
      original: rawQuery,
      parsedQuery,
      executionPlan,
    };
  }

  /**
   * Parse raw query string into structured query objects
   */
  private parseQuery(rawQuery: RawQuery): Query {
    // Handle string queries first
    if (typeof rawQuery.query === 'string') {
      return this.parseStringQuery(rawQuery);
    }

    // Handle object queries
    if (rawQuery.query.match_all) {
      return this.createMatchAllQuery(rawQuery.query.match_all);
    }

    if (rawQuery.query.wildcard) {
      return this.createWildcardQuery(rawQuery.query.wildcard, rawQuery.fields);
    }

    if (rawQuery.query.match) {
      return this.parseMatchQuery(rawQuery);
    }

    if (rawQuery.query.term) {
      return this.parseTermQuery(rawQuery);
    }

    // Default to empty boolean query
    return {
      type: 'boolean',
      operator: 'or',
      clauses: [],
    };
  }

  /**
   * Parse string queries (including wildcard detection)
   */
  private parseStringQuery(rawQuery: RawQuery): Query {
    const queryText = rawQuery.query as string;
    const fields = rawQuery.fields || ['_all'];

    // Check for match-all pattern FIRST (before wildcard check)
    if (queryText.trim() === '*' || queryText.trim() === '') {
      return this.createMatchAllQuery({});
    }

    // Check for wildcard patterns
    if (this.isWildcardQuery(queryText)) {
      return this.createWildcardQuery({ value: queryText }, fields);
    }

    // Regular string query processing
    const { text } = this.extractQueryTextAndFields(rawQuery);
    return this.parseRegularStringQuery(text, fields);
  }

  /**
   * Check if a query string contains wildcard patterns
   */
  private isWildcardQuery(query: string): boolean {
    return query.includes('*') || query.includes('?');
  }

  /**
   * Create a match-all query
   */
  private createMatchAllQuery(matchAllDto: { boost?: number }): MatchAllQuery {
    return {
      type: 'match_all',
      boost: matchAllDto.boost || 1.0,
    };
  }

  /**
   * Create a wildcard query
   */
  private createWildcardQuery(
    wildcardDto: { value: string; boost?: number; field?: string } | Record<string, any>,
    fields?: string[],
  ): WildcardQuery {
    // Handle direct wildcard query format
    if ('value' in wildcardDto) {
      return {
        type: 'wildcard',
        field: wildcardDto.field || (fields && fields[0]) || '_all',
        value: wildcardDto.value,
      };
    }

    // Handle field-specific wildcard format: { "title": { "value": "smart*" } }
    const entries = Object.entries(wildcardDto);
    if (entries.length > 0) {
      const [field, config] = entries[0];
      const value = typeof config === 'string' ? config : config.value;
      return {
        type: 'wildcard',
        field,
        value,
      };
    }

    // Fallback
    return {
      type: 'wildcard',
      field: '_all',
      value: '*',
    };
  }

  /**
   * Parse match queries
   */
  private parseMatchQuery(rawQuery: RawQuery): Query {
    const { text, fields } = this.extractQueryTextAndFields(rawQuery);

    // Check if the match query value is actually a wildcard pattern
    if (this.isWildcardQuery(text)) {
      return this.createWildcardQuery({ value: text }, fields);
    }

    // Check for match-all pattern in match query
    if (text.trim() === '*' || text.trim() === '') {
      return this.createMatchAllQuery({});
    }

    return this.parseRegularStringQuery(text, fields);
  }

  /**
   * Parse term queries
   */
  private parseTermQuery(rawQuery: RawQuery): Query {
    const { text, fields } = this.extractQueryTextAndFields(rawQuery);
    return this.parseRegularStringQuery(text, fields);
  }

  /**
   * Parse regular string queries (existing logic)
   */
  private parseRegularStringQuery(text: string, fields: string[]): Query {
    // Normalize query string
    const normalizedQuery = this.normalizeQuery(text);

    // Extract phrases (terms in quotes)
    const phrases = this.extractPhrases(text);

    // Remove phrases from the query for term processing
    let termText = normalizedQuery;
    for (const phrase of phrases) {
      termText = termText.replace(`"${phrase}"`, '');
    }

    // Split remaining text into terms
    const terms = termText.split(' ').filter(term => term.length > 0);

    // If we have multiple terms/phrases, create a boolean query
    if (terms.length > 1 || phrases.length > 0 || fields.length > 1) {
      const clauses: Query[] = [];

      // Add term queries for each field
      for (const term of terms) {
        for (const field of fields) {
          const termQuery = this.createTermQuery(field, term);
          clauses.push(termQuery);
        }
      }

      // Add phrase queries for each field
      for (const phrase of phrases) {
        for (const field of fields) {
          clauses.push(this.createPhraseQuery(field, phrase));
        }
      }

      return {
        type: 'boolean',
        operator: 'or',
        clauses,
        text,
        fields,
      };
    }
    // If we only have one term and one field, return a simple term query
    else if (terms.length === 1) {
      const termQuery = this.createTermQuery(fields[0], terms[0]);
      return termQuery;
    }

    // Empty query - return empty boolean
    return {
      type: 'boolean',
      operator: 'or',
      clauses: [],
    };
  }

  /**
   * Extract query text and fields from raw query
   */
  extractQueryTextAndFields(rawQuery: RawQuery): { text: string; fields: string[] } {
    // Handle string queries
    if (typeof rawQuery.query === 'string') {
      return { text: rawQuery.query, fields: rawQuery.fields || ['_all'] };
    }

    // Handle object queries
    if (rawQuery.query.match) {
      const field = rawQuery.query.match.field;
      return {
        text: rawQuery.query.match.value,
        fields: field ? [field] : rawQuery.fields || ['_all'],
      };
    }

    // Handle term queries
    if (rawQuery.query.term) {
      const entries = Object.entries(rawQuery.query.term);
      if (entries.length > 0) {
        const [field, value] = entries[0];
        return { text: String(value), fields: [field] };
      }
    }

    // Default to empty query if none of the above formats match
    return { text: '', fields: rawQuery.fields || ['_all'] };
  }

  /**
   * Normalize query string
   */
  private normalizeQuery(query: string): string {
    if (!query) return '';

    // Basic normalization: lowercase and normalize spaces
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract quoted phrases from query
   */
  private extractPhrases(query: string): string[] {
    const phrases: string[] = [];
    const phraseRegex = /"([^"]*)"/g;

    let match;
    while ((match = phraseRegex.exec(query)) !== null) {
      if (match[1].trim().length > 0) {
        phrases.push(match[1].trim());
      }
    }

    return phrases;
  }

  /**
   * Create a term query with analyzer applied
   */
  private createTermQuery(field: string, term: string): TermQuery {
    // Apply analyzer to term
    const analyzer = this.analyzerRegistryService.getAnalyzer('standard');
    const analyzedTerms = analyzer.analyze(term);

    // Use first analyzed term or original if analysis yields nothing
    const analyzedTerm = analyzedTerms.length > 0 ? analyzedTerms[0] : term;

    return {
      type: 'term',
      field,
      value: analyzedTerm,
    };
  }

  /**
   * Create a phrase query with analyzer applied to each term
   */
  private createPhraseQuery(field: string, phrase: string): PhraseQuery {
    // Apply analyzer to phrase
    const analyzer = this.analyzerRegistryService.getAnalyzer('standard');
    const analyzedTerms = analyzer.analyze(phrase);

    return {
      type: 'phrase',
      field,
      terms: analyzedTerms.length > 0 ? analyzedTerms : [phrase],
    };
  }
}
