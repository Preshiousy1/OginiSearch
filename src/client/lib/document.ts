import { ConnectSearchClient } from './client';

/**
 * Document response interface
 */
export interface DocumentResponse {
  id: string;
  index: string;
  version: number;
  found: boolean;
  source: Record<string, any>;
  error?: string;
}

/**
 * Bulk response interface
 */
export interface BulkResponse {
  items: Array<{
    id: string;
    index: string;
    success: boolean;
    status: number;
    error?: string;
  }>;
  took: number;
  errors: boolean;
}

/**
 * Delete by query response interface
 */
export interface DeleteByQueryResponse {
  deleted: number;
  took: number;
  failures: any[];
}

/**
 * Term query interface
 */
export interface TermQuery {
  field: string;
  value: string | number | boolean;
}

/**
 * Range query interface
 */
export interface RangeQuery {
  field: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/**
 * Delete by query request interface
 */
export interface DeleteByQueryRequest {
  query: {
    term?: TermQuery;
    range?: RangeQuery;
  };
  fields?: string[];
  filter?: Record<string, any>;
}

/**
 * Document management client for ConnectSearch
 */
export class DocumentClient {
  private readonly client: ConnectSearchClient;

  /**
   * Create a new document client
   * @param client ConnectSearch client instance
   */
  constructor(client: ConnectSearchClient) {
    this.client = client;
  }

  /**
   * Index a document
   * @param indexName Name of the index
   * @param document Document content
   * @param id Optional document ID (auto-generated if not provided)
   */
  async indexDocument(
    indexName: string,
    document: Record<string, any>,
    id?: string,
  ): Promise<DocumentResponse> {
    const payload = {
      document,
      id,
    };

    return this.client.post<DocumentResponse>(`/api/indices/${indexName}/documents`, payload);
  }

  /**
   * Bulk index multiple documents
   * @param indexName Name of the index
   * @param documents Array of documents to index
   */
  async bulkIndexDocuments(
    indexName: string,
    documents: Array<{
      document: Record<string, any>;
      id?: string;
    }>,
  ): Promise<BulkResponse> {
    return this.client.post<BulkResponse>(`/api/indices/${indexName}/documents/_bulk`, {
      documents,
    });
  }

  /**
   * Get a document by ID
   * @param indexName Name of the index
   * @param id Document ID
   */
  async getDocument(indexName: string, id: string): Promise<DocumentResponse> {
    return this.client.get<DocumentResponse>(`/api/indices/${indexName}/documents/${id}`);
  }

  /**
   * Update a document
   * @param indexName Name of the index
   * @param id Document ID
   * @param document Updated document content
   */
  async updateDocument(
    indexName: string,
    id: string,
    document: Record<string, any>,
  ): Promise<DocumentResponse> {
    return this.client.put<DocumentResponse>(`/api/indices/${indexName}/documents/${id}`, {
      document,
    });
  }

  /**
   * Delete a document by ID
   * @param indexName Name of the index
   * @param id Document ID
   */
  async deleteDocument(indexName: string, id: string): Promise<void> {
    return this.client.delete<void>(`/api/indices/${indexName}/documents/${id}`);
  }

  /**
   * Delete documents by query
   * @param indexName Name of the index
   * @param request Delete by query request
   */
  async deleteByQuery(
    indexName: string,
    request: DeleteByQueryRequest,
  ): Promise<DeleteByQueryResponse> {
    return this.client.post<DeleteByQueryResponse>(
      `/api/indices/${indexName}/documents/_delete_by_query`,
      request,
    );
  }
}
