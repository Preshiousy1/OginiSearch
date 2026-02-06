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
  SearchQuery,
  WildcardQueryStep,
  MatchAllQueryStep,
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
    const parsedQuery = this.parseQuery(rawQuery);
    const executionPlan = this.queryPlanner.createPlan(parsedQuery as Query);

    return {
      original: rawQuery,
      parsedQuery: parsedQuery as Query,
      executionPlan,
    };
  }

  /**
   * Parse raw query string into structured query objects
   */
  private parseQuery(rawQuery: RawQuery): SearchQuery {
    // Handle string queries
    if (typeof rawQuery.query === 'string') {
      return this.parseStringQuery(rawQuery);
    }

    // Handle object queries
    if (rawQuery.query) {
      // Handle wildcard query
      if (rawQuery.query.wildcard) {
        if (typeof rawQuery.query.wildcard === 'string') {
          return this.createWildcardQuery(
            {
              field: '_all',
              value: rawQuery.query.wildcard,
            },
            rawQuery.fields || ['_all'],
          );
        } else {
          return this.createWildcardQuery(rawQuery.query.wildcard, rawQuery.fields || ['_all']);
        }
      }

      // Handle match query
      if (rawQuery.query.match) {
        return this.parseMatchQuery(rawQuery);
      }

      // Handle term query
      if (rawQuery.query.term) {
        return this.parseTermQuery(rawQuery);
      }

      // Handle match_all query
      if (rawQuery.query.match_all !== undefined) {
        return this.createMatchAllQuery(rawQuery);
      }
    }

    // Default fallback
    return this.createMatchAllQuery(rawQuery);
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
    // Guard against undefined/null values
    if (!query || typeof query !== 'string') {
      return false;
    }
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
    wildcardDto: { field?: string; value: string; boost?: number } | Record<string, any>,
    fields?: string[],
  ): WildcardQuery {
    // Handle direct wildcard query format
    if ('value' in wildcardDto) {
      const field = wildcardDto.field || (fields && fields[0]) || '_all';
      return {
        type: 'wildcard',
        field,
        pattern: wildcardDto.value,
        value: wildcardDto.value,
        boost: wildcardDto.boost,
        fields: fields,
      };
    }

    // Handle field-specific wildcard format: { "title": { "value": "smart*" } }
    const entries = Object.entries(wildcardDto);
    if (entries.length > 0) {
      const [field, config] = entries[0];
      const value = typeof config === 'string' ? config : config.value;
      const boost = typeof config === 'object' ? config.boost : undefined;
      return {
        type: 'wildcard',
        field,
        pattern: value,
        value,
        boost,
        fields: fields,
      };
    }

    // Fallback
    return {
      type: 'wildcard',
      field: '_all',
      pattern: '*',
      value: '*',
      fields: fields,
    };
  }

  /**
   * Parse match queries
   */
  private parseMatchQuery(rawQuery: RawQuery): SearchQuery {
    const { text, fields } = this.extractQueryTextAndFields(rawQuery);

    // Check if the match query value is actually a wildcard pattern
    if (this.isWildcardQuery(text)) {
      // Create proper wildcard query object
      const wildcardField = (rawQuery.query as any)?.match?.field || fields[0] || '_all';

      const wildcardQueryObj = {
        field: wildcardField,
        value: text,
        boost: (rawQuery.query as any)?.match?.boost,
      };

      const result = this.createWildcardQuery(wildcardQueryObj, fields);
      return result;
    }

    // Check for match-all pattern in match query
    if (text.trim() === '*' || text.trim() === '') {
      return this.createMatchAllQuery(rawQuery);
    }

    // Split the text into terms
    const analyzer = this.analyzerRegistryService.getAnalyzer('standard');
    const terms = analyzer.analyze(text);

    // If we have multiple terms, create a boolean query
    if (terms.length > 1) {
      const clauses: TermQuery[] = terms.map(term => ({
        type: 'term',
        field: fields[0],
        value: term,
      }));

      return {
        type: 'boolean',
        operator: 'and',
        clauses,
      };
    }

    // Single term query
    return this.createTermQuery(fields[0], terms[0] || text);
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
  private extractQueryTextAndFields(rawQuery: RawQuery): { text: string; fields: string[] } {
    // Handle string queries
    if (typeof rawQuery.query === 'string') {
      return { text: rawQuery.query, fields: rawQuery.fields || ['content'] };
    }

    // Handle match queries - support multiple formats
    if (rawQuery.query?.match) {
      // Format 1: {"match": {"field": "value", "value": "text"}} (custom format)
      if (rawQuery.query.match.field && rawQuery.query.match.value) {
        return {
          text: rawQuery.query.match.value,
          fields: [rawQuery.query.match.field],
        };
      }

      // Format 2: {"match": {"field_name": "value"}} (Elasticsearch standard format)
      const matchEntries = Object.entries(rawQuery.query.match);
      if (matchEntries.length > 0) {
        const [field, value] = matchEntries[0];
        // Handle both string value and object value formats
        const textValue =
          typeof value === 'object' && value !== null && (value as any).query
            ? String((value as any).query)
            : String(value);
        return { text: textValue, fields: [field] };
      }

      // Fallback to default
      return {
        text: '',
        fields: rawQuery.fields || ['content'],
      };
    }

    // Handle term queries - support both formats
    if (rawQuery.query?.term) {
      const entries = Object.entries(rawQuery.query.term);
      if (entries.length > 0) {
        const [field, value] = entries[0];
        // Handle both simple format: {"title": "client"} and object format: {"title": {"value": "client"}}
        const termValue =
          typeof value === 'object' && value !== null && 'value' in value
            ? String((value as any).value)
            : String(value);
        return { text: termValue, fields: [field] };
      }
    }

    // Handle wildcard queries - support both formats
    if (rawQuery.query?.wildcard) {
      // Handle object format: {"field": "title", "value": "client*"}
      if (
        typeof rawQuery.query.wildcard === 'object' &&
        'field' in rawQuery.query.wildcard &&
        'value' in rawQuery.query.wildcard
      ) {
        return {
          text: rawQuery.query.wildcard.value,
          fields: [rawQuery.query.wildcard.field],
        };
      }
      // Handle field-specific format: {"title": {"value": "client*"}}
      else if (
        typeof rawQuery.query.wildcard === 'object' &&
        !('field' in rawQuery.query.wildcard)
      ) {
        const entries = Object.entries(rawQuery.query.wildcard);
        if (entries.length > 0) {
          const [field, config] = entries[0];
          const wildcardValue = typeof config === 'string' ? config : (config as any).value;
          return {
            text: wildcardValue,
            fields: [field],
          };
        }
      }
      // Handle simple string format: "client*"
      else if (typeof rawQuery.query.wildcard === 'string') {
        return {
          text: rawQuery.query.wildcard,
          fields: rawQuery.fields || ['content'],
        };
      }
    }

    // Handle match-all queries
    if (rawQuery.query?.match_all) {
      return { text: '*', fields: rawQuery.fields || ['content'] };
    }

    // Handle new format
    if (rawQuery.value !== undefined) {
      const text = typeof rawQuery.value === 'string' ? rawQuery.value : '';
      const fields = Array.isArray(rawQuery.fields)
        ? rawQuery.fields
        : typeof rawQuery.fields === 'string'
        ? [rawQuery.fields]
        : rawQuery.fields || ['content'];

      return { text, fields };
    }

    // Default to empty query if none of the above formats match
    return { text: '', fields: rawQuery.fields || ['content'] };
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
  private createTermQuery(field: string, value: string): TermQuery {
    // Apply analyzer to term
    const analyzer = this.analyzerRegistryService.getAnalyzer('standard');
    const analyzedTerms = analyzer.analyze(value);

    // Use first analyzed term or original if analysis yields nothing
    const analyzedTerm = analyzedTerms.length > 0 ? analyzedTerms[0] : value;

    return {
      type: 'term',
      field,
      value: analyzedTerm.toLowerCase(), // Ensure term is lowercase for consistency
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

  private processRawQuery(rawQuery: RawQuery): SearchQuery {
    if (rawQuery.type === 'match_all') {
      return this.createMatchAllQuery(rawQuery);
    }

    if (typeof rawQuery.query === 'string') {
      // Handle simple text query
      return {
        type: 'term',
        field: Array.isArray(rawQuery.fields) ? rawQuery.fields[0] : rawQuery.fields?.[0] || '_all',
        value: rawQuery.query,
      };
    }

    if (rawQuery.query?.match_all) {
      return this.createMatchAllQuery(rawQuery.query.match_all);
    }

    if (rawQuery.query?.wildcard) {
      const wildcardQuery = rawQuery.query.wildcard as { value: string; boost?: number } | string;
      const wildcardValue = typeof wildcardQuery === 'string' ? wildcardQuery : wildcardQuery.value;
      const wildcardBoost = typeof wildcardQuery === 'string' ? undefined : wildcardQuery.boost;

      return {
        type: 'wildcard',
        field: '_all',
        pattern: wildcardValue,
        value: wildcardValue,
        boost: wildcardBoost,
      };
    }

    // Default to term query
    return {
      type: 'term',
      field: Array.isArray(rawQuery.fields) ? rawQuery.fields[0] : rawQuery.fields?.[0] || '_all',
      value: rawQuery.value || '',
    };
  }

  private processMatchAllQuery(query: { boost?: number }): MatchAllQueryStep {
    return {
      type: 'match_all',
      boost: query?.boost || 1.0,
      cost: 1.0,
    };
  }

  private processWildcardQuery(query: any): WildcardQueryStep {
    let field = '_all';
    let value = '';
    let boost = 1.0;

    if (typeof query === 'object') {
      if ('field' in query) {
        // Handle WildcardQueryDto format
        field = query.field || '_all';
        value = query.value;
        boost = query.boost || 1.0;
      } else {
        // Handle Record<string, { value: string; boost?: number }> format
        const [fieldName, config] = Object.entries(query)[0];
        field = fieldName;
        value = (config as { value: string }).value;
        boost = (config as { boost?: number }).boost || 1.0;
      }
    }

    // Create regex pattern for wildcard matching
    const pattern = value
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const compiledPattern = new RegExp(`^${pattern}$`, 'i');

    return {
      type: 'wildcard',
      field,
      pattern: value,
      compiledPattern,
      cost: 2.0 * boost, // Wildcard queries are more expensive than exact matches
    };
  }
}
