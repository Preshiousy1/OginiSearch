# 🎯 Performance Issues Tracker & Implementation Plan

**Date:** November 1, 2025  
**Status:** In Progress  
**Goal:** Fix all critical search performance issues identified in analysis

---

## ✅ PHASE 0: DATABASE OPTIMIZATION (COMPLETED)

### Issue: Missing Search Vectors & Inefficient Indexing
**Status:** ✅ DONE  
**Completion Date:** November 1, 2025

**What Was Done:**
1. ✅ Created consolidated `complete-search-optimization.sql` script
2. ✅ Added API endpoint `POST /debug/complete-search-optimization`
3. ✅ Fixed SQL parser to handle DO $$ and FUNCTION $$ blocks
4. ✅ Successfully executed optimization (82/82 statements, 0 errors, 28.6s)

**What Was Optimized:**
- ✅ Materialized columns (name, category, description, location)
- ✅ Boolean filter columns (is_active, is_verified, is_blocked)
- ✅ Search vectors (weighted_search_vector, search_vector, materialized_vector)
- ✅ 35 indexes created (including 6 critical indexes)
- ✅ Materialized view for active documents
- ✅ Helper functions for optimized searches
- ✅ Performance monitoring views

**Expected Impact:** 10-50x improvement on database queries

---

## 🔴 PHASE 1: CRITICAL QUERY IMPLEMENTATION (NEXT - HIGH PRIORITY)

### Issue #3: Query Plan Catastrophe - Multiple CTEs
**Status:** 🟡 IN PROGRESS  
**Priority:** CRITICAL  
**File:** `src/storage/postgresql/postgresql-search-engine.ts`

**Problem:**
Current query uses complex CTEs with multiple JSONB extractions:
```typescript
WITH field_rankings AS (
  SELECT
    CASE WHEN content->>'name' ILIKE ... -- Extract 1
    CASE WHEN content->>'category' ILIKE ... -- Extract 2
    // Multiple CASE statements, materializes entire result set
)
```

**Solution:** Replace with index-friendly query using materialized columns
**Reference:** `OPTIMIZED_SEARCH_IMPLEMENTATION.md` lines 15-86

**Implementation Steps:**
1. [ ] Replace `buildOptimizedSingleQuery` method
2. [ ] Add `buildWildcardQuery` method  
3. [ ] Update `buildCountQuery` method
4. [ ] Add helper methods (normalizeSearchQuery, shouldUseSimpleTextSearch)
5. [ ] Test with complex queries

**Expected Impact:** 3-5x improvement, sub-50ms simple queries

---

### Issue #4: Wildcard Query Implementation
**Status:** 🔴 NOT STARTED  
**Priority:** CRITICAL  
**File:** `src/storage/postgresql/postgresql-search-engine.ts`

**Problem:**
- Wildcards treated as literals: `"accurate*"` → searched as literal asterisk
- `ILIKE '%...%'` can't use B-tree indexes → sequential scan
- No trigram optimization

**Solution:**
- Parse wildcards properly: `"accurate*"` → `"accurate:*"` for tsquery
- Use trigram indexes for pattern matching
- Convert wildcards to SQL patterns for LIKE queries

**Implementation Steps:**
1. [ ] Add `processWildcardQuery()` method
2. [ ] Update search logic to detect wildcards
3. [ ] Use prefix search with tsquery for `*` wildcards
4. [ ] Use trigram similarity for pattern matching
5. [ ] Test: "fazsion*", "accurate* predict*"

**Expected Impact:** 5-10x improvement on wildcard queries, <100ms

---

### Issue #6: Filter Condition Overhead
**Status:** 🟢 MOSTLY DONE (Database level)  
**Priority:** HIGH  
**File:** `src/storage/postgresql/postgresql-search-engine.ts`

**Problem:**
```sql
WHERE (content->>'is_active')::boolean = true  -- JSONB extraction
```

**Solution:** Use materialized columns (already created by optimization)
```sql
WHERE is_active = true  -- Direct boolean column
```

**Implementation Steps:**
1. [ ] Update all queries to use materialized columns
2. [ ] Remove JSONB filter extractions
3. [ ] Use composite indexes for filter combinations
4. [ ] Test filtered queries

**Expected Impact:** 2-4x improvement on filtered queries

---

## 🟠 PHASE 2: APPLICATION-LEVEL OPTIMIZATIONS (HIGH PRIORITY)

### Issue #5: Duplicate Search Execution
**Status:** 🔴 NOT STARTED  
**Priority:** HIGH  
**Files:** Frontend + `src/search/search.service.ts`

**Problem:**
```
3:18:49 - Search 'fazsion*' in businesses: 15645ms
3:18:56 - Search 'fazsion*' in listings: 6136ms  
Total: 21781ms for same query
```

**Solution:**
1. [ ] Add query deduplication logic
2. [ ] Implement parallel search execution
3. [ ] Cache search results with proper invalidation
4. [ ] Investigate frontend duplicate requests

**Implementation Steps:**
1. [ ] Add `searchMultipleIndices()` method with Promise.all
2. [ ] Implement request deduplication middleware
3. [ ] Add Redis caching with 5-minute TTL
4. [ ] Review frontend search implementation
5. [ ] Test with multiple index searches

**Expected Impact:** 50% reduction in total search time

---

### Issue #2: Inefficient JSONB Querying (Application Level)
**Status:** 🟡 PARTIALLY DONE  
**Priority:** HIGH  
**Files:** All search-related services

**Problem:**
Application still extracting JSONB fields on the fly

**Solution:**
Use materialized columns in all queries

**Implementation Steps:**
1. [ ] Audit all SQL queries in codebase
2. [ ] Replace `content->>'field'` with direct column references
3. [ ] Update type definitions if needed
4. [ ] Test all search endpoints

**Expected Impact:** Covered by Phase 1 changes

---

### Issue #8: Connection Pool Saturation
**Status:** 🔴 NOT STARTED  
**Priority:** MEDIUM  
**File:** `src/storage/postgresql/postgresql.module.ts`

**Current:**
```typescript
max: 25,
min: 10,
acquireTimeoutMillis: 5000,
```

**Problem:**
- Too small for concurrent load
- 5s timeout causes cascading failures
- No connection validation

**Solution:**
```typescript
extra: {
  max: 100,              // Increased for production
  min: 20,              
  idle_in_transaction_session_timeout: 10000,
  statement_timeout: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
}
```

**Implementation Steps:**
1. [ ] Update connection pool configuration
2. [ ] Add connection validation
3. [ ] Implement connection health checks
4. [ ] Monitor connection pool utilization
5. [ ] Test under load

**Expected Impact:** Better handling of concurrent requests

---

### Issue #9: Typo Tolerance Overhead
**Status:** 🟢 PARTIALLY OPTIMIZED  
**Priority:** MEDIUM  
**Files:** `src/search/services/*`

**Current State:**
- Dictionary checks work
- SymSpell optimization exists
- Still adds 100-500ms latency

**Improvements Needed:**
1. [ ] Move typo correction to background (async)
2. [ ] Cache dictionary lookups
3. [ ] Only trigger when query returns no results
4. [ ] Optimize SymSpell index maintenance

**Implementation Steps:**
1. [ ] Make typo correction async (don't block main search)
2. [ ] Add Redis cache for typo suggestions
3. [ ] Implement smart triggering logic
4. [ ] Profile and optimize hotspots

**Expected Impact:** Reduce overhead from 100-500ms to <50ms

---

## 🟡 PHASE 3: ARCHITECTURAL IMPROVEMENTS (MEDIUM PRIORITY)

### Issue #7: No Table Partitioning
**Status:** 🔴 NOT STARTED  
**Priority:** MEDIUM  
**Complexity:** HIGH

**Problem:**
- Single documents table with 600K+ rows
- All queries scan entire table
- No locality of reference

**Solution:**
```sql
CREATE TABLE documents_partitioned (
  LIKE documents INCLUDING ALL
) PARTITION BY LIST (index_name);

CREATE TABLE documents_businesses 
  PARTITION OF documents_partitioned
  FOR VALUES IN ('businesses');

CREATE TABLE documents_listings 
  PARTITION OF documents_partitioned
  FOR VALUES IN ('listings');
```

**Implementation Steps:**
1. [ ] Design partition strategy
2. [ ] Create migration script
3. [ ] Test partition pruning
4. [ ] Migrate data in batches
5. [ ] Update application queries
6. [ ] Validate performance improvement

**Expected Impact:** 15-30% improvement on large datasets

**Note:** This is a major migration - do after Phase 1 & 2

---

### Issue #10: No Query Result Materialization
**Status:** 🟢 PARTIALLY DONE (Database level)  
**Priority:** MEDIUM

**Current:**
- Materialized view created by optimization
- Not used by application yet

**Implementation Steps:**
1. [ ] Implement query routing to use active_documents view
2. [ ] Add refresh strategy (hourly/on-demand)
3. [ ] Cache popular searches in Redis
4. [ ] Implement incremental updates
5. [ ] Monitor cache hit rates

**Expected Impact:** 2-3x on popular queries

---

## 📊 PHASE 4: MONITORING & VALIDATION (ONGOING)

### Performance Monitoring
**Status:** 🟡 TOOLS READY, NEED IMPLEMENTATION  
**Priority:** HIGH

**What's Available:**
- ✅ `slow_search_queries` view
- ✅ `index_usage_stats` view
- ✅ Debug endpoints for health checks

**TODO:**
1. [ ] Set up automated monitoring
2. [ ] Create performance dashboard
3. [ ] Add alerts for slow queries (>500ms)
4. [ ] Track P95/P99 latency
5. [ ] Monitor index usage

---

## 🎯 SUCCESS METRICS

### Current (Before Fixes):
| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Simple term search | 3-8s | <50ms | 🔴 |
| Wildcard search | 7-15s | <100ms | 🔴 |
| Multi-term search | 10-22s | <200ms | 🔴 |
| Filtered search | 6-20s | <150ms | 🔴 |
| Timeout rate | 40% | <1% | 🔴 |

### After Phase 1 (Expected):
| Metric | Expected | Status |
|--------|----------|--------|
| Simple term search | <200ms | 🟡 |
| Wildcard search | <500ms | 🟡 |
| Multi-term search | <1s | 🟡 |
| Timeout rate | <10% | 🟡 |

### After Phase 2 (Expected):
| Metric | Expected | Status |
|--------|----------|--------|
| Simple term search | <50ms | 🟢 |
| Wildcard search | <100ms | 🟢 |
| Multi-term search | <200ms | 🟢 |
| Timeout rate | <1% | 🟢 |

---

## 📋 IMMEDIATE NEXT STEPS

### Today (November 1):
1. ✅ Complete database optimization
2. ⏳ Verify all indexes created
3. ⏳ Implement new `buildOptimizedSingleQuery`
4. ⏳ Test with sample queries
5. ⏳ Measure performance improvement

### This Week:
1. Complete Phase 1 (Query Implementation)
2. Start Phase 2 (Application Optimizations)
3. Add performance monitoring
4. Test thoroughly in development
5. Deploy to staging

### Next Week:
1. Complete Phase 2
2. Plan Phase 3 migrations
3. Production deployment
4. Monitor and tune

---

## 🔧 TESTING CHECKLIST

Before each phase completion:

### Phase 1 Testing:
- [ ] Simple term: `"restaurant"` → <50ms, correct results
- [ ] Wildcard: `"fazsion*"` → <100ms, finds "Fazsion"
- [ ] Multi-term: `"accurate predict"` → <200ms
- [ ] Filtered: `is_active=true` → <150ms
- [ ] No regressions on existing queries

### Phase 2 Testing:
- [ ] Duplicate requests handled
- [ ] Parallel searches work
- [ ] Cache hit rate >50%
- [ ] Connection pool healthy
- [ ] Typo tolerance <100ms overhead

### Phase 3 Testing:
- [ ] Partitions working correctly
- [ ] No data loss during migration
- [ ] Query routing correct
- [ ] Performance as expected

---

## 📝 NOTES & LEARNINGS

### Key Insights:
1. Database optimization is foundational - must be done first
2. Materialized columns are game-changers for JSONB-heavy tables
3. GIN indexes + trigram indexes = fast full-text + wildcard search
4. Query structure matters more than index count
5. Monitor, measure, iterate

### Risks & Mitigations:
- **Risk:** Performance regressions during migration
  - **Mitigation:** Thorough testing, staged rollout
  
- **Risk:** Index maintenance overhead
  - **Mitigation:** Schedule maintenance during low-traffic periods
  
- **Risk:** Connection pool exhaustion during optimization
  - **Mitigation:** Increase pool size before Phase 2

---

**Last Updated:** November 1, 2025
**Next Review:** After Phase 1 completion

