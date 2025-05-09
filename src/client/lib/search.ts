import { ConnectSearchClient } from './client';

/**
 * Match query interface
 */
export interface MatchQuery {
  field?: string;
  value: string;
  operator?: 'and' | 'or';
  fuzziness?: number | 'auto';
}

/**
 * Term query interface for search
 */
export interface TermSearchQuery {
  field: string;
  value: string | number | boolean;
}

/**
 * Range query interface for search
 */
export interface RangeSearchQuery {
  field: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/**
 * Search query request interface
 */
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

/**
 * Search hit interface
 */
export interface SearchHit {
  id: string;
  index: string;
  score: number;
  source: Record<string, any>;
  highlight?: Record<string, string[]>;
}

/**
 * Search response interface
 */
export interface SearchResponse {
  data: {
    total: number;
    maxScore: number;
    hits: SearchHit[];
  };
  facets?: Record<
    string,
    {
      buckets: Array<{
        key: string;
        count: number;
      }>;
    }
  >;
  took: number;
}

/**
 * Suggest query request interface
 */
export interface SuggestQueryRequest {
  text: string;
  field?: string;
  size?: number;
}

/**
 * Suggest response interface
 */
export interface SuggestResponse {
  suggestions: string[];
  took: number;
}

/**
 * Search client for ConnectSearch
 */
export class SearchClient {
  private readonly client: ConnectSearchClient;

  /**
   * Create a new search client
   * @param client ConnectSearch client instance
   */
  constructor(client: ConnectSearchClient) {
    this.client = client;
  }

  /**
   * Search for documents
   * @param indexName Name of the index
   * @param request Search query request
   */
  async search(indexName: string, request: SearchQueryRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>(`/api/indices/${indexName}/_search`, request);
  }

  /**
   * Get suggestions for autocomplete
   * @param indexName Name of the index
   * @param request Suggest query request
   */
  async suggest(indexName: string, request: SuggestQueryRequest): Promise<SuggestResponse> {
    return this.client.post<SuggestResponse>(`/api/indices/${indexName}/_search/_suggest`, request);
  }

  /**
   * Create a simple match query
   * @param field Field to search in
   * @param value Value to search for
   * @param options Additional options
   */
  createMatchQuery(
    field: string,
    value: string,
    options: { operator?: 'and' | 'or'; fuzziness?: number | 'auto' } = {},
  ): SearchQueryRequest {
    return {
      query: {
        match: {
          field,
          value,
          ...options,
        },
      },
    };
  }

  /**
   * Create a multi-field search query
   * @param value Value to search for
   * @param fields Fields to search in
   * @param options Additional options
   */
  createMultiFieldQuery(
    value: string,
    fields: string[],
    options: {
      size?: number;
      from?: number;
      filter?: Record<string, any>;
      sort?: string;
      highlight?: boolean;
    } = {},
  ): SearchQueryRequest {
    return {
      query: {
        match: {
          value,
        },
      },
      fields,
      ...options,
    };
  }

  /**
   * Create a term query
   * @param field Field to search in
   * @param value Value to search for
   * @param options Additional options
   */
  createTermQuery(
    field: string,
    value: string | number | boolean,
    options: {
      size?: number;
      from?: number;
      filter?: Record<string, any>;
    } = {},
  ): SearchQueryRequest {
    return {
      query: {
        term: {
          field,
          value,
        },
      },
      ...options,
    };
  }

  /**
   * Create a range query
   * @param field Field to search in
   * @param range Range criteria
   * @param options Additional options
   */
  createRangeQuery(
    field: string,
    range: { gt?: number; gte?: number; lt?: number; lte?: number },
    options: {
      size?: number;
      from?: number;
      filter?: Record<string, any>;
    } = {},
  ): SearchQueryRequest {
    return {
      query: {
        range: {
          field,
          ...range,
        },
      },
      ...options,
    };
  }
}
