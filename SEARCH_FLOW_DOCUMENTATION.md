# Search Execution Flow & Data Transformations

## Complete Search Request Lifecycle

### 1. API Entry Point: SearchController
```
POST /api/indices/:index/_search
├── Body: SearchQueryDto
├── Query Params: size, from
└── Headers: Content-Type: application/json
```

**Data Flow**:
```typescript
SearchController.search() 
  ↓ [SearchQueryDto]
QueryProcessorService.processQuery()
  ↓ [ProcessedQuery] 
PostgreSQLSearchEngine.search()
  ↓ [PostgreSQLSearchResult]
SearchController.formatResponse()
  ↓ [HTTP Response]
```

### 2. Query Processing Pipeline

#### Stage 1: Query Parser (QueryProcessorService)
**Input**: Raw query object from HTTP request
```json
{
  "query": { "match": { "value": "ugo*" } },
  "filter": { "bool": { "must": [...] } },
  "size": 15,
  "from": 0
}
```

**Processing Steps**:
1. **Query Type Detection** (`parseQuery()`):
   - String query → `parseStringQuery()`
   - Object query → Check for wildcard/match/term/match_all
   - Wildcard detection: `query.includes('*') || query.includes('?')`

2. **Wildcard Query Creation**:
```typescript
// From match query: { "match": { "value": "ugo*" } }
// Becomes: WildcardQuery
{
  type: 'wildcard',
  field: 'name', // or '_all'
  pattern: 'ugo*',
  value: 'ugo*',
  fields: ['name', 'slug', 'tags', ...]
}
```

3. **Field Resolution**:
   - Default fields: `['name', 'slug', 'tags', 'id_number', 'category_name', 'average_rating', 'contact_emails.array']`
   - Extracted from index mappings or hardcoded fallbacks

**Output**: `ProcessedQuery` object

#### Stage 2: Search Engine Execution (PostgreSQLSearchEngine)

##### Phase A: Cache Check
```typescript
generateCacheKey(indexName, searchQuery) // Expensive JSON.stringify
queryCache.get(cacheKey) // Map lookup
if (cached && not expired) return cached.results
```

##### Phase B: Query Analysis & Term Extraction
```typescript
// Convert various query formats to search term
if (typeof query === 'string') tsquery = query
else if (query.match?.value) tsquery = String(query.match.value)
else if (query.wildcard?.value) tsquery = String(query.wildcard.value)
```

##### Phase C: Primary Search Execution
**SQL Generation**:
```sql
SELECT 
  d.document_id, d.content, d.metadata,
  ts_rank_cd(sd.search_vector, plainto_tsquery('english', $1)) as postgresql_score
FROM search_documents sd
JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
WHERE sd.index_name = $2 
  AND sd.search_vector @@ plainto_tsquery('english', $1)
ORDER BY postgresql_score DESC
LIMIT $3
```

**Parallel Execution**:
```typescript
Promise.all([
  dataSource.query(sqlQuery, [searchTerm, indexName, candidateLimit]),
  dataSource.query(countQuery, [searchTerm, indexName])
])
```

**Data Transformation**:
```
Raw DB Rows → Array of { document_id, content, metadata, postgresql_score }
```

##### Phase D: Fallback Mechanism (THE BOTTLENECK)
**Trigger Conditions**:
```typescript
if (result.length === 0 || hasWildcard) {
  // Execute ILIKE fallback
}
```

**Wildcard Detection**:
```typescript
const hasWildcard = /[\*\?]/.test(searchTerm); // Always true for "ugo*"
```

**Fallback SQL Construction**:
```typescript
const likePattern = searchTerm.replace(/\*/g, '%').replace(/\?/g, '_'); // "ugo*" → "ugo%"
const fields = ['name', 'title', 'description', 'slug', 'tags', 'category_name'];
const fieldCondsSelect = fields
  .map(f => `d.content->>'${f}' ILIKE $3`)
  .join(' OR ');
```

**Generated Fallback SQL** (SLOW):
```sql
SELECT d.document_id, d.content, d.metadata, 1.0::float AS postgresql_score
FROM documents d
WHERE d.index_name = $1 AND (
  d.content->>'name' ILIKE $3 OR 
  d.content->>'slug' ILIKE $3 OR 
  d.content->>'tags' ILIKE $3 OR 
  d.content->>'id_number' ILIKE $3 OR 
  d.content->>'category_name' ILIKE $3 OR 
  d.content->>'average_rating' ILIKE $3
)
ORDER BY d.document_id
LIMIT $2::int OFFSET $4::int
```

**Why This is Slow**:
1. Table scan on `documents` (larger table)
2. No indexes on `content->>'field'` expressions
3. Multiple ILIKE conditions with OR
4. Separate COUNT(*) query for total

##### Phase E: BM25 Re-ranking
**Input**: Array of candidate documents
**Process**:
```typescript
// For each candidate document
candidates.map(candidate => {
  let bm25Score = 0;
  
  // Calculate score for each field
  for (const [fieldName, fieldWeight] of fieldWeights) {
    if (candidate.content[fieldName]) {
      const fieldContent = String(candidate.content[fieldName]).toLowerCase();
      
      // Calculate term frequency for each query term
      for (const term of queryTerms) {
        const termFreq = calculateTermFrequency(fieldContent, term);
        if (termFreq > 0) {
          const fieldScore = bm25Scorer.score(term, documentId, fieldName, termFreq);
          bm25Score += fieldScore * fieldWeight;
        }
      }
    }
  }
  
  // Combine PostgreSQL and BM25 scores
  const finalScore = postgresqlScore * 0.3 + bm25Score * 0.7;
  return { id, score: finalScore, document };
});
```

**Field Weights** (Hardcoded):
```typescript
{
  name: 3.0, title: 3.0, headline: 3.0, subject: 3.0,
  category: 2.0, type: 2.0, classification: 2.0,
  description: 1.5, summary: 1.5, content: 1.5,
  tags: 1.5, keywords: 1.5, labels: 1.5
}
```

##### Phase F: Final Processing
1. **Sort by Combined Score**: `rerankedCandidates.sort((a, b) => b.score - a.score)`
2. **Pagination**: `rerankedHits.slice(from, from + size)`
3. **Response Formatting**:
```typescript
{
  hits: hits.map(hit => ({ id: hit.id, score: hit.score, source: hit.document })),
  total: totalHits,
  maxScore: Math.max(...hits.map(h => h.score))
}
```

### 3. Data Structure Transformations

#### A. HTTP Request → SearchQueryDto
```json
{
  "query": { "match": { "value": "ugo*" } },
  "filter": { "bool": { "must": [{"term": {"field": "is_active", "value": true}}] } },
  "size": 15,
  "from": 0
}
```

#### B. SearchQueryDto → SQL Parameters
```typescript
// Primary query
[searchTerm, indexName, candidateLimit] = ["ugo*", "businesses", 150]

// Fallback query  
[indexName, candidateLimit, likePattern, from] = ["businesses", 150, "ugo%", 0]
```

#### C. Database Rows → Search Results
```typescript
// DB Row
{
  document_id: "123",
  content: { name: "Ugo Motors", slug: "ugo-motors", ... },
  metadata: { created_at: "2024-01-01", ... },
  postgresql_score: 0.8
}

// After BM25 Re-ranking
{
  id: "123",
  score: 2.4, // Combined score
  document: { name: "Ugo Motors", slug: "ugo-motors", ... }
}

// Final HTTP Response
{
  hits: [{ id: "123", score: 2.4, source: { name: "Ugo Motors", ... } }],
  total: 251,
  maxScore: 2.4,
  took: 1732 // milliseconds
}
```

### 4. Performance Critical Paths

#### Fast Path (PostgreSQL Full-Text Search)
```
HTTP Request → Query Parser → tsquery Generation → GIN Index Lookup → BM25 Re-ranking → Response
Time: ~200-300ms
```

#### Slow Path (ILIKE Fallback) 
```
HTTP Request → Query Parser → Fallback Trigger → Table Scan + Multiple ILIKE → BM25 Re-ranking → Response  
Time: ~1500-2000ms (5-7x slower)
```

### 5. Current Issues in Data Flow

#### A. Unnecessary Fallback Triggers
- **Problem**: All wildcard queries trigger fallback, even simple "term*" patterns
- **Impact**: 5-7x performance degradation
- **Solution**: Use `to_tsquery('term:*')` for simple trailing wildcards

#### B. Inefficient Field Resolution
- **Problem**: Hardcoded field lists, no index-specific optimization
- **Impact**: Searches irrelevant fields, increases query time
- **Solution**: Dynamic field selection based on query analysis

#### C. Debug Log Overhead
- **Problem**: 10+ debug logs per search request in production
- **Impact**: 50-100ms additional latency
- **Solution**: Remove or use conditional debug logging

#### D. Cache Key Generation Cost
- **Problem**: `JSON.stringify(searchQuery)` on every request  
- **Impact**: 5-10ms per request
- **Solution**: Implement efficient cache key generation

### 6. Optimization Opportunities

1. **Smart Query Routing**: Detect simple patterns and use optimized paths
2. **Index-Aware Field Selection**: Use only relevant fields for each index
3. **Lazy Fallback**: Only trigger fallback if primary search yields insufficient results
4. **Batch Processing**: Combine COUNT and SELECT queries where possible
5. **Result Streaming**: Return results as they become available for large result sets

This documentation reveals that the current search flow has multiple unnecessary performance bottlenecks that can be addressed through targeted optimizations without requiring a complete architectural overhaul. 