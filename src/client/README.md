# ConnectSearch TypeScript Client Library

A TypeScript client library for interacting with the ConnectSearch API.

## Installation

```bash
npm install @connect-nigeria/connectsearch-client
```

## Usage

### Initialize the client

```typescript
import { ConnectSearch } from '@connect-nigeria/connectsearch-client';

const client = new ConnectSearch({
  baseURL: 'http://localhost:3000',
  apiKey: 'your-api-key', // Optional
  timeout: 10000, // Optional, defaults to 10000ms
  maxRetries: 3, // Optional, defaults to 3
  retryDelay: 300, // Optional, defaults to 300ms
});
```

### Index Management

```typescript
// Create a new index
const index = await client.indices.createIndex({
  name: 'products',
  settings: {
    numberOfShards: 1,
    refreshInterval: '1s',
  },
  mappings: {
    properties: {
      title: { type: 'text' },
      description: { type: 'text' },
      price: { type: 'float' },
      categories: { type: 'keyword' },
    },
  },
});

// Get index details
const indexDetails = await client.indices.getIndex('products');

// List all indices
const indices = await client.indices.listIndices();

// Update index settings
await client.indices.updateIndex('products', {
  refreshInterval: '2s',
});

// Delete an index
await client.indices.deleteIndex('products');
```

### Document Management

```typescript
// Index a document
const document = await client.documents.indexDocument(
  'products',
  {
    title: 'Smartphone X',
    description: 'Latest smartphone with advanced features',
    price: 999.99,
    categories: ['electronics', 'mobile'],
  }
);

// Bulk index documents
const bulkResponse = await client.documents.bulkIndexDocuments(
  'products',
  [
    {
      document: {
        title: 'Wireless Headphones',
        description: 'Noise-cancelling wireless headphones',
        price: 199.99,
        categories: ['electronics', 'audio'],
      },
    },
    {
      document: {
        title: 'Smart Watch',
        description: 'Fitness tracker and smartwatch',
        price: 249.99,
        categories: ['electronics', 'wearables'],
      },
    },
  ]
);

// Get a document by ID
const doc = await client.documents.getDocument('products', 'document-id');

// Update a document
await client.documents.updateDocument(
  'products',
  'document-id',
  {
    title: 'Updated Title',
    price: 899.99,
  }
);

// Delete a document
await client.documents.deleteDocument('products', 'document-id');

// Delete documents by query
const deleteByQueryResponse = await client.documents.deleteByQuery(
  'products',
  {
    query: {
      term: {
        field: 'categories',
        value: 'discontinued',
      },
    },
  }
);
```

### Search

```typescript
// Simple search
const searchResponse = await client.search.search(
  'products',
  {
    query: {
      match: {
        field: 'title',
        value: 'smartphone',
      },
    },
    size: 10,
    from: 0,
  }
);

// Multi-field search with helper method
const results = await client.search.search(
  'products',
  client.search.createMultiFieldQuery(
    'wireless headphones',
    ['title', 'description'],
    { 
      size: 20,
      highlight: true,
      filter: { categories: 'audio' }
    }
  )
);

// Get suggestions for autocomplete
const suggestions = await client.search.suggest(
  'products',
  {
    text: 'smar',
    field: 'title',
    size: 5,
  }
);
```

## Error Handling

The client includes built-in error handling that provides detailed error information:

```typescript
try {
  const results = await client.search.search('non-existent-index', {
    query: { match: { field: 'title', value: 'test' } }
  });
} catch (error) {
  if (error.statusCode === 404) {
    console.error('Index not found');
  } else {
    console.error(`Error: ${error.message}`);
  }
}
```

## API Reference

### ConnectSearchClient

Base HTTP client with retry logic and error handling.

### IndexClient

Methods for managing indices:
- `createIndex(request: CreateIndexRequest): Promise<IndexResponse>`
- `getIndex(indexName: string): Promise<IndexResponse>`
- `listIndices(status?: string): Promise<IndexListResponse>`
- `updateIndex(indexName: string, settings: IndexSettings): Promise<IndexResponse>`
- `deleteIndex(indexName: string): Promise<void>`
- `closeIndex(indexName: string): Promise<IndexResponse>`
- `openIndex(indexName: string): Promise<IndexResponse>`
- `getIndexStats(indexName: string): Promise<any>`

### DocumentClient

Methods for managing documents:
- `indexDocument(indexName: string, document: Record<string, any>, id?: string): Promise<DocumentResponse>`
- `bulkIndexDocuments(indexName: string, documents: Array<{document: Record<string, any>; id?: string;}>): Promise<BulkResponse>`
- `getDocument(indexName: string, id: string): Promise<DocumentResponse>`
- `updateDocument(indexName: string, id: string, document: Record<string, any>): Promise<DocumentResponse>`
- `deleteDocument(indexName: string, id: string): Promise<void>`
- `deleteByQuery(indexName: string, request: DeleteByQueryRequest): Promise<DeleteByQueryResponse>`

### SearchClient

Methods for searching and suggestions:
- `search(indexName: string, request: SearchQueryRequest): Promise<SearchResponse>`
- `suggest(indexName: string, request: SuggestQueryRequest): Promise<SuggestResponse>`
- Helper methods:
  - `createMatchQuery(field: string, value: string, options?: object): SearchQueryRequest`
  - `createMultiFieldQuery(value: string, fields: string[], options?: object): SearchQueryRequest`
  - `createTermQuery(field: string, value: any, options?: object): SearchQueryRequest`
  - `createRangeQuery(field: string, range: object, options?: object): SearchQueryRequest` 