# 🚀 OPTIMIZED SEARCH QUERY IMPLEMENTATION

## Overview
This document provides the optimized PostgreSQL query implementations that leverage the new indexes and materialized columns.

---

## 📋 IMPLEMENTATION CHECKLIST

### Priority 1: Update `buildOptimizedSingleQuery` in `postgresql-search-engine.ts`

**Current Problem:** Complex CTE with multiple JSONB extractions  
**Solution:** Simple, index-friendly query

```typescript
/**
 * Build optimized single query - USES INDEXES EFFECTIVELY
 * This is the MAIN query that should replace the existing implementation
 */
private buildOptimizedSingleQuery(
  indexName: string,
  searchTerm: string,
  size: number,
  from: number,
  filter?: any,
): { sql: string; params: any[] } {
  const normalizedTerm = this.normalizeSearchQuery(searchTerm);
  
  // Handle match_all queries
  if (normalizedTerm === '*' || normalizedTerm === '') {
    const sql = `
      SELECT
        document_id,
        content,
        metadata,
        1.0 as rank
      FROM documents
      WHERE index_name = $1
        AND is_active = true
        AND is_verified = true
        AND is_blocked = false
      ORDER BY document_id
      LIMIT $2 OFFSET $3
    `;
    return { sql, params: [indexName, size, from] };
  }

  // Check if wildcard query (contains * or ?)
  const isWildcard = normalizedTerm.includes('*') || normalizedTerm.includes('?');
  
  if (isWildcard) {
    // WILDCARD SEARCH - Uses trigram indexes
    return this.buildWildcardQuery(indexName, normalizedTerm, size, from);
  }

  // STANDARD FULL-TEXT SEARCH - Uses GIN indexes on tsvector
  const sql = `
    SELECT
      document_id,
      content,
      metadata,
      -- Boost exact matches
      CASE 
        WHEN lower(name) = lower($1) THEN 1000.0
        WHEN lower(name) LIKE lower($1) || '%' THEN 500.0
        ELSE ts_rank_cd(weighted_search_vector, query, 32) * 100
      END as rank
    FROM documents,
         plainto_tsquery('english', $1) query
    WHERE index_name = $2
      AND is_active = true
      AND is_verified = true
      AND is_blocked = false
      AND (
        lower(name) LIKE lower($1) || '%'
        OR weighted_search_vector @@ query
      )
    ORDER BY rank DESC, name
    LIMIT $3 OFFSET $4
  `;
  
  return { 
    sql, 
    params: [normalizedTerm, indexName, size, from] 
  };
}

/**
 * Build wildcard query - Uses trigram indexes for pattern matching
 */
private buildWildcardQuery(
  indexName: string,
  pattern: string,
  size: number,
  from: number,
): { sql: string; params: any[] } {
  // Convert wildcards to SQL pattern
  // "fazsion*" -> "fazsion%"
  // "accurate* predict*" -> "accurate% predict%"
  const sqlPattern = pattern
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');

  const sql = `
    SELECT
      document_id,
      content,
      metadata,
      -- Scoring based on match quality
      CASE 
        WHEN lower(name) LIKE lower($1) THEN 1000.0
        WHEN lower(name) LIKE lower($1) || '%' THEN 500.0
        WHEN lower(name) LIKE '%' || lower($1) || '%' THEN 100.0
        WHEN lower(category) LIKE '%' || lower($1) || '%' THEN 50.0
        ELSE similarity(name, $1) * 100
      END as rank
    FROM documents
    WHERE index_name = $2
      AND is_active = true
      AND is_verified = true
      AND is_blocked = false
      AND (
        lower(name) LIKE '%' || lower($1) || '%'
        OR lower(category) LIKE '%' || lower($1) || '%'
      )
    ORDER BY rank DESC, name
    LIMIT $3 OFFSET $4
  `;
  
  // Remove wildcards from search term for LIKE comparison
  const cleanTerm = pattern.replace(/[*?]/g, '');
  
  return { 
    sql, 
    params: [cleanTerm, indexName, size, from] 
  };
}

/**
 * Build count query - OPTIMIZED
 */
private buildCountQuery(
  indexName: string,
  searchTerm: string,
  filter?: any,
): { sql: string; params: any[] } {
  const normalizedTerm = this.normalizeSearchQuery(searchTerm);
  
  if (normalizedTerm === '*' || normalizedTerm === '') {
    return {
      sql: `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
      `,
      params: [indexName]
    };
  }

  const isWildcard = normalizedTerm.includes('*') || normalizedTerm.includes('?');
  const cleanTerm = normalizedTerm.replace(/[*?]/g, '');
  
  if (isWildcard) {
    return {
      sql: `
        SELECT COUNT(*) as total_count
        FROM documents
        WHERE index_name = $1
          AND is_active = true
          AND is_verified = true
          AND is_blocked = false
          AND (
            lower(name) LIKE '%' || lower($2) || '%'
            OR lower(category) LIKE '%' || lower($2) || '%'
          )
      `,
      params: [indexName, cleanTerm]
    };
  }

  return {
    sql: `
      SELECT COUNT(*) as total_count
      FROM documents,
           plainto_tsquery('english', $1) query
      WHERE index_name = $2
        AND is_active = true
        AND is_verified = true
        AND is_blocked = false
        AND (
          lower(name) LIKE lower($1) || '%'
          OR weighted_search_vector @@ query
        )
    `,
    params: [normalizedTerm, indexName]
  };
}
```

---

## 🔧 Additional Helper Methods

```typescript
/**
 * Normalize search query - Clean and prepare for search
 */
private normalizeSearchQuery(query: string): string {
  if (!query) return '';
  
  // Remove extra whitespace
  const normalized = query.trim().replace(/\s+/g, ' ');
  
  // Handle empty or wildcard-only queries
  if (normalized === '' || normalized === '*') {
    return '*';
  }
  
  return normalized;
}

/**
 * Check if query should use simple text search
 */
private shouldUseSimpleTextSearch(query: string): boolean {
  // Use simple text search for:
  // - Short queries
  // - Wildcard queries  
  // - Single word queries
  return (
    query.length <= 2 ||
    query.includes('*') ||
    query.includes('?') ||
    !query.includes(' ')
  );
}

/**
 * Extract search term from complex query object
 */
private extractSearchTerm(searchQuery: any): string {
  if (typeof searchQuery.query === 'string') {
    return searchQuery.query;
  }

  if (searchQuery.query?.match?.value) {
    return searchQuery.query.match.value;
  }

  if (searchQuery.query?.wildcard?.value) {
    return searchQuery.query.wildcard.value;
  }

  return '';
}
```

---

## 🎯 Performance Optimization Tips

### 1. **Always Use Prepared Statements**
```typescript
// Good - uses prepared statement
await this.dataSource.query(sql, params);

// Bad - vulnerable to SQL injection and slower
await this.dataSource.query(`SELECT * FROM documents WHERE name = '${userInput}'`);
```

### 2. **Leverage Index-Only Scans**
```typescript
// Add INCLUDE clause to indexes for covering index
CREATE INDEX idx_documents_search 
ON documents(index_name, is_active) 
INCLUDE (document_id, name, rank);
```

### 3. **Use EXPLAIN ANALYZE**
```typescript
private async explainQuery(sql: string, params: any[]): Promise<void> {
  const plan = await this.dataSource.query(`EXPLAIN ANALYZE ${sql}`, params);
  this.logger.debug('Query Plan:', plan);
}
```

### 4. **Monitor Slow Queries**
```typescript
// Add query timing middleware
private async executeWithTiming(sql: string, params: any[]) {
  const start = Date.now();
  const result = await this.dataSource.query(sql, params);
  const duration = Date.now() - start;
  
  if (duration > 100) {
    this.logger.warn(`Slow query (${duration}ms): ${sql.substring(0, 100)}...`);
  }
  
  return result;
}
```

---

## 📊 Expected Query Plans

### Good Query Plan (Using Indexes)
```
Limit  (cost=0.42..45.21 rows=10 width=1234) (actual time=2.345..3.456 rows=10 loops=1)
  ->  Index Scan using idx_documents_weighted_search_vector on documents
      Index Cond: (weighted_search_vector @@ to_tsquery(...))
      Filter: ((index_name = 'businesses') AND is_active AND is_verified AND NOT is_blocked)
      Rows Removed by Filter: 0
Planning Time: 0.234 ms
Execution Time: 3.678 ms
```

### Bad Query Plan (Sequential Scan)
```
Limit  (cost=0.00..5234567.89 rows=10 width=1234) (actual time=8234.567..8456.789 rows=10 loops=1)
  ->  Seq Scan on documents  ❌ SEQUENTIAL SCAN - BAD!
      Filter: ((index_name = 'businesses') AND (content->>'name' ~~* '%fazsion%'))
      Rows Removed by Filter: 598234  ❌ SCANNING 600K ROWS - BAD!
Planning Time: 1.234 ms
Execution Time: 8456.789 ms  ❌ 8 SECONDS - TERRIBLE!
```

---

## 🧪 Testing Queries

### Test 1: Simple Term Search
```sql
-- Should use idx_documents_weighted_search_vector
-- Expected: <50ms
EXPLAIN ANALYZE
SELECT document_id, name, 
       ts_rank_cd(weighted_search_vector, plainto_tsquery('english', 'restaurant')) as rank
FROM documents
WHERE index_name = 'businesses'
  AND is_active = true
  AND is_verified = true
  AND is_blocked = false
  AND weighted_search_vector @@ plainto_tsquery('english', 'restaurant')
ORDER BY rank DESC
LIMIT 15;
```

### Test 2: Wildcard Search
```sql
-- Should use idx_documents_name_trgm
-- Expected: <100ms
EXPLAIN ANALYZE
SELECT document_id, name,
       similarity(name, 'fazsion') as sim
FROM documents
WHERE index_name = 'businesses'
  AND is_active = true
  AND is_verified = true
  AND is_blocked = false
  AND lower(name) LIKE '%fazsion%'
ORDER BY sim DESC, name
LIMIT 15;
```

### Test 3: Multi-term Search  
```sql
-- Should use idx_documents_weighted_search_vector
-- Expected: <100ms
EXPLAIN ANALYZE
SELECT document_id, name,
       ts_rank_cd(weighted_search_vector, plainto_tsquery('english', 'accurate predict')) as rank
FROM documents
WHERE index_name = 'businesses'
  AND is_active = true
  AND is_verified = true
  AND is_blocked = false
  AND weighted_search_vector @@ plainto_tsquery('english', 'accurate predict')
ORDER BY rank DESC
LIMIT 15;
```

---

## 🚨 Common Mistakes to Avoid

### ❌ DON'T: Use JSONB extraction in WHERE clause
```sql
WHERE content->>'is_active' = 'true'  -- SLOW!
```

### ✅ DO: Use materialized columns
```sql
WHERE is_active = true  -- FAST!
```

---

### ❌ DON'T: Use OR conditions across different index types
```sql
WHERE weighted_search_vector @@ query 
   OR content->>'name' ILIKE '%' || $1 || '%'  -- Can't use either index!
```

### ✅ DO: Use separate queries or proper index
```sql
WHERE weighted_search_vector @@ query  -- Uses GIN index
-- OR separate query for ILIKE
```

---

### ❌ DON'T: Nest too many CTEs
```sql
WITH cte1 AS (...),
     cte2 AS (SELECT * FROM cte1 ...),
     cte3 AS (SELECT * FROM cte2 ...)
SELECT * FROM cte3;  -- Multiple materializations!
```

### ✅ DO: Keep queries simple and flat
```sql
SELECT * FROM documents WHERE ...  -- Direct, simple
```

---

## 📈 Performance Benchmarks

### Target Performance (After Optimization)

| Query Type | Current | Target | Improvement |
|------------|---------|--------|-------------|
| Simple term ("restaurant") | 3-8s | <50ms | **60-160x** |
| Exact match ("Fazsion") | 8s | <30ms | **250x** |
| Wildcard ("fazsion*") | 15s | <100ms | **150x** |
| Multi-term ("accurate predict") | 22s | <200ms | **110x** |
| Filtered search | 6-20s | <150ms | **40-133x** |

---

## 🔄 Deployment Steps

1. **Backup Database**
   ```bash
   pg_dump -h localhost -U postgres ogini_search > backup_before_optimization.sql
   ```

2. **Run Optimization Script**
   ```bash
   psql -h localhost -U postgres ogini_search -f scripts/complete-search-optimization.sql
   ```

3. **Update Application Code**
   - Replace `buildOptimizedSingleQuery` with new implementation
   - Deploy to staging first
   - Test thoroughly

4. **Monitor Performance**
   ```sql
   SELECT * FROM slow_search_queries;
   SELECT * FROM index_usage_stats;
   ```

5. **Gradual Rollout**
   - Deploy to 10% of traffic
   - Monitor for 1 hour
   - Increase to 50%
   - Monitor for 2 hours
   - Full deployment

---

## 📞 Support & Monitoring

### Key Metrics to Monitor
- Average query time (target: <200ms)
- P95 query time (target: <500ms)
- P99 query time (target: <1s)
- Timeout rate (target: <0.1%)
- Cache hit rate (target: >70%)
- Database CPU usage (target: <60%)
- Connection pool utilization (target: <80%)

### Alert Thresholds
- ⚠️  Warning: Average query time > 500ms
- 🚨 Critical: Average query time > 1s
- 🚨 Critical: Timeout rate > 5%
- 🚨 Critical: Database CPU > 80%

---

## ✅ Success Criteria

- [ ] All search vectors populated (100% coverage)
- [ ] All critical indexes created
- [ ] Query plans show index usage (no Seq Scans)
- [ ] Average query time < 200ms
- [ ] P95 query time < 500ms
- [ ] Timeout rate < 1%
- [ ] No performance regression on any query type
- [ ] Staging environment validated
- [ ] Production monitoring in place

