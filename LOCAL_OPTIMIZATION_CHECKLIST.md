# Local Search Optimization Checklist

## Current Status Analysis (Local)

### ✅ **Already Completed**:
- [x] Optimized GIN indexes created (`idx_search_vector_optimized` - 73MB vs 84MB)
- [x] Materialized vector column exists (`materialized_vector`)
- [x] Materialized vector index created (`idx_materialized_vector`)  
- [x] Covering indexes created
- [x] Trigram indexes exist for fallback searches
- [x] Debug endpoints working locally

### ❌ **Critical Issue Identified**:
- **Search engine is NOT using the optimized `materialized_vector`**
- **Still using old `search_vector` in all queries**
- **Materialized vectors mostly empty (488k/498k empty)**

## Local Optimization Tasks

### Priority 1: Fix Search Vector Usage
- [ ] **Update query builders to use `materialized_vector` when available**
  - File: `src/storage/postgresql/query-builder.service.ts` (line 80, 85)
  - File: `src/storage/postgresql/query-builders/match-query-builder.ts` (line 51, 55)
  - File: `src/storage/postgresql/postgresql-query-builder.ts` (line 38, 41, 48)

### Priority 2: Populate Materialized Vectors
- [ ] **Create bulk population script for materialized vectors**
- [ ] **Update all 498,500 documents with proper materialized vectors**
- [ ] **Verify materialized vectors are populated correctly**

### Priority 3: Clean Up Redundant Code
- [ ] **Remove duplicate GIN indexes** (we have 3 GIN indexes on search_vector)
- [ ] **Remove unused index optimization services** 
- [ ] **Clean up redundant query builder classes**

### Priority 4: Performance Validation
- [ ] **Test search performance after fixes**
- [ ] **Target: <200ms average response time**
- [ ] **Verify index usage with EXPLAIN ANALYZE**

## Code Changes Required

### 1. Update Query Builder Service
```typescript
// In query-builder.service.ts, line 80:
// OLD: ts_rank_cd(sd.search_vector, ${tsqueryFunction}('english', $1))
// NEW: ts_rank_cd(COALESCE(sd.materialized_vector, sd.search_vector), ${tsqueryFunction}('english', $1))

// In query-builder.service.ts, line 85:
// OLD: AND sd.search_vector @@ ${tsqueryFunction}('english', $1)
// NEW: AND COALESCE(sd.materialized_vector, sd.search_vector) @@ ${tsqueryFunction}('english', $1)
```

### 2. Create Materialized Vector Population Script
```sql
-- Bulk update materialized vectors
UPDATE search_documents sd 
SET materialized_vector = 
  setweight(to_tsvector('english', coalesce(d.content->>'name', '')), 'A') ||
  setweight(to_tsvector('english', coalesce(d.content->>'title', '')), 'A') ||
  setweight(to_tsvector('english', coalesce(d.content->>'description', '')), 'B') ||
  setweight(to_tsvector('english', coalesce(d.content->>'category_name', '')), 'B') ||
  setweight(to_tsvector('english', coalesce(d.content->>'tags', '')), 'C')
FROM documents d 
WHERE sd.document_id = d.document_id 
AND sd.index_name = d.index_name 
AND (sd.materialized_vector IS NULL OR sd.materialized_vector = to_tsvector('english', ''));
```

### 3. Remove Redundant Indexes
```sql
-- Keep only the optimized GIN index
DROP INDEX IF EXISTS idx_search_vector;
DROP INDEX IF EXISTS idx_search_documents_search_vector;
-- Keep: idx_search_vector_optimized
```

## Railway Deployment Checklist

### Pre-Deployment
- [ ] All local optimizations tested and validated
- [ ] Performance targets met locally (<200ms)
- [ ] Code cleanup completed
- [ ] Database migration scripts prepared

### Deployment Steps
1. [ ] Deploy code changes
2. [ ] Run materialized vector population via debug endpoint
3. [ ] Drop redundant indexes
4. [ ] Verify search performance
5. [ ] Monitor for 30 minutes

### Rollback Plan
- [ ] Revert code to use `search_vector` only
- [ ] Keep existing indexes as backup
- [ ] Monitor performance

## Performance Targets

### Local (Before Railway)
- [ ] Technology search: <200ms (currently 669ms)
- [ ] Wildcard search: <200ms (currently 709ms)  
- [ ] Filtered search: <300ms (currently 1311ms)

### Railway (After Deployment)
- [ ] Technology search: <100ms
- [ ] Wildcard search: <150ms
- [ ] Filtered search: <200ms

## Current Performance Issues

1. **Not using optimized indexes**: Search queries use `search_vector` instead of `materialized_vector`
2. **Empty materialized vectors**: 98% of vectors are empty
3. **Multiple redundant indexes**: 3 GIN indexes doing the same thing
4. **Query plan inefficiency**: Not leveraging covering indexes

## Next Steps

1. **Fix search vector usage** (highest priority)
2. **Populate materialized vectors** 
3. **Clean up redundant code**
4. **Validate performance locally**
5. **Deploy to Railway with checklist** 