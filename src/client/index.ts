import { ConnectSearchClient, ClientOptions, ClientError } from './lib/client';
import { IndexClient } from './lib/index';
import { DocumentClient } from './lib/document';
import { SearchClient } from './lib/search';

/**
 * Unified ConnectSearch client that provides access to all APIs
 */
export class ConnectSearch {
  /**
   * Base HTTP client
   */
  readonly client: ConnectSearchClient;

  /**
   * Index management API
   */
  readonly indices: IndexClient;

  /**
   * Document management API
   */
  readonly documents: DocumentClient;

  /**
   * Search API
   */
  readonly search: SearchClient;

  /**
   * Create a new ConnectSearch client
   * @param options Client configuration options
   */
  constructor(options: ClientOptions) {
    this.client = new ConnectSearchClient(options);
    this.indices = new IndexClient(this.client);
    this.documents = new DocumentClient(this.client);
    this.search = new SearchClient(this.client);
  }
}

// Export client classes
export { ConnectSearchClient, ClientOptions, ClientError };

// Export index types
export * from './lib/index';

// Export document types
export * from './lib/document';

// Export search types
export * from './lib/search';
