# Wildcard & Match-All Queries Tutorial

This comprehensive tutorial covers all aspects of wildcard pattern matching and match-all queries in Ogini Search Engine.

## Table of Contents

1. [Introduction](#introduction)
2. [Match-All Queries](#match-all-queries)
3. [Wildcard Queries](#wildcard-queries)
4. [Auto-Detection Features](#auto-detection-features)
5. [Performance Considerations](#performance-considerations)
6. [Real-World Examples](#real-world-examples)
7. [Best Practices](#best-practices)

## Introduction

Ogini provides powerful pattern matching and document retrieval capabilities through two main query types:

- **Match-All Queries**: Efficiently retrieve all documents in an index
- **Wildcard Queries**: Pattern-based matching using `*` and `?` wildcards

Both query types include intelligent auto-detection when used within match queries.

## Match-All Queries

### Basic Match-All

Retrieve all documents in an index:

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

### Match-All with Scoring Boost

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

#### Using Asterisk in Match Query
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "value": "*"
    }
  }
}
```

#### Using Empty String
```http
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

## Wildcard Queries

### Wildcard Patterns Reference

| Pattern | Symbol | Description | Example | Matches |
|---------|--------|-------------|---------|---------|
| Asterisk | `*` | Zero or more characters | `prod*` | product, production, prod |
| Question Mark | `?` | Single character | `p?t` | pat, pet, pit, pot, put |
| Combined | `*?` | Mixed patterns | `*a?e*` | able, table, games |

### Basic Wildcard Queries

#### Prefix Matching
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

#### Suffix Matching
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "*phone"
    }
  }
}
```

#### Contains Pattern
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

#### Exact Length with Variations
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

#### Pattern with Fixed Positions
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

### Complex Wildcard Patterns

#### Multiple Wildcard Types
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "model",
      "value": "*X?-Pro*"
    }
  }
}
```

#### Address Pattern Matching
```http
POST /api/indices/locations/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "address",
      "value": "*Main St*"
    }
  }
}
```

## Auto-Detection Features

Ogini automatically detects wildcard patterns and match-all intentions in regular match queries:

### Wildcard Auto-Detection

#### Input Detection
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "field": "title",
      "value": "smart*"
    }
  }
}
```

**Result**: Automatically converted to wildcard query for optimal performance.

#### Multiple Patterns
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "field": "description",
      "value": "*high?quality*"
    }
  }
}
```

### Match-All Auto-Detection

#### Asterisk Detection
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "match": {
      "value": "*"
    }
  }
}
```

#### Empty String Detection
```http
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

## Performance Considerations

### Query Performance Comparison

| Query Type | Performance | Use Case | Example Response Time |
|------------|-------------|----------|----------------------|
| `match_all` | Fastest | Browse all documents | 7-16ms |
| Prefix wildcard (`text*`) | Very Fast | Autocomplete, filtering | 2-6ms |
| Suffix wildcard (`*text`) | Moderate | Full-text contains | 15-30ms |
| Contains (`*text*`) | Moderate | Search within text | 5-10ms |
| Complex patterns | Good | Specific matching | 4-8ms |

### Optimization Tips

#### ✅ Good Patterns
```http
# Anchored prefix (fastest)
{"wildcard": {"field": "title", "value": "prod*"}}

# Specific field targeting
{"wildcard": {"field": "category", "value": "electr*"}}

# Reasonable contains pattern
{"wildcard": {"field": "title", "value": "*phone*"}}
```

#### ⚠️ Less Optimal Patterns
```http
# Leading wildcard (slower)
{"wildcard": {"field": "title", "value": "*phone"}}

# Multiple leading wildcards
{"wildcard": {"field": "title", "value": "**phone"}}

# Overly complex patterns
{"wildcard": {"field": "title", "value": "*?*?*?*"}}
```

## Real-World Examples

### E-Commerce Product Search

#### Product SKU Patterns
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "sku", 
      "value": "ELEC-*-2024"
    }
  }
}
```

#### Category Browsing
```http
POST /api/indices/products/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "category",
      "value": "electronics*"
    }
  }
}
```

### Content Management

#### Title Variations
```http
POST /api/indices/articles/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "title",
      "value": "*tutorial*"
    }
  }
}
```

#### Author Name Patterns
```http
POST /api/indices/articles/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "author",
      "value": "John*"
    }
  }
}
```

### User Management

#### Email Domain Filtering
```http
POST /api/indices/users/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "email",
      "value": "*@company.com"
    }
  }
}
```

#### Username Patterns
```http
POST /api/indices/users/_search
Content-Type: application/json

{
  "query": {
    "wildcard": {
      "field": "username",
      "value": "admin_*"
    }
  }
}
```

## Best Practices

### 1. Choose the Right Query Type

```http
# For exact matches → use term queries
{"term": {"field": "status", "value": "active"}}

# For text search → use match queries  
{"match": {"field": "description", "value": "high quality"}}

# For pattern matching → use wildcard queries
{"wildcard": {"field": "title", "value": "smart*"}}

# For all documents → use match_all
{"match_all": {}}
```

### 2. Optimize Wildcard Patterns

```http
# ✅ Good: Anchored patterns
{"wildcard": {"field": "title", "value": "prod*"}}

# ✅ Good: Specific fields
{"wildcard": {"field": "category", "value": "elect*"}}

# ⚠️ Avoid: Leading wildcards when possible
{"wildcard": {"field": "title", "value": "*phone"}}
```

### 3. Use Appropriate Pagination

```http
# For browsing scenarios
{
  "query": {"match_all": {}},
  "size": 20,
  "from": 0
}

# For large result sets
{
  "query": {"wildcard": {"field": "title", "value": "common*"}},
  "size": 50,
  "from": 0
}
```

### 4. Combine with Filters

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

### 5. Leverage Auto-Detection

```http
# Let the engine optimize automatically
{
  "query": {
    "match": {
      "field": "title",
      "value": "smart*"
    }
  }
}
```

## Error Handling

### Common Issues and Solutions

#### Pattern Too Broad
```http
# Issue: Returns too many results
{"wildcard": {"field": "title", "value": "*"}}

# Solution: Use match_all instead
{"match_all": {}}
```

#### Invalid Pattern Syntax
```http
# Issue: Malformed pattern
{"wildcard": {"field": "title", "value": "test**invalid"}}

# Solution: Clean pattern
{"wildcard": {"field": "title", "value": "test*"}}
```

## Summary

- **Match-All Queries**: Perfect for browsing and retrieving all documents
- **Wildcard Queries**: Excellent for pattern-based searches and filtering
- **Auto-Detection**: Automatically optimizes queries for best performance
- **Performance**: Fast response times with proper pattern design
- **Flexibility**: Multiple ways to achieve the same results

Use these query types to build powerful search experiences that handle both broad browsing and specific pattern matching needs! 