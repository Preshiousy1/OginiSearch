import { SearchQueryDto, SuggestQueryDto, SearchResponseDto } from '../../api/dtos/search.dto';
import { CreateIndexDto, IndexResponseDto } from '../../api/dtos/index.dto';

/**
 * Generic search engine interface that can be implemented by different search engines
 * (PostgreSQL, Elasticsearch, in-memory, etc.)
 */
export interface SearchEngine {
  /**
   * Search for documents in an index
   */
  search(indexName: string, searchQuery: SearchQueryDto): Promise<Partial<SearchResponseDto>>;

  /**
   * Get suggestions for autocomplete
   */
  suggest(indexName: string, suggestQuery: SuggestQueryDto): Promise<string[]>;

  /**
   * Create a new index
   */
  createIndex(createIndexDto: CreateIndexDto): Promise<IndexResponseDto>;

  /**
   * Delete an index
   */
  deleteIndex(indexName: string): Promise<void>;

  /**
   * Check if an index exists
   */
  indexExists(indexName: string): Promise<boolean>;

  /**
   * Get index configuration
   */
  getIndex(indexName: string): Promise<any>;

  /**
   * Index a document
   */
  indexDocument(
    indexName: string,
    documentId: string,
    document: Record<string, any>,
  ): Promise<void>;

  /**
   * Delete a document
   */
  deleteDocument(indexName: string, documentId: string): Promise<void>;

  /**
   * Bulk index documents
   */
  bulkIndexDocuments(
    indexName: string,
    documents: Array<{ id: string; document: Record<string, any> }>,
  ): Promise<void>;

  /**
   * Clear dictionary/cache for an index
   */
  clearDictionary(indexName: string): Promise<{ message: string }>;

  /**
   * Get term statistics for an index
   */
  getTermStats(indexName: string): Promise<Array<{ term: string; freq: number }>>;
}
