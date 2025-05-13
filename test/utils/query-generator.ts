import { faker } from '@faker-js/faker';

export interface MatchQuery {
  field?: string;
  value: string;
  operator?: 'and' | 'or';
  fuzziness?: number | 'auto';
}

export interface TermSearchQuery {
  field: string;
  value: string | number | boolean;
}

export interface RangeSearchQuery {
  field: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface SearchQueryRequest {
  query:
    | {
        match?: MatchQuery;
        term?: TermSearchQuery;
        range?: RangeSearchQuery;
      }
    | string;
  size?: number;
  from?: number;
  fields?: string[];
  filter?: Record<string, any>;
  sort?: string;
  highlight?: boolean;
  facets?: string[];
}

export class QueryGenerator {
  /**
   * Generate a match query for a specific field
   */
  static generateMatchQuery(field = 'content', value?: string): SearchQueryRequest {
    return {
      query: {
        match: {
          field,
          value: value || faker.lorem.word(),
        },
      },
    };
  }

  /**
   * Generate a multi-match query across multiple fields
   */
  static generateMultiMatchQuery(
    fields = ['title', 'content'],
    value?: string,
  ): SearchQueryRequest {
    return {
      query: {
        match: {
          field: 'content',
          value: value || faker.lorem.word(),
        },
      },
      fields,
    };
  }

  /**
   * Generate a term query for exact matching
   */
  static generateTermQuery(field = 'tags', value?: string): SearchQueryRequest {
    const termValue = value || faker.word.sample();
    return {
      query: {
        match: {
          field,
          value: termValue,
        },
      },
      filter: {
        term: {
          field,
          value: termValue,
        },
      },
    };
  }

  /**
   * Generate a range query for numeric fields
   */
  static generateRangeQuery(field = 'metadata.age'): SearchQueryRequest {
    const min = faker.number.int({ min: 0, max: 50 });
    const max = min + faker.number.int({ min: 1, max: 50 });
    return {
      query: {
        range: {
          field,
          gte: min,
          lte: max,
        },
      },
    };
  }

  /**
   * Generate a boolean query combining multiple sub-queries
   */
  static generateBoolQuery(): SearchQueryRequest {
    return {
      query: {
        match: {
          field: 'content',
          value: 'test',
          operator: 'and',
        },
      },
      filter: {
        term: {
          field: 'tags',
          value: 'test',
        },
      },
    };
  }

  /**
   * Generate a random query of any type
   */
  static generateRandomQuery(): SearchQueryRequest {
    const types = ['match', 'term', 'range'];
    const type = types[faker.number.int({ min: 0, max: types.length - 1 })];

    switch (type) {
      case 'match':
        return this.generateMatchQuery();
      case 'term':
        return this.generateTermQuery();
      case 'range':
        return this.generateRangeQuery();
      default:
        return this.generateMatchQuery();
    }
  }
}
