# Ogini Search Engine API Documentation

## Overview
The Ogini Search Engine provides a comprehensive RESTful API for index management, document operations, and advanced search capabilities. This document covers all crucial endpoints with correct query structures and usage examples.

## Base URL

**Development:**
```
http://localhost:3000
```

**Production:**
```
https://oginisearch-production.up.railway.app
```

## Authentication
All endpoints require authentication via API key (when implemented):
```http
Authorization: Bearer <api_key>
# OR
x-api-key: <api_key>
```

---

## 1. Health Check Endpoints

### 1.1 Basic Health Check
**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "OK"
}
```

### 1.2 Memory Health Check
**Endpoint:** `GET /health/memory`

**Response:**
```json
{
  "status": "healthy",
  "memory": {
    "heapUsed": "45MB",
    "heapTotal": "67MB", 
    "external": "2MB",
    "rss": "89MB",
    "usagePercent": "67%"
  },
  "raw": {
    "rss": 93302784,
    "heapTotal": 70254592,
    "heapUsed": 47123456,
    "external": 2048576
  },
  "timestamp": "2023-06-15T10:00:00.000Z"
}
```

### 1.3 Force Garbage Collection
**Endpoint:** `POST /health/gc`

**Response (Success):**
```json
{
  "status": "success",
  "message": "Garbage collection forced",
  "before": {
    "heapUsed": 47,
    "heapTotal": 67
  },
  "after": {
    "heapUsed": 23,
    "heapTotal": 67
  },
  "freedMB": 24,
  "timestamp": "2023-06-15T10:00:00.000Z"
}
```

**Response (Not Available):**
```json
{
  "status": "error",
  "message": "Garbage collection not available. Start with --expose-gc flag.",
  "timestamp": "2023-06-15T10:00:00.000Z"
}
```

---

## 2. Index Management

### 2.1 Create Index
**Endpoint:** `POST /api/indices`

**Request Body:**
```json
{
  "name": "products",
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "1s"
  },
  "mappings": {
    "properties": {
      "title": { 
        "type": "text", 
        "analyzer": "standard", 
        "boost": 2.0 
      },
      "description": { 
        "type": "text", 
        "analyzer": "standard" 
      },
      "price": { 
        "type": "number" 
      },
      "categories": { 
        "type": "keyword" 
      },
      "inStock": { 
        "type": "boolean" 
      },
      "createdAt": { 
        "type": "date" 
      }
    }
  }
}
```

**Supported Field Types:**
- `text` - Full-text searchable fields
- `keyword` - Exact match fields (not analyzed)
- `integer` - Integer numbers
- `float` - Floating point numbers  
- `date` - Date fields
- `boolean` - True/false values
- `object` - Nested objects
- `nested` - Nested documents

**Response:**
```json
{
  "name": "products",
  "status": "open",
  "createdAt": "2023-06-15T10:00:00Z",
  "documentCount": 0,
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "1s"
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard", "boost": 2.0 }
    }
  }
}
```

### 2.2 List All Indices
**Endpoint:** `GET /api/indices`

**Query Parameters:**
- `status` (optional): Filter by status (open, closed, creating, deleting)

**Response:**
```json
{
  "indices": [
    {
      "name": "products",
      "status": "open",
      "documentCount": 150,
      "createdAt": "2023-06-15T10:00:00Z",
      "settings": {
        "numberOfShards": 1,
        "refreshInterval": "1s"
      },
      "mappings": {
        "properties": {
          "title": { "type": "text", "analyzer": "standard" }
        }
      }
    }
  ],
  "total": 1
}
```

### 2.3 Get Index Details
**Endpoint:** `GET /api/indices/{index_name}`

**Response:**
```json
{
  "name": "products",
  "status": "open",
  "documentCount": 150,
  "createdAt": "2023-06-15T10:00:00Z",
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "1s"
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" }
    }
  }
}
```

### 2.4 Update Index Settings
**Endpoint:** `PUT /api/indices/{index_name}/settings`

**Request Body:**
```json
{
  "settings": {
    "refreshInterval": "2s"
  }
}
```

**Response:**
```json
{
  "name": "products",
  "status": "open",
  "documentCount": 150,
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "2s"
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" }
    }
  }
}
```

### 2.5 Update Index Mappings
**Endpoint:** `PUT /api/indices/{index_name}/mappings`

**Request Body:**
```json
{
  "properties": {
    "rating": { "type": "float" },
    "inStock": { "type": "boolean" }
  }
}
```

**Response:**
```json
{
  "name": "products",
  "status": "open",
  "documentCount": 150,
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "1s"
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" },
      "rating": { "type": "float" },
      "inStock": { "type": "boolean" }
    }
  }
}
```

### 2.6 Auto-Detect Mappings
**Endpoint:** `POST /api/indices/{index_name}/mappings/auto-detect`

**Description:** Automatically detects field mappings from existing documents in the index.

**Response:**
```json
{
  "name": "products",
  "status": "open",
  "documentCount": 150,
  "settings": {
    "numberOfShards": 1,
    "refreshInterval": "1s"
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" },
      "price": { "type": "float" },
      "categories": { "type": "keyword" }
    }
  }
}
```

### 2.7 Rebuild Document Count
**Endpoint:** `POST /api/indices/{index_name}/_rebuild_count`

**Description:** Rebuilds the document count for an index by scanning all documents.

**Response:** `200 OK` (No body)

### 2.8 Delete Index
**Endpoint:** `DELETE /api/indices/{index_name}`

**Response:** `204 No Content`

### 2.9 Debug MongoDB Connection
**Endpoint:** `GET /api/indices/debug/mongodb`

**Response (Success):**
```json
{
  "status": "success",
  "message": "MongoDB connection working",
  "indicesCount": 3,
  "indices": [
    { "name": "products", "createdAt": "2023-06-15T10:00:00Z" },
    { "name": "articles", "createdAt": "2023-06-15T11:00:00Z" }
  ]
}
```

**Response (Error):**
```json
{
  "status": "error",
  "message": "MongoDB connection failed",
  "error": "Connection timeout"
}
```

### 2.10 Clear Index Cache
**Endpoint:** `POST /api/indices/{index_name}/clear-cache`

**Description:** Clears the term dictionary cache for a specific index to free up memory and resolve potential caching issues.

**Request:** No body required

**Response:**
```json
{
  "message": "Cache cleared successfully for index products",
  "clearedTerms": 1247
}
```

### 2.11 Rebuild Entire Index
**Endpoint:** `POST /api/indices/{index_name}/_rebuild_all`

**Description:** Completely rebuilds the index including all terms and posting lists. This operation re-indexes all documents to ensure proper term dictionary population and wildcard search functionality. Use this when wildcard searches return unexpected results or after bulk document operations.

**Response:**
```json
{
  "message": "Index rebuilt successfully",
  "indexName": "products",
  "documentsProcessed": 100,
  "termsIndexed": 1500,
  "took": 2500
}
```

### 2.12 Manual Rebuild Search Index
**Endpoint:** `POST /api/indices/{index_name}/_rebuild_index`

**Description:** Manually rebuilds the search index by reprocessing all documents. This is a background operation that returns immediately. Use only when necessary as this is a time-consuming operation.

**Response:**
```json
{
  "message": "Index rebuild started for businesses",
  "warning": "This operation may take a long time for large indices",
  "indexName": "businesses"
}
```

### 2.13 Complete System Reset (DESTRUCTIVE)
**Endpoint:** `POST /api/indices/system/reset`

**⚠️ WARNING: This endpoint destroys ALL data in the system including term dictionary, RocksDB, MongoDB indices, MongoDB term postings, and document storage.**

**Request Body:**
```json
{
  "resetKey": "test-reset-key-123"
}
```

**Response (Success):**
```json
{
  "message": "Complete system reset successful - ALL DATA DESTROYED",
  "resetComponents": [
    "Term Dictionary",
    "RocksDB", 
    "MongoDB Indices",
    "MongoDB Term Postings (1247 deleted)",
    "Document Storage"
  ],
  "timestamp": "2023-06-15T10:00:00.000Z"
}
```

**Response (Invalid Key):**
```json
{
  "statusCode": 400,
  "message": "Invalid reset key",
  "error": "Bad Request"
}
```

**What Gets Cleared:**
- **Term Dictionary** - In-memory cache and LRU cache completely cleared
- **RocksDB** - All local storage data wiped
- **MongoDB Collections:**
  - `indices` - All index definitions and metadata
  - `documents` - All stored document content
  - `term_postings` - All term-to-document mappings and search data

**Security Notes:**
- Requires valid `resetKey` matching environment variable `RESET_KEY` or hardcoded test key
- All data is permanently destroyed
- Cannot be undone
- Use only for testing or complete system reinitialization

---

## 3. Document Management

### 3.1 Index a Document
**Endpoint:** `POST /api/indices/{index_name}/documents`

**Request Body (with ID):**
```json
{
  "id": "product-123",
  "document": {
    "title": "Smartphone X",
    "description": "Latest smartphone with advanced features",
    "price": 999.99,
    "categories": ["electronics", "mobile"],
    "inStock": true,
    "createdAt": "2023-06-15T10:00:00Z"
  }
}
```

**Request Body (auto-generated ID):**
```json
{
  "document": {
    "title": "Laptop Pro",
    "description": "Professional grade laptop",
    "price": 1499.99,
    "categories": ["electronics", "computers"]
  }
}
```

**Response:**
```json
{
  "id": "product-123",
  "index": "products",
  "version": 1,
  "found": true,
  "source": {
    "title": "Smartphone X",
    "description": "Latest smartphone with advanced features",
    "price": 999.99,
    "categories": ["electronics", "mobile"],
    "inStock": true,
    "createdAt": "2023-06-15T10:00:00Z"
  }
}
```

### 3.2 Get Document
**Endpoint:** `GET /api/indices/{index_name}/documents/{document_id}`

**Response:**
```json
{
  "id": "product-123",
  "index": "products",
  "version": 1,
  "found": true,
  "source": {
    "title": "Smartphone X",
    "description": "Latest smartphone with advanced features",
    "price": 999.99,
    "categories": ["electronics", "mobile"]
  }
}
```

### 3.3 Update Document
**Endpoint:** `PUT /api/indices/{index_name}/documents/{document_id}`

**Request Body:**
```json
{
  "document": {
    "title": "Smartphone X Pro",
    "price": 1099.99,
    "inStock": false
  }
}
```

**Response:**
```json
{
  "id": "product-123",
  "index": "products",
  "version": 2,
  "found": true,
  "source": {
    "title": "Smartphone X Pro",
    "price": 1099.99,
    "inStock": false
  }
}
```

### 3.4 Delete Document
**Endpoint:** `DELETE /api/indices/{index_name}/documents/{document_id}`

**Response:** `204 No Content`

### 3.5 Bulk Index Documents
**Endpoint:** `POST /api/indices/{index_name}/documents/_bulk`

**Request Body:**
```json
{
  "documents": [
    {
      "id": "product-1",
      "document": {
        "title": "Product 1",
        "price": 100
      }
    },
    {
      "id": "product-2",
      "document": {
        "title": "Product 2",
        "price": 200
      }
    }
  ]
}
```

**Response:**
```json
{
  "took": 35,
  "errors": false,
  "successCount": 2,
  "items": [
    {
      "id": "product-1",
      "index": "products",
      "success": true,
      "status": 201
    },
    {
      "id": "product-2",
      "index": "products",
      "success": true,
      "status": 201
    }
  ]
}
```

### 3.6 Delete by Query
**Endpoint:** `POST /api/indices/{index_name}/documents/_delete_by_query`

**Request Body (Term Query):**
```json
{
  "query": {
    "term": {
      "field": "categories",
      "value": "discontinued"
    }
  }
}
```

**Request Body (Range Query):**
```json
{
  "query": {
    "range": {
      "field": "price",
      "lt": 100,
      "gte": 10
    }
  }
}
```

**Response:**
```json
{
  "took": 75,
  "deleted": 5,
  "failures": []
}
```

### 3.7 List Documents
**Endpoint:** `GET /api/indices/{index_name}/documents`

**Query Parameters:**
- `limit` (default: 10): Number of documents to return
- `offset` (default: 0): Starting offset
- `filter` (optional): JSON filter criteria

**Example:** `GET /api/indices/products/documents?limit=20&offset=0&filter={"category":"electronics"}`

**Response:**
```json
{
  "total": 150,
  "took": 25,
  "documents": [
    {
      "id": "product-123",
      "index": "products",
      "version": 1,
      "found": true,
      "source": {
        "title": "Smartphone X",
        "price": 999.99
      }
    }
  ]
}
```

---

## 4. Search Operations

### 4.1 Search Documents
**Endpoint:** `POST /api/indices/{index_name}/_search`

**Query Parameters:**
- `size` (optional): Number of results to return
- `from` (optional): Starting offset for pagination

#### 4.1.1 Basic Match Query
```json
{
  "query": {
    "match": {
      "field": "title",
      "value": "smartphone"
    }
  },
  "size": 10,
  "from": 0
}
```

#### 4.1.2 Multi-Field Search
```json
{
  "query": {
    "match": {
      "value": "wireless headphones"
    }
  },
  "fields": ["title", "description"],
  "size": 10
}
```

#### 4.1.3 Match with Filter
```json
{
  "query": {
    "match": {
      "field": "description",
      "value": "high performance"
    }
  },
  "filter": {
    "term": {
      "field": "categories",
      "value": "electronics"
    }
  },
  "size": 20
}
```

#### 4.1.4 Match All Documents

**Method 1: Match All Query (Recommended)**
```json
{
  "query": {
    "match_all": {}
  }
}
```

**Method 2: Match All with Boost**
```json
{
  "query": {
    "match_all": {
      "boost": 2.0
    }
  }
}
```

**Method 3: Wildcard in Match Query**
```json
{
  "query": {
    "match": {
      "value": "*"
    }
  }
}
```

**Method 4: Empty String Match**
```json
{
  "query": {
    "match": {
      "value": ""
    }
  }
}
```

#### 4.1.5 Wildcard Queries

Wildcard queries support pattern matching with `*` (zero or more characters) and `?` (single character).

**Basic Wildcard Search**
```json
{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "smart*"
    }
  }
}
```

**Wildcard with Boost**
```json
{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "smart*",
      "boost": 1.5
    }
  }
}
```

**Complex Wildcard Pattern (Object Syntax)**
```json
{
  "query": {
    "wildcard": {
      "title": {
        "value": "smart*phone?",
        "boost": 1.5
      }
    }
  }
}
```

**Contains Pattern (asterisks on both sides)**
```json
{
  "query": {
    "wildcard": {
      "field": "description",
      "value": "*farmer*"
    }
  }
}
```

**Single Character Wildcard**
```json
{
  "query": {
    "wildcard": {
      "field": "status",
      "value": "p?nding"
    }
  }
}
```

**Wildcard in Match Query (Auto-Detection)**
```json
{
  "query": {
    "match": {
      "field": "description",
      "value": "*farmer*"
    }
  }
}
```

#### 4.1.6 String Query Format
You can also use a simple string for backward compatibility:
```json
{
  "query": "smartphone",
  "size": 10
}
```

#### 4.1.7 Advanced Search with All Options
```json
{
  "query": {
    "match": {
      "field": "title",
      "value": "smartphone"
    }
  },
  "size": 10,
  "from": 0,
  "fields": ["title", "description"],
  "filter": {
    "term": {
      "field": "inStock",
      "value": true
    }
  },
  "sort": "price:desc",
  "highlight": true,
  "facets": ["categories", "brand"]
}
```

**Search Response Format:**
```json
{
  "hits": {
    "total": 5,
    "maxScore": 0.9567,
    "hits": [
      {
        "id": "product-123",
        "score": 0.9567,
        "source": {
          "title": "Wireless Bluetooth Headphones",
          "description": "High quality audio with noise cancellation",
          "price": 159.99,
          "categories": ["electronics", "audio"]
        },
        "highlight": {
          "title": ["<em>Wireless</em> Bluetooth Headphones"]
        }
      }
    ]
  },
  "facets": {
    "categories": {
      "buckets": [
        { "key": "electronics", "count": 3 },
        { "key": "audio", "count": 2 }
      ]
    }
  },
  "took": 15
}
```

### 4.2 Suggestions
**Endpoint:** `POST /api/indices/{index_name}/_search/_suggest`

#### 4.2.1 Basic Suggestion
```json
{
  "text": "phon",
  "field": "title",
  "size": 5
}
```

#### 4.2.2 Suggestion Without Specific Field
```json
{
  "text": "lapt",
  "size": 3
}
```

**Suggestion Response:**
```json
{
  "suggestions": [
    { "text": "phone", "score": 1.0, "freq": 10 },
    { "text": "smartphone", "score": 0.8, "freq": 5 },
    { "text": "headphone", "score": 0.6, "freq": 3 }
  ],
  "took": 5
}
```

### 4.3 Clear Search Dictionary
**Endpoint:** `DELETE /api/indices/{index_name}/_search/_clear_dictionary`

**Description:** Clears the term dictionary for the specific index to resolve search issues or free up memory.

**Response:**
```json
{
  "message": "Term dictionary cleared successfully"
}
```

---

## 5. Bulk Indexing Management

### 5.1 Start Bulk Indexing Job
**Endpoint:** `POST /bulk-indexing/start`

**Request Body:**
```json
{
  "indexName": "products",
  "documents": [
    {
      "id": "prod-1",
      "document": {
        "title": "Product 1",
        "description": "Product description",
        "price": 99.99
      }
    }
  ],
  "options": {
    "batchSize": 100,
    "concurrency": 5
  }
}
```

**Response:**
```json
{
  "batchId": "batch-123e4567-e89b-12d3-a456-426614174000",
  "message": "Bulk indexing job started",
  "totalDocuments": 1000,
  "estimatedTime": "2 minutes"
}
```

### 5.2 Get Bulk Indexing Status
**Endpoint:** `GET /bulk-indexing/status/{batch_id}`

**Response:**
```json
{
  "batchId": "batch-123e4567-e89b-12d3-a456-426614174000",
  "status": "processing",
  "progress": {
    "total": 1000,
    "processed": 750,
    "failed": 5,
    "remaining": 245,
    "percentage": 75.0
  },
  "performance": {
    "documentsPerSecond": 45.2,
    "estimatedTimeRemaining": "6 seconds"
  },
  "startedAt": "2023-06-15T10:00:00.000Z",
  "lastUpdated": "2023-06-15T10:02:15.000Z"
}
```

### 5.3 Get All Bulk Jobs Status
**Endpoint:** `GET /bulk-indexing/status`

**Response:**
```json
{
  "jobs": [
    {
      "batchId": "batch-123",
      "status": "completed",
      "progress": {
        "total": 1000,
        "processed": 1000,
        "failed": 0,
        "percentage": 100.0
      }
    }
  ],
  "total": 1
}
```

### 5.4 Clear Job Records
**Endpoint:** `DELETE /bulk-indexing/progress/{batch_id}`

**Description:** Clears job records for a specific batch to clean up completed or failed jobs.

**Response:** `204 No Content`

---

## 6. Wildcard & Match-All Query Patterns

### 6.1 Wildcard Pattern Reference

| Pattern | Description | Example | Matches |
|---------|-------------|---------|---------|
| `*` | Zero or more characters | `smart*` | smartphone, smartwatch, smart |
| `?` | Single character | `p?n` | pen, pin, pan |
| `*text*` | Contains text | `*phone*` | smartphone, telephone, headphone |
| `text*` | Starts with text | `agr*` | agriculture, agro, agreement |
| `*text` | Ends with text | `*ing` | running, walking, talking |
| `*?ext*` | Complex patterns | `*a?e*` | camera, games, table |

### 6.2 Match-All Query Options

| Method | Use Case | Performance | Example |
|--------|----------|-------------|---------|
| `match_all` | Standard match-all | Fastest | `{"match_all": {}}` |
| `match_all` with boost | Scored results | Fast | `{"match_all": {"boost": 2.0}}` |
| `match` with `*` | Auto-detection | Fast | `{"match": {"value": "*"}}` |
| `match` with empty | Auto-detection | Fast | `{"match": {"value": ""}}` |

### 6.3 Performance Benchmarks

Based on testing with real data:

| Query Type | Avg Response Time | Documents Searched | Notes |
|------------|------------------|-------------------|-------|
| `match_all` | 7-16ms | All documents | Optimal for returning all docs |
| Simple wildcard (`agr*`) | 2-6ms | Pattern-matched | Very fast for prefix patterns |
| Complex wildcard (`*farmer*`) | 5-10ms | Pattern-matched | Good performance for contains |
| Mixed patterns (`p?n*`) | 4-8ms | Pattern-matched | Efficient regex compilation |

### 6.4 Query Auto-Detection

The search engine automatically detects and optimizes queries:

**Input Detection:**
- `{"match": {"value": "*"}}` → Converted to match-all query
- `{"match": {"value": ""}}` → Converted to match-all query
- `{"match": {"value": "*farmer*"}}` → Converted to wildcard query
- `{"match": {"value": "p?nding"}}` → Converted to wildcard query

**Smart Processing:**
- Wildcard patterns in match queries are automatically converted to wildcard execution
- Empty strings and lone asterisks trigger match-all behavior
- Boost factors are preserved during conversion

---

## 7. HTTP Status Codes

The API returns appropriate HTTP status codes:

### Success Codes
- `200 OK` - Successful GET, PUT, POST operations
- `201 Created` - Successful resource creation
- `204 No Content` - Successful DELETE operations

### Error Codes
- `400 Bad Request` - Invalid query structure or malformed request body
- `404 Not Found` - Index, document, or endpoint doesn't exist
- `409 Conflict` - Resource already exists (e.g., index name collision)
- `500 Internal Server Error` - Server-side errors

---

## 8. Best Practices & Recommendations

### 8.1 Query Structure Best Practices

1. **Use Specific Field Queries When Possible:**
```json
// Good - targets specific field
{"match": {"field": "title", "value": "smartphone"}}

// Less optimal - searches all fields
{"match": {"value": "smartphone"}}
```

2. **Choose the Right Query Type:**
```json
// For exact matches - use term queries
{"term": {"field": "status", "value": "active"}}

// For text search - use match queries
{"match": {"field": "description", "value": "high quality"}}

// For pattern matching - use wildcard queries
{"wildcard": {"field": "title", "value": "smart*"}}

// For all documents - use match_all
{"match_all": {}}
```

3. **Optimize Wildcard Patterns:**
```json
// Good - specific prefix pattern
{"wildcard": {"field": "category", "value": "electronics*"}}

// Avoid - leading wildcards (slower)
{"wildcard": {"field": "title", "value": "*phone"}}

// Better alternative for contains
{"match": {"field": "title", "value": "phone"}}
```

4. **Leverage Field Boosting:**
```json
{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "smart*",
      "boost": 2.0
    }
  }
}
```

5. **Use Match-All Efficiently:**
```json
// Recommended for all documents
{"match_all": {}}

// With scoring boost
{"match_all": {"boost": 2.0}}

// Avoid for large datasets without pagination
{"match_all": {}, "size": 10000}
```

6. **Use Filters for Exact Matches:**
```json
{
  "query": {"match": {"value": "search term"}},
  "filter": {
    "term": {"field": "category", "value": "electronics"}
  }
}
```

### 8.2 Performance Optimization

1. **Pagination for Large Result Sets:**
```json
{
  "query": {"match": {"value": "popular term"}},
  "size": 20,
  "from": 0
}
```

2. **Optimize Wildcard Queries:**
```json
// Good - anchored patterns
{"wildcard": {"field": "title", "value": "prod*"}}

// Less optimal - middle wildcards
{"wildcard": {"field": "title", "value": "*duct*"}}
```

3. **Use Appropriate Query Types:**
```json
// For browsing/pagination - use match_all
{"match_all": {}, "size": 10, "from": 0}

// For specific searches - use match with fields
{"match": {"field": "title", "value": "laptop"}}

// For pattern searches - use targeted wildcards
{"wildcard": {"field": "sku", "value": "PROD-*"}}
```

4. **Use Facets for Navigation:**
```json
{
  "query": {"match": {"value": "search"}},
  "facets": ["category", "brand", "price_range"]
}
```

5. **Limit Field Searches:**
```json
// Good - specific fields
{"fields": ["title", "description"]}

// Avoid - too many fields
{"fields": ["title", "description", "content", "tags", "meta", "notes"]}
```

---

## 9. Testing with cURL Examples

### Index Creation
```bash
curl -X POST "http://localhost:3000/api/indices" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "name": "test_products",
    "mappings": {
      "properties": {
        "title": {"type": "text", "analyzer": "standard"},
        "price": {"type": "float"}
      }
    }
  }'
```

### Document Indexing
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/documents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "id": "prod-1",
    "document": {
      "title": "Test Product",
      "price": 99.99
    }
  }'
```

### Search
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "match": {
        "field": "title",
        "value": "test"
      }
    }
  }'
```

### Match-All Query
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "match_all": {}
    },
    "size": 10
  }'
```

### Match-All with Boost
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "match_all": {
        "boost": 2.0
      }
    },
    "size": 5
  }'
```

### Wildcard Queries
```bash
# Prefix wildcard
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "wildcard": {
        "field": "title",
        "value": "prod*"
      }
    }
  }'

# Contains pattern
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "wildcard": {
        "field": "description",
        "value": "*quality*"
      }
    }
  }'

# Single character wildcard
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "wildcard": {
        "field": "status",
        "value": "activ?"
      }
    }
  }'
```

### Wildcard in Match Query (Auto-Detection)
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "query": {
      "match": {
        "field": "category",
        "value": "elect*"
      }
    }
  }'
```

### Suggestions
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_search/_suggest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "text": "prod",
    "field": "title",
    "size": 5
  }'
```

### System Management

#### Clear Index Cache
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/clear-cache" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>"
```

#### Rebuild Entire Index
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_rebuild_all" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>"
```

#### Manual Rebuild Search Index
```bash
curl -X POST "http://localhost:3000/api/indices/test_products/_rebuild_index" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>"
```

#### Complete System Reset (DESTRUCTIVE)
```bash
curl -X POST "http://localhost:3000/api/indices/system/reset" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "resetKey": "test-reset-key-123"
  }'
```

#### Clear Search Dictionary
```bash
curl -X DELETE "http://localhost:3000/api/indices/test_products/_search/_clear_dictionary" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>"
```

### Bulk Indexing Management

#### Start Bulk Indexing Job
```bash
curl -X POST "http://localhost:3000/bulk-indexing/start" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "indexName": "test_products",
    "documents": [
      {
        "id": "bulk-1",
        "document": {
          "title": "Bulk Product 1",
          "price": 99.99
        }
      }
    ],
    "options": {
      "batchSize": 100,
      "concurrency": 5
    }
  }'
```

#### Get Bulk Job Status
```bash
curl -X GET "http://localhost:3000/bulk-indexing/status/{batch_id}" \
  -H "Authorization: Bearer <api_key>"
```

#### Get All Bulk Jobs Status
```bash
curl -X GET "http://localhost:3000/bulk-indexing/status" \
  -H "Authorization: Bearer <api_key>"
```

#### Clear Job Records
```bash
curl -X DELETE "http://localhost:3000/bulk-indexing/progress/{batch_id}" \
  -H "Authorization: Bearer <api_key>"
```

---

## 10. Conclusion

The Ogini Search Engine provides a comprehensive and powerful API for full-text search operations. Key strengths include:

✅ **Complete Index Management** - Create, read, update, delete operations with auto-mapping detection  
✅ **Advanced Search Capabilities** - Match, wildcard, match-all queries with auto-detection  
✅ **Flexible Document Operations** - Individual and bulk operations with filtering  
✅ **System Management & Recovery** - Cache clearing, index rebuilding, and complete system reset  
✅ **Bulk Processing** - Scalable bulk indexing with job management and progress tracking  
✅ **Performance Optimized** - Sub-200ms response times with efficient query processing  
✅ **Memory Management** - Built-in memory optimization and garbage collection endpoints  
✅ **Index Isolation** - Proper term dictionary isolation preventing cross-index contamination  
✅ **Developer Friendly** - Comprehensive cURL examples and clear documentation  
✅ **Production Ready** - Health monitoring, memory management, and robust error handling

### New System Management Features

**🔧 System Recovery & Maintenance:**
- **Index Cache Clearing** - Free memory and resolve caching issues
- **Complete Index Rebuilding** - Fix wildcard search issues and term dictionary problems  
- **Background Index Rebuilding** - Non-blocking index maintenance
- **Complete System Reset** - Nuclear option for testing and clean state recovery

**📊 Bulk Operations:**
- **Scalable Bulk Indexing** - Process thousands of documents efficiently
- **Job Progress Tracking** - Monitor bulk operations with real-time status
- **Job Management** - Clean up completed jobs and manage queue

**🛡️ Index Isolation:**
- **Proper Term Scoping** - Terms isolated per index preventing cross-contamination
- **Wildcard Search Fix** - Wildcard queries now properly scoped to target index only
- **Performance Preserved** - All optimizations maintain sub-20ms response times

The API is designed for high performance, scalability, and ease of use, making it suitable for both development and production environments. With the new system management capabilities, administrators can maintain and troubleshoot search indices effectively while preserving data integrity and performance. 