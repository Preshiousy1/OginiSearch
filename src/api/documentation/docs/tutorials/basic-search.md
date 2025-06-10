# Basic Search Implementation

This tutorial demonstrates how to implement basic search functionality using Ogini.

## Simple Text Search

The most basic search operation is a text search across a field:

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

## Multi-Field Search

Search across multiple fields simultaneously:

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  fields: ['title', 'description', 'tags']
});
```

## Filtered Search

Combine full-text search with filters:

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  filter: {
    range: {
      price: {
        gte: 500,
        lte: 1000
      }
    }
  }
});
```

## Faceted Search

Get aggregations for categories:

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  facets: ['tags', 'brand']
});
```

## Pagination

Implement pagination in search results:

```typescript
const page = 1;
const pageSize = 10;

const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  size: pageSize,
  from: (page - 1) * pageSize
});
```

## Sorting

Sort results by specific fields:

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  sort: 'price:desc'
});
```

## Highlighting

Highlight matching terms in results:

```typescript
const results = await client.search.search('products', {
  query: {
    match: {
      field: 'title',
      value: 'smartphone'
    }
  },
  highlight: true
});
```

## Best Practices

1. **Use Specific Fields**: Always specify the fields to search in rather than searching all fields
2. **Implement Filters**: Use filters for exact matches and ranges
3. **Add Pagination**: Always implement pagination for large result sets
4. **Use Facets**: Implement faceted search for better user experience
5. **Cache Results**: Cache frequent searches to improve performance
6. **Handle Errors**: Implement proper error handling for failed searches
7. **Validate Input**: Sanitize and validate search input before sending to the API 

# Basic Search Tutorial

This tutorial covers the fundamental search operations in Ogini Search Engine, including basic match queries, wildcard patterns, and match-all functionality.

## Prerequisites

- Ogini Search Engine running on `http://localhost:3000`
- An index with some documents (follow the [Getting Started](../getting-started.md) guide)

## 1. Basic Match Queries

### Simple Text Search
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "field": "title",
      "value": "smartphone"
    }
  }
}
```

### Multi-Field Search
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "value": "wireless headphones"
    }
  },
  "fields": ["title", "description"]
}
```

## 2. Match-All Queries

### Get All Documents
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match_all": {}
  }
}
```

### Match-All with Pagination
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match_all": {}
  },
  "size": 10,
  "from": 0
}
```

### Match-All with Boost Scoring
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match_all": {
      "boost": 2.0
    }
  }
}
```

### Alternative Match-All Methods
```http
# Using wildcard in match query
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "value": "*"
    }
  }
}

# Using empty string
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "value": ""
    }
  }
}
```

## 3. Wildcard Queries

### Prefix Patterns
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "smart*"
    }
  }
}
```

### Contains Patterns
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "description",
      "value": "*wireless*"
    }
  }
}
```

### Single Character Wildcards
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "status",
      "value": "activ?"
    }
  }
}
```

### Complex Patterns
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "sku",
      "value": "PROD-??-*"
    }
  }
}
```

### Wildcard Auto-Detection in Match Queries
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "field": "category",
      "value": "elect*"
    }
  }
}
```

## 4. Combined Queries with Filters

### Match with Filter
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "field": "title",
      "value": "smartphone"
    }
  },
  "filter": {
    "term": {
      "field": "inStock",
      "value": true
    }
  }
}
```

### Wildcard with Filter
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "*phone*"
    }
  },
  "filter": {
    "range": {
      "field": "price",
      "lt": 1000
    }
  }
}
```

## 5. Response Format

All search queries return a consistent response format:

```json
{
  "data": {
    "total": 5,
    "maxScore": 1.0,
    "hits": [
      {
        "id": "product-123",
        "index": "products",
        "score": 1.0,
        "source": {
          "title": "Smartphone X",
          "price": 999.99
        }
      }
    ]
  },
  "took": 15
}
```

## 6. Performance Tips

1. **Use specific field queries** when possible
2. **Prefer prefix wildcards** over suffix wildcards
3. **Use match_all** for browsing scenarios
4. **Implement pagination** for large result sets
5. **Use filters** for exact matches

## Next Steps

- Learn about [Document Indexing](./document-indexing.md)
- Explore advanced search features
- Check out performance optimization techniques 