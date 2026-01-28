# ⚖️ Architecture Comparison: PostgreSQL vs MongoDB+RocksDB

**Date:** December 2025  
**Comparison Type:** Full architectural and performance analysis  
**Purpose:** Determine optimal architecture path for ConnectSearch/Ogini

---

## 📊 Executive Summary

### Quick Comparison

| Aspect | PostgreSQL Architecture | MongoDB+RocksDB Architecture |
|--------|------------------------|------------------------------|
| **Search Performance** | ❌ 6-22 seconds (critical issues) | ⚠️ 10-200ms (but incomplete results) |
| **Data Integrity** | ✅ Complete (all documents indexed) | 🔴 **Missing 99% of matches for common terms** |
| **Memory Usage** | ✅ Stable (~200MB) | ⚠️ 34-100MB (needs management) |
| **Query Flexibility** | ❌ Limited to tsquery | ✅ Full boolean/phrase/wildcard |
| **Deployment Complexity** | ✅ Single database | ⚠️ Dual storage system |
| **MongoDB 16MB Limit** | ✅ Not applicable | 🔴 **Causes data truncation** |
| **Status** | 🔴 Production (slow) | 🔴 **Abandoned due to data loss** |

### Key Finding

**The MongoDB+RocksDB architecture was abandoned due to a fundamental design flaw: MongoDB's 16MB document limit causes data loss (99% of matches truncated for common terms). This is not a simple fix - it requires architectural changes that may or may not be worth pursuing.**

---

## 🏗 Architecture Comparison

### Data Model

#### PostgreSQL Architecture
```sql
-- Single table design
CREATE TABLE documents (
    document_id VARCHAR(255),
    index_name VARCHAR(255),
    content JSONB,                    -- Full document
    search_vector TSVECTOR,          -- Full-text index
    materialized_vector TSVECTOR,    -- Optimized vector
    metadata JSONB,
    PRIMARY KEY (document_id, index_name)
);

-- Problem: Everything in one table
-- Problem: JSONB extraction on every query
-- Problem: Inconsistent vector usage
```

#### MongoDB+RocksDB Architecture
```javascript
// Separated concerns
// MongoDB: Documents
{
  index_name: "businesses",
  document_id: "doc123",
  content: { /* full document */ }
}

// RocksDB: Inverted Index
"term:businesses:name:restaurant" → PostingList
{
  "doc123": { frequency: 2, positions: [0, 15] },
  "doc456": { frequency: 1, positions: [5] }
}

// Advantage: Clean separation
// Advantage: Optimized for each use case
```

**Winner:** MongoDB+RocksDB - Better separation of concerns

---

### Indexing Strategy

#### PostgreSQL: Full-Text Search Vectors
```sql
-- PostgreSQL approach
search_vector = to_tsvector('english', 
  content->>'name' || ' ' || 
  content->>'description'
);

-- Issues:
-- 1. Vector generation during insert (slow)
-- 2. Inconsistent population (many NULL vectors)
-- 3. Limited to PostgreSQL's tokenization
-- 4. Can't customize per-field
```

#### MongoDB+RocksDB: Inverted Index
```typescript
// Inverted index approach
for (const term of analyzeDocument(document)) {
  postingList.add(documentId, {
    frequency: termCount,
    positions: termPositions,
    field: 'name'
  });
}

// Advantages:
// 1. Custom tokenization per field
// 2. Term-level control
// 3. Position information for phrase queries
// 4. Field-specific indexing
```

**Winner:** MongoDB+RocksDB - More flexible and powerful

---

### Search Query Execution

#### PostgreSQL: SQL-Based Search
```sql
-- PostgreSQL query (simplified)
SELECT document_id, content, 
       ts_rank_cd(search_vector, query) as rank
FROM documents
WHERE search_vector @@ to_tsquery('english', 'restaurant')
ORDER BY rank DESC
LIMIT 10;

-- Issues:
-- 1. Limited to PostgreSQL's query syntax
-- 2. JSONB extraction overhead
-- 3. Complex CTEs materialize entire results
-- 4. Can't use indexes effectively
```

#### MongoDB+RocksDB: Inverted Index Lookup
```typescript
// Inverted index query
const postingList1 = termDictionary.get('restaurant'); // <1ms
const postingList2 = termDictionary.get('food');       // <1ms
const intersection = postingList1.intersect(postingList2); // 5ms
const documents = fetchDocuments(intersection.docIds); // 50ms
// Total: ~60ms

// Advantages:
// 1. O(log n) term lookup
// 2. Fast set operations (AND/OR)
// 3. No JSONB extraction
// 4. Uses indexes effectively
```

**Winner:** MongoDB+RocksDB - Faster and more efficient

---

## 📈 Performance Comparison

### Indexing Performance

| Metric | PostgreSQL | MongoDB+RocksDB |
|--------|------------|-----------------|
| Single document | 50-200ms | 10-50ms |
| Batch (100 docs) | 2-5 seconds | 500-2000ms |
| Bulk (1000 docs) | 20-60 seconds | 5-20 seconds |
| Memory overhead | Low | Medium (managed) |

**Winner:** MongoDB+RocksDB (2-3x faster)

---

### Search Performance

#### Simple Term Query: "restaurant"

| Architecture | Query Time | Notes |
|--------------|------------|-------|
| PostgreSQL | **3-8 seconds** | ❌ Sequential scan, missing indexes |
| MongoDB+RocksDB (hot) | **<10ms** | ✅ In-memory lookup |
| MongoDB+RocksDB (cold) | **20-50ms** | ✅ RocksDB lookup |
| MongoDB+RocksDB (fallback) | **50-200ms** | ⚠️ MongoDB lookup |

**Winner:** MongoDB+RocksDB (300-800x faster)

---

#### Multi-Term Query: "restaurant food"

| Architecture | Query Time | Notes |
|--------------|------------|-------|
| PostgreSQL | **10-22 seconds** | ❌ Complex CTE, sequential scans |
| MongoDB+RocksDB (hot) | **20-50ms** | ✅ Set intersection |
| MongoDB+RocksDB (cold) | **50-150ms** | ✅ RocksDB + set ops |
| MongoDB+RocksDB (fallback) | **200-500ms** | ⚠️ MongoDB queries |

**Winner:** MongoDB+RocksDB (200-1000x faster)

---

#### Wildcard Query: "rest*"

| Architecture | Query Time | Notes |
|--------------|------------|-------|
| PostgreSQL | **7-15 seconds** | ❌ ILIKE pattern, no index usage |
| MongoDB+RocksDB | **100-300ms** | ✅ Term prefix matching |

**Winner:** MongoDB+RocksDB (50-150x faster)

---

### Memory Usage

| Architecture | Startup | Under Load | Peak | Status |
|--------------|---------|------------|------|--------|
| PostgreSQL | ~150MB | ~200MB | ~300MB | ✅ Stable |
| MongoDB+RocksDB | ~34MB | ~50-100MB | ~150MB | ✅ Stable (after fixes) |

**Winner:** Tie - Both stable with proper management

---

### Query Flexibility

#### Supported Query Types

| Query Type | PostgreSQL | MongoDB+RocksDB |
|------------|------------|-----------------|
| Single term | ✅ | ✅ |
| Multi-term | ✅ | ✅ |
| Phrase query | ✅ (limited) | ✅ (full) |
| Boolean (AND/OR/NOT) | ✅ (limited) | ✅ (full) |
| Wildcard | ⚠️ (slow) | ✅ |
| Field-specific | ⚠️ (complex) | ✅ |
| Nested queries | ❌ | ✅ |

**Winner:** MongoDB+RocksDB - More flexible query language

---

## 🔍 Detailed Feature Comparison

### 1. Text Analysis & Tokenization

#### PostgreSQL
- **Tokenization:** PostgreSQL's built-in (limited customization)
- **Stemming:** PostgreSQL's language-specific stemmers
- **Stopwords:** Built-in stopword lists
- **Custom Analyzers:** Not possible
- **Per-Field Analysis:** Limited

#### MongoDB+RocksDB
- **Tokenization:** Custom tokenizers (Standard, NGram, Whitespace)
- **Stemming:** Porter stemmer integration
- **Stopwords:** Custom stopword lists (70+ words)
- **Custom Analyzers:** Full support
- **Per-Field Analysis:** Different analyzer per field

**Winner:** MongoDB+RocksDB - Much more flexible

---

### 2. Relevance Scoring

#### PostgreSQL: `ts_rank_cd`
```sql
ts_rank_cd(search_vector, query)
-- Limitations:
-- - Fixed algorithm
-- - Can't customize k1/b parameters
-- - Limited field weighting
```

#### MongoDB+RocksDB: BM25
```typescript
bm25Score(termFrequency, documentFrequency, fieldLength, {
  k1: 1.2,  // Configurable
  b: 0.75,  // Configurable
  fieldWeights: {
    title: 3.0,      // Per-field weights
    description: 1.0
  }
})
```

**Winner:** MongoDB+RocksDB - More sophisticated and configurable

---

### 3. Data Storage

#### PostgreSQL: Single Table
- **Documents:** JSONB in `documents` table
- **Index:** tsvector columns in same table
- **Metadata:** JSONB columns
- **Problem:** JSONB extraction overhead

#### MongoDB+RocksDB: Separated Storage
- **Documents:** MongoDB (optimized for document storage)
- **Index:** RocksDB (optimized for key-value lookups)
- **Metadata:** Both systems
- **Advantage:** Each system optimized for its purpose

**Winner:** MongoDB+RocksDB - Better separation, no JSONB overhead

---

### 4. Indexing Strategy

#### PostgreSQL: Search Vectors
- **Vector Generation:** On insert (can be slow)
- **Storage:** In table (bloat)
- **Updates:** Requires recalculating vector
- **Issues:** Inconsistent population, missing vectors

#### MongoDB+RocksDB: Inverted Index
- **Index Building:** Incremental (fast)
- **Storage:** Separate key-value store
- **Updates:** Add/remove postings only
- **Advantage:** Always consistent, fast updates

**Winner:** MongoDB+RocksDB - More efficient and reliable

---

## 🚨 Critical Issues Comparison

### PostgreSQL Architecture Issues

1. **Missing/Incomplete Search Vectors** 🔴
   - Many documents have NULL vectors
   - Queries fall back to slow JSONB ILIKE
   - **Impact:** 90% of performance degradation
   - **Fixable:** Yes (batch update vectors, ensure triggers work)

2. **Inefficient JSONB Querying** 🔴
   - Extracting JSONB fields on every query
   - Can't use indexes effectively
   - **Impact:** 50-70% performance hit
   - **Fixable:** Yes (add materialized columns)

3. **Complex Query Patterns** 🔴
   - CTEs materialize entire result sets
   - Multiple JSONB extractions per row
   - **Impact:** 30-50% overhead
   - **Fixable:** Yes (simplify query patterns)

4. **Query Performance** 🔴
   - 6-22 second query times
   - 40% timeout rate
   - **Impact:** System unusable at scale
   - **Fixable:** Yes (with proper indexes and query optimization)

**Verdict:** All PostgreSQL issues are **fixable** (4-6 weeks estimated)

---

### MongoDB+RocksDB Architecture Issues

1. **MongoDB 16MB Document Limit - DATA LOSS** 🔴 CATASTROPHIC
   - Common terms (500K+ matches) exceed 16MB limit
   - Current workaround: Truncate to 5,000 entries (99% data loss)
   - **Impact:** Hundreds of thousands of businesses missing from search
   - **Status:** **FUNDAMENTAL FLAW** - Cannot store large posting lists
   - **Fixable:** Only with major refactoring (Solution #3: separate documents)
   - **Fix Cost:** 1-2 weeks + performance testing required

2. **Memory Management Complexity** 🟡 (RESOLVED)
   - Required LRU cache management
   - **Status:** Fixed with memory limits
   - **Impact:** Low (now stable)

3. **Dual Storage Overhead** 🟡
   - Writes to both systems
   - **Impact:** 20-30% indexing overhead
   - **Fixable:** Yes (async writes)

4. **Deployment Complexity** 🟡
   - Two systems to manage
   - **Impact:** Operational overhead
   - **Fixable:** No (architectural requirement)

**Verdict:** MongoDB 16MB limit is a **fundamental design flaw** that requires architectural changes to fix

---

## 🎯 The Critical Question: Is Solution #3 Viable?

### What Is Solution #3?

Store posting entries as **separate MongoDB documents** instead of nested objects:

```javascript
// Current (broken): One document per term
{ term: "limited", postings: { doc1: {...}, doc2: {...}, ...500K entries } }

// Solution #3: One document per posting entry
{ term: "limited", documentId: "doc1", frequency: 1, positions: [0] }
{ term: "limited", documentId: "doc2", frequency: 1, positions: [5] }
// ... 500K separate documents
```

### Critical Evaluation

**Pros:**
- ✅ Solves 16MB limit completely
- ✅ Each document small (~200 bytes)
- ✅ MongoDB can handle large collections

**Cons & Unknowns:**
- ❓ **Query Performance:** Can MongoDB query 500K documents fast enough?
  - With index `{ indexName: 1, term: 1 }`: Could be 50-500ms (needs testing)
  - Without proper index: Could be 5-30 seconds (unacceptable)
- ❓ **Storage Overhead:** 2-3x storage increase (acceptable if performance works)
- ❓ **Query Complexity:** Must aggregate postings in application (added latency)
- ⚠️ **Development Cost:** 1-2 weeks refactoring + testing

**Unknown Critical Factor:**
- **Can MongoDB efficiently query 500K documents with `find({ term: "limited" })`?**
  - This is the make-or-break question
  - If it's 500ms+: Acceptable but not great
  - If it's 5+ seconds: Unacceptable, architecture unsalvageable

**Verdict:** ⚠️ **NEEDS PROOF-OF-CONCEPT BEFORE COMMITMENT**

**Recommendation:** Build a POC to test query performance for 500K-document terms before deciding.

---

## 💡 Design Philosophy Comparison

### PostgreSQL: Relational Database as Search Engine

**Philosophy:** Use PostgreSQL's built-in full-text search capabilities

**Pros:**
- Single database system
- ACID transactions
- Mature and stable
- Good for small-medium datasets

**Cons:**
- Not designed for search
- Limited query flexibility
- JSONB overhead
- Scaling challenges

**Best For:** Small datasets (<100K docs), simple queries, teams familiar with SQL

---

### MongoDB+RocksDB: Purpose-Built Search Index

**Philosophy:** Build a proper inverted index optimized for search

**Pros:**
- True inverted index (industry standard)
- Flexible query language
- Superior performance at scale
- Customizable text analysis

**Cons:**
- More complex to operate
- Dual storage pattern
- Memory management required
- More moving parts

**Best For:** Large datasets (100K+ docs), complex queries, performance-critical applications

---

## 🎯 Performance at Scale

### 600K Documents (Current Production Scale)

| Operation | PostgreSQL | MongoDB+RocksDB (Current - Broken) | MongoDB+RocksDB (Solution #3 - Theoretical) |
|-----------|------------|-----------------------------------|---------------------------------------------|
| Simple search | 3-8 seconds | ❌ Incomplete results (99% missing) | ⚠️ 50-500ms (needs testing) |
| Complex search | 10-22 seconds | ❌ Incomplete results | ⚠️ 200-1000ms (needs testing) |
| Data integrity | ✅ Complete | 🔴 **Missing 99% for common terms** | ✅ Complete (if Solution #3 works) |
| Indexing throughput | 20 docs/sec | 50-100 docs/sec | 50-100 docs/sec |
| Memory usage | ~200MB | ~50-100MB | ~50-100MB |

**Reality:** MongoDB+RocksDB current state is **broken** (data loss). Solution #3 is unproven.

---

### Projected at 1M+ Documents

| Operation | PostgreSQL | MongoDB+RocksDB |
|-----------|------------|-----------------|
| Simple search | 10-30 seconds | <20ms |
| Complex search | 30+ seconds | 50-300ms |
| Indexing throughput | 10 docs/sec | 50-100 docs/sec |
| Memory usage | ~500MB | ~100-200MB |

**Clear Winner:** MongoDB+RocksDB (performance gap widens)

---

## 🔧 Fix Complexity Comparison

### Fixing PostgreSQL Performance Issues

**Required Fixes:**
1. Populate all search vectors (batch update)
2. Create GIN indexes on all vectors
3. Add materialized columns for filters
4. Rewrite all queries to use materialized columns
5. Implement query optimization
6. Add table partitioning

**Estimated Effort:** 4-6 weeks  
**Complexity:** High (architectural changes)

**Risk:** May still not reach MongoDB+RocksDB performance

---

### Fixing MongoDB+RocksDB 16MB Limit

**Required Fixes:**
1. ✅ Memory management (DONE)
2. **Solution #3: Refactor to separate posting documents** ⚠️
   - Change MongoDB schema (fundamental change)
   - Update all query code to aggregate postings
   - Performance testing required
3. MongoDB index optimization (critical for Solution #3)
4. Async MongoDB writes
5. Parallel restoration

**Estimated Effort:** 1-2 weeks + testing  
**Complexity:** **High** (architectural change, not just optimization)

**Risk:** **High** - Unknown if Solution #3 will meet performance requirements
- Need to test 500K-document query performance first
- May discover MongoDB can't handle efficiently
- May need to abandon after investment

**Critical Unknown:**
- **Will MongoDB query 500K documents fast enough?** (50-200ms acceptable, 5+ seconds not)

---

## 📊 Cost Comparison

### Infrastructure Costs

| Component | PostgreSQL | MongoDB+RocksDB |
|-----------|------------|-----------------|
| Primary DB | PostgreSQL | MongoDB |
| Index Storage | PostgreSQL | RocksDB (local) |
| Memory | ~200MB | ~100MB |
| CPU | High (slow queries) | Low (fast queries) |

**Winner:** Tie (similar infrastructure needs)

---

### Operational Costs

| Task | PostgreSQL | MongoDB+RocksDB |
|------|------------|-----------------|
| Deployment | Simple | Medium |
| Monitoring | Single system | Two systems |
| Backup | PostgreSQL only | Both systems |
| Maintenance | Standard | More complex |
| Debugging | SQL queries | Inverted index logic |

**Winner:** PostgreSQL (simpler operations)

---

## 🎯 Recommendation Matrix

### Choose PostgreSQL If:

✅ **Small Dataset** (<100K documents)  
✅ **Simple Queries** (basic full-text search)  
✅ **SQL Expertise** (team familiar with PostgreSQL)  
✅ **Simpler Operations** (prefer single database)  
✅ **ACID Requirements** (need transactions)

### Choose MongoDB+RocksDB If:

✅ **Large Dataset** (100K+ documents)  
✅ **Complex Queries** (boolean, phrase, wildcard)  
✅ **Performance Critical** (sub-100ms requirements)  
✅ **Flexible Text Analysis** (custom analyzers needed)  
✅ **Scalability** (planning for millions of documents)

---

## 🏆 Final Verdict

### Performance Winner: **MongoDB+RocksDB**

- 300-800x faster search queries
- 2-3x faster indexing
- Better query flexibility
- Superior at scale

### Simplicity Winner: **PostgreSQL**

- Single database system
- Easier deployment
- Simpler operations
- Lower learning curve

### Overall Winner: **UNCLEAR - NEEDS TESTING**

**Critical Analysis:**

**PostgreSQL:**
- ✅ All issues are fixable (known solutions)
- ✅ No data loss
- ⚠️ 4-6 weeks to fix
- ⚠️ Performance may still not reach target after fixes

**MongoDB+RocksDB:**
- ✅ Architecture theoretically superior
- ✅ Memory issues resolved
- 🔴 **16MB limit causes data loss (current state broken)**
- ⚠️ Solution #3 requires architectural refactoring (1-2 weeks)
- ❓ **Unknown if Solution #3 will perform well** (needs POC)

**Critical Unknown:**
- **Can Solution #3 (separate documents) query 500K postings fast enough?**
  - If yes (50-500ms): Worth pursuing
  - If no (5+ seconds): Architecture unsalvageable

**Recommendation:** **Build POC for Solution #3 before making decision**

---

## 🎯 Recommended Path Forward - Critical Assessment

### Option 1: Fix PostgreSQL (4-6 weeks)
**Effort:** High  
**Risk:** Medium (may not reach target performance, but issues are fixable)  
**Result:** Simpler system, all data intact, but potentially still slow  
**Certainty:** High (known solutions exist)

### Option 2: Fix MongoDB+RocksDB with Solution #3 (1-2 weeks + testing)
**Effort:** Medium-High  
**Risk:** **High** (unknown if Solution #3 will perform well)  
**Result:** Unknown until POC proves it  
**Certainty:** **Low** (needs proof-of-concept first)  

**Required Steps:**
1. **Build POC** for Solution #3 (1 week)
2. **Benchmark** 500K-document query performance
3. **If acceptable:** Proceed with full refactoring (1-2 weeks)
4. **If unacceptable:** Abandon MongoDB approach

### Option 3A: Hybrid Approach - PostgreSQL GIN for Posting Lists (4-6 weeks)
**Option 3A: Hybrid Approach - PostgreSQL GIN for Posting Lists**

**Components:**
- PostgreSQL GIN indexes for posting lists (B-tree handles 500K+ entries natively)
- Keep MongoDB for documents (optional - could use PostgreSQL for documents too)
- Best of both worlds: PostgreSQL's built-in B-trees + existing document storage

**Why This Could Work:**
- PostgreSQL GIN indexes use B-trees internally (no 16MB limit)
- Handles large posting lists automatically (no application code needed)
- No need to rebuild B-tree logic in MongoDB
- Well-tested, optimized database feature

**Complexity:** Medium-High (3-4 weeks)  
**Risk:** Medium (hybrid system, but known technology)  
**Verdict:** 🤔 **Worth considering if Solution #3 POC fails**

---

**Option 3B: Just Fix PostgreSQL (4-6 weeks)**

**Components:**
- Fix PostgreSQL performance issues (indexes, materialized columns)
- Use PostgreSQL for both documents AND posting lists
- Single database system

**Why This Might Be Simplest:**
- No hybrid complexity
- PostgreSQL GIN indexes handle large posting lists
- Fixes known issues with known solutions

**Complexity:** High (but known solutions)  
**Risk:** Medium (may still not reach target performance)  
**Verdict:** ⚠️ **Simplest path, but may not achieve best performance**

---

## 📝 Conclusion - No Bias Assessment

### Why MongoDB+RocksDB Was Abandoned - REAL REASONS

1. **MongoDB 16MB Limit = Data Loss** 🔴
   - Common terms exceed 16MB (500K+ documents)
   - Current workaround: Truncate to 5,000 entries (99% data loss)
   - **This is why it was abandoned** - not a fixable optimization issue

2. **Memory Issues** 🟡 (RESOLVED)
   - Was a problem, but fixable and now fixed
   - Not the primary reason for abandonment

### Current State Assessment

**PostgreSQL Architecture:**
- ❌ Slow (6-22 seconds)
- ✅ All data intact
- ✅ Issues are fixable (known solutions)
- ⚠️ 4-6 weeks to fix
- ⚠️ May still not reach target performance

**MongoDB+RocksDB Architecture:**
- ✅ Fast when working (<10ms)
- 🔴 **Broken** (99% data loss for common terms)
- ⚠️ Solution #3 might work (needs POC)
- ❓ Unknown if Solution #3 will perform well
- ⚠️ Requires architectural refactoring (1-2 weeks + testing)

### Critical Unknown: Solution #3 Performance

**Before recommending MongoDB+RocksDB, we must answer:**
- Can MongoDB efficiently query 500K documents with proper indexes?
- Will query performance be acceptable (50-500ms) or slow (5+ seconds)?
- Is the storage overhead (2-3x) acceptable?

**Without testing, recommending Solution #3 is speculation, not analysis.**

### Honest Recommendation

**Do not commit to MongoDB+RocksDB without proof-of-concept.**

**Step 1:** Build POC for Solution #3 (separate posting documents)
- Test with 500K-document term
- Measure query performance with indexes
- Measure storage overhead

**Step 2:** Based on POC results:
- **If POC performs well (<500ms):** Proceed with MongoDB+RocksDB refactoring
- **If POC performs poorly (>2 seconds):** Abandon MongoDB, fix PostgreSQL

**Step 3:** If MongoDB POC fails, consider hybrid approach
- PostgreSQL B-trees for posting lists (handles 500K+ entries)
- MongoDB for documents (if needed)
- Or just fix PostgreSQL (simpler)

### Final Verdict

**Neither architecture is clearly superior without more data.**

- **PostgreSQL:** Known fixes, but may still be slow
- **MongoDB+RocksDB:** Could be fast, but needs architectural fix that may not work

**Recommendation:** **Test Solution #3 before making a decision. Don't commit to 1-2 weeks of work based on theory alone.**

---

**Document Status:** Complete  
**Recommendation:** Build POC for Solution #3 before making decision. Both architectures have critical issues requiring careful evaluation.  
**Last Updated:** December 2025

