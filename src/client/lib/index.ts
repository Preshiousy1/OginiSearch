import { ConnectSearchClient } from './client';

/**
 * Index analysis settings interface
 */
export interface AnalysisSettings {
  analyzer?: Record<
    string,
    {
      type: string;
      tokenizer?: string;
      filter?: string[];
      [key: string]: any;
    }
  >;
  tokenizer?: Record<
    string,
    {
      type: string;
      [key: string]: any;
    }
  >;
  filter?: Record<
    string,
    {
      type: string;
      [key: string]: any;
    }
  >;
}

/**
 * Index settings interface
 */
export interface IndexSettings {
  numberOfShards?: number;
  numberOfReplicas?: number;
  refreshInterval?: string;
  analysis?: AnalysisSettings;
  [key: string]: any;
}

/**
 * Field mapping interface
 */
export interface FieldMapping {
  type:
    | 'text'
    | 'keyword'
    | 'integer'
    | 'long'
    | 'float'
    | 'double'
    | 'boolean'
    | 'date'
    | 'object'
    | 'nested';
  analyzer?: string;
  searchAnalyzer?: string;
  fielddata?: boolean;
  store?: boolean;
  fields?: Record<string, FieldMapping>;
  format?: string;
  [key: string]: any;
}

/**
 * Index mappings interface
 */
export interface IndexMappings {
  properties: Record<string, FieldMapping>;
  dynamic?: boolean | 'strict';
  [key: string]: any;
}

/**
 * Create index request interface
 */
export interface CreateIndexRequest {
  name: string;
  settings?: IndexSettings;
  mappings?: IndexMappings;
}

/**
 * Index response interface
 */
export interface IndexResponse {
  name: string;
  status: 'creating' | 'open' | 'closed' | 'deleting';
  documentCount: number;
  createdAt: string;
  settings?: IndexSettings;
  mappings?: IndexMappings;
}

/**
 * Index list response interface
 */
export interface IndexListResponse {
  indices: Array<{
    name: string;
    status: string;
    documentCount: number;
    createdAt: string;
  }>;
  total: number;
}

/**
 * Index management client for ConnectSearch
 */
export class IndexClient {
  private readonly client: ConnectSearchClient;
  private readonly basePath = '/api/indices';

  /**
   * Create a new index client
   * @param client ConnectSearch client instance
   */
  constructor(client: ConnectSearchClient) {
    this.client = client;
  }

  /**
   * Create a new index
   * @param request Create index request
   */
  async createIndex(request: CreateIndexRequest): Promise<IndexResponse> {
    return this.client.post<IndexResponse>(this.basePath, request);
  }

  /**
   * Get details of an index
   * @param indexName Name of the index
   */
  async getIndex(indexName: string): Promise<IndexResponse> {
    return this.client.get<IndexResponse>(`${this.basePath}/${indexName}`);
  }

  /**
   * List all indices
   * @param status Optional status filter
   */
  async listIndices(status?: string): Promise<IndexListResponse> {
    const query = status ? `?status=${status}` : '';
    return this.client.get<IndexListResponse>(`${this.basePath}${query}`);
  }

  /**
   * Update index settings
   * @param indexName Name of the index
   * @param settings Index settings to update
   */
  async updateIndex(indexName: string, settings: IndexSettings): Promise<IndexResponse> {
    return this.client.put<IndexResponse>(`${this.basePath}/${indexName}`, { settings });
  }

  /**
   * Delete an index
   * @param indexName Name of the index
   */
  async deleteIndex(indexName: string): Promise<void> {
    return this.client.delete<void>(`${this.basePath}/${indexName}`);
  }

  /**
   * Close an index (make it read-only)
   * @param indexName Name of the index
   */
  async closeIndex(indexName: string): Promise<IndexResponse> {
    return this.client.post<IndexResponse>(`${this.basePath}/${indexName}/_close`);
  }

  /**
   * Open a closed index
   * @param indexName Name of the index
   */
  async openIndex(indexName: string): Promise<IndexResponse> {
    return this.client.post<IndexResponse>(`${this.basePath}/${indexName}/_open`);
  }

  /**
   * Get index statistics
   * @param indexName Name of the index
   */
  async getIndexStats(indexName: string): Promise<any> {
    return this.client.get<any>(`${this.basePath}/${indexName}/_stats`);
  }
}
