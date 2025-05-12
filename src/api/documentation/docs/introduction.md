# Ogini API Documentation

## Overview

Ogini is a high-performance full-text search engine designed for speed, relevance, and scalability. 
This API provides RESTful access to all Ogini functionality, allowing you to create and manage indices, 
index documents, and perform sophisticated search operations.

## Key Features

- **Powerful Full-Text Search**: BM25 ranking algorithm with field-level boosting
- **Faceted Search**: Easily aggregate and filter results by categories
- **Fast Indexing**: High-throughput document ingestion
- **Suggestion/Autocomplete**: Type-ahead suggestion capability
- **Typo Tolerance**: Fuzzy matching for handling spelling errors
- **Flexible Querying**: Combined full-text and structured queries

## Getting Started

To begin using the Ogini API:

1. Create an index with appropriate mappings for your data
2. Index your documents
3. Start searching

See the examples below for each step.

## Authentication

All API requests require authentication using a JWT token passed in the Authorization header:

```
Authorization: Bearer {your_jwt_token}
```

Contact your administrator to obtain API credentials.

## Example Usage

### Creating an Index

```json
POST /api/indices
{
  "name": "products",
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" },
      "description": { "type": "text", "analyzer": "standard" },
      "price": { "type": "number" },
      "categories": { "type": "keyword" }
    }
  }
}
```

### Indexing Documents

```json
POST /api/indices/products/documents
{
  "document": {
    "title": "Smartphone X",
    "description": "Latest smartphone with advanced features",
    "price": 999.99,
    "categories": ["electronics", "mobile"]
  }
}
```

### Searching Documents

```json
POST /api/indices/products/_search
{
  "query": {
    "match": {
      "field": "title",
      "value": "smartphone"
    }
  },
  "size": 10
}
```

## Rate Limiting

API requests are subject to rate limiting of 100 requests per minute per API key. 