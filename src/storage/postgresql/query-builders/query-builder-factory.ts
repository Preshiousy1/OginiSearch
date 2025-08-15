import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder } from './base-query-builder';
import { MatchQueryBuilder } from './match-query-builder';
import { TermQueryBuilder } from './term-query-builder';
import { WildcardQueryBuilder } from './wildcard-query-builder';
import { BoolQueryBuilder } from './bool-query-builder';
import { MatchAllQueryBuilder } from './match-all-query-builder';

@Injectable()
export class QueryBuilderFactory {
  constructor(
    private readonly matchQueryBuilder: MatchQueryBuilder,
    private readonly termQueryBuilder: TermQueryBuilder,
    private readonly wildcardQueryBuilder: WildcardQueryBuilder,
    private readonly boolQueryBuilder: BoolQueryBuilder,
    private readonly matchAllQueryBuilder: MatchAllQueryBuilder,
  ) {}

  create(query: any): BaseQueryBuilder {
    if (typeof query === 'string') {
      return this.matchQueryBuilder;
    }

    if (query.match) {
      return this.matchQueryBuilder;
    }

    if (query.term) {
      return this.termQueryBuilder;
    }

    if (query.wildcard) {
      return this.wildcardQueryBuilder;
    }

    if (query.bool) {
      return this.boolQueryBuilder;
    }

    if (query.match_all) {
      return this.matchAllQueryBuilder;
    }

    // Default fallback
    return this.matchAllQueryBuilder;
  }

  /**
   * Determine query type for logging/analytics
   */
  getQueryType(query: any): string {
    if (typeof query === 'string') return 'match';
    if (query.match) return 'match';
    if (query.term) return 'term';
    if (query.wildcard) return 'wildcard';
    if (query.bool) return 'bool';
    if (query.match_all) return 'match_all';
    return 'unknown';
  }
}
