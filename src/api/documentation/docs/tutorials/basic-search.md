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