# Getting Started with Ogini

## Installation

### Prerequisites
- Node.js 16.x or later
- npm 7.x or later
- Docker (optional, for containerized deployment)

### Installation Steps

1. **Install via npm**
```bash
npm install ogini
```

2. **Install via Docker**
```bash
docker pull ogini/ogini:latest
```

3. **Clone the repository**
```bash
git clone https://github.com/ogini/ogini.git
cd ogini
npm install
```

## Basic Usage

### Initialize the Client

```typescript
import { Ogini } from 'ogini';

const client = new Ogini({
  baseURL: 'http://localhost:3000',
  apiKey: 'your-api-key'
});
```

### Create an Index

```typescript
await client.indices.createIndex({
  name: 'products',
  mappings: {
    properties: {
      title: { type: 'text' },
      description: { type: 'text' },
      price: { type: 'number' },
      tags: { type: 'keyword' }
    }
  }
});
```

### Index Documents

```typescript
await client.documents.indexDocument('products', {
  document: {
    title: 'Smartphone X',
    description: 'Latest smartphone with advanced features',
    price: 999.99,
    tags: ['electronics', 'mobile']
  }
});
```

### Search Documents

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  }
});
```

## Configuration Options

### Client Configuration

```typescript
interface OginiConfig {
  baseURL: string;           // API base URL
  apiKey?: string;          // API key for authentication
  timeout?: number;         // Request timeout in milliseconds
  maxRetries?: number;      // Maximum number of retry attempts
  retryDelay?: number;      // Delay between retries in milliseconds
  headers?: Record<string, string>; // Custom headers
}
```

### Index Configuration

```typescript
interface IndexConfig {
  name: string;             // Index name
  settings?: {
    numberOfShards?: number;    // Number of shards
    refreshInterval?: string;   // Refresh interval
    analysis?: {               // Custom analyzers
      analyzer?: Record<string, any>;
      filter?: Record<string, any>;
    }
  };
  mappings: {               // Field mappings
    properties: Record<string, any>;
  };
}
```

### Search Configuration

```typescript
interface SearchConfig {
  query: {
    match?: {
      field: string;
      value: string;
      operator?: 'and' | 'or';
      fuzziness?: number | 'auto';
    };
    term?: {
      field: string;
      value: string | number | boolean;
    };
    range?: {
      field: string;
      gt?: number;
      gte?: number;
      lt?: number;
      lte?: number;
    };
  };
  size?: number;           // Number of results to return
  from?: number;           // Starting offset
  fields?: string[];       // Fields to return
  sort?: string;           // Sort field
  highlight?: boolean;     // Enable highlighting
  facets?: string[];       // Facet fields
}
```

## Environment Variables

The following environment variables can be used to configure Ogini:

```bash
OGINISEARCH_API_KEY=your-api-key
OGINISEARCH_BASE_URL=http://localhost:3000
OGINISEARCH_TIMEOUT=30000
OGINISEARCH_MAX_RETRIES=3
OGINISEARCH_RETRY_DELAY=1000
``` 