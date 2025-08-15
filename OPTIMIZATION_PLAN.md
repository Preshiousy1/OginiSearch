# PostgreSQL Search Engine Optimization Plan

## Executive Summary
This plan outlines a phased approach to optimize the PostgreSQL Search Engine, addressing both immediate performance issues and long-term architectural improvements. The goal is to restore search performance to under 300ms while improving code maintainability.

## Phase 1: Immediate Performance Recovery (Target: 1-2 days)

### 1.1 Remove Debug Log Overhead
**Impact**: 50-100ms improvement per request
**Files**: `postgresql-search-engine.ts`, `query-processor.service.ts`

**Actions**:
```typescript
// REMOVE these debug logs (added in recent commits):
this.logger.debug(`executeSearch: index='${indexName}' term='${searchTerm}'...`);
this.logger.debug(`executeSearch SQL: ${sqlQuery}`);
this.logger.debug(`executeSearch params: ${JSON.stringify(params)}`);
this.logger.debug(`executeSearch Fallback SQL: ${fallbackSql}`);
this.logger.debug(`executeSearch Fallback params: ...`);
this.logger.debug(`executeSearch Fallback: rows=${fallbackRows.length}...`);
this.logger.debug(`parseMatchQuery: wildcard from match value=...`);
this.logger.debug(`createWildcardQuery: field='${field}' value=...`);
```

**Implementation Strategy**:
- Use `git revert` on commits that added debug logs
- Keep minimal error logging only
- Add conditional debug logging behind feature flag for development

### 1.2 Smart Wildcard Query Routing
**Impact**: 80% improvement for simple wildcard queries (1700ms → 300ms)
**Target**: Simple trailing wildcard patterns like "ugo*", "lexus*"

**Current Problematic Logic**:
```typescript
// ALWAYS triggers fallback for ANY wildcard
const hasWildcard = /[\*\?]/.test(searchTerm);
if (result.length === 0 || hasWildcard) {
  // Expensive ILIKE fallback
}
```

**Optimized Logic**:
```typescript
// Detect simple trailing wildcard patterns
const isSimpleTrailingWildcard = /^[a-zA-Z0-9]+\*$/.test(searchTerm);

if (isSimpleTrailingWildcard) {
  // Use fast PostgreSQL prefix search
  const prefixTerm = searchTerm.replace('*', '');
  const tsQuery = `to_tsquery('english', '${prefixTerm}:*')`;
  // Execute using existing GIN index (fast)
} else if (result.length === 0 && hasComplexWildcard) {
  // Only use ILIKE fallback for complex patterns like "*term*", "te?m"
}
```

### 1.3 Limit Fallback Search Scope  
**Impact**: 60% improvement for fallback queries
**Current**: Searches 6+ fields with OR conditions
**Optimized**: Search only 1-2 most relevant fields

**Implementation**:
```typescript
// Current (slow)
const fields = ['name', 'title', 'description', 'slug', 'tags', 'category_name'];

// Optimized (fast)
const priorityFields = searchQuery.fields?.slice(0, 2) || ['name', 'slug'];
```

### 1.4 Results
**Expected Performance After Phase 1**:
- Simple wildcard queries: 1700ms → 300ms (83% improvement)
- Regular queries: 1700ms → 200ms (88% improvement)  
- Cache hits: 50ms → 10ms (80% improvement)

## Phase 2: Database Optimizations (Target: 3-5 days)

### 2.1 Add Trigram Indexes for ILIKE Fallbacks
**Impact**: 70% improvement for complex wildcard queries

**Required Indexes**:
```sql
-- Enable trigram extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram indexes for most searched fields
CREATE INDEX CONCURRENTLY idx_businesses_name_trgm 
  ON documents USING gin ((lower(content->>'name')) gin_trgm_ops)
  WHERE index_name = 'businesses';

CREATE INDEX CONCURRENTLY idx_businesses_slug_trgm 
  ON documents USING gin ((lower(content->>'slug')) gin_trgm_ops)  
  WHERE index_name = 'businesses';

-- Composite index for common filter combinations
CREATE INDEX CONCURRENTLY idx_businesses_active_verified
  ON documents USING btree (index_name, (content->>'is_active'), (content->>'is_verified'))
  WHERE index_name = 'businesses';
```

### 2.2 Optimize Query Patterns
**Combine COUNT and SELECT queries**:
```sql
-- Current: Two separate queries
SELECT COUNT(*) FROM table WHERE conditions;
SELECT * FROM table WHERE conditions LIMIT 10;

-- Optimized: Single query with window function  
SELECT *, COUNT(*) OVER() as total_count 
FROM table WHERE conditions LIMIT 10;
```

### 2.3 Add Query Plan Monitoring
```typescript
// Add query performance monitoring
private async executeWithPlan(sql: string, params: any[]) {
  const start = performance.now();
  const result = await this.dataSource.query(sql, params);
  const duration = performance.now() - start;
  
  if (duration > 500) { // Log slow queries
    this.logger.warn(`Slow query detected: ${duration}ms`);
    // Optional: Get EXPLAIN ANALYZE for slow queries
  }
  
  return result;
}
```

## Phase 3: Function Decomposition (Target: 1-2 weeks)

### 3.1 Break Down `executeSearch()` Function
**Current**: 166 lines, 7+ responsibilities
**Target**: 6 focused functions, each < 30 lines

#### Proposed New Structure:
```typescript
class PostgreSQLSearchEngine {
  // Main orchestrator (20-30 lines)
  async executeSearch(indexName: string, tsquery: string, searchQuery: SearchQueryDto) {
    const queryStrategy = this.analyzeQuery(tsquery, searchQuery);
    const executor = this.getExecutor(queryStrategy);
    const rawResults = await executor.execute(indexName, tsquery, searchQuery);
    const rankedResults = await this.resultProcessor.process(rawResults, tsquery);
    return this.paginateResults(rankedResults, searchQuery);
  }

  // 1. Query Analysis (15-20 lines)
  private analyzeQuery(tsquery: string, searchQuery: SearchQueryDto): QueryStrategy {
    return new QueryAnalyzer().analyze(tsquery, searchQuery);
  }

  // 2. Executor Selection (10-15 lines)
  private getExecutor(strategy: QueryStrategy): SearchExecutor {
    switch (strategy.type) {
      case 'fast_text_search': return this.fastSearchExecutor;
      case 'simple_wildcard': return this.simpleWildcardExecutor;
      case 'complex_wildcard': return this.fallbackExecutor;
      default: return this.fastSearchExecutor;
    }
  }
}
```

#### New Classes to Create:
```typescript
// 1. Query Strategy Analysis
class QueryAnalyzer {
  analyze(tsquery: string, searchQuery: SearchQueryDto): QueryStrategy {
    // Determine optimal search strategy based on query pattern
  }
}

// 2. Fast Search Executor (PostgreSQL FTS)
class FastSearchExecutor implements SearchExecutor {
  async execute(indexName: string, tsquery: string, options: SearchOptions): Promise<RawSearchResult> {
    // Handle standard full-text search using search_documents table
  }
}

// 3. Simple Wildcard Executor (tsquery prefix)
class SimpleWildcardExecutor implements SearchExecutor {
  async execute(indexName: string, tsquery: string, options: SearchOptions): Promise<RawSearchResult> {
    // Handle "term*" patterns using to_tsquery('term:*')
  }
}

// 4. Fallback Executor (ILIKE)
class FallbackSearchExecutor implements SearchExecutor {
  async execute(indexName: string, tsquery: string, options: SearchOptions): Promise<RawSearchResult> {
    // Handle complex wildcards using optimized ILIKE with indexes
  }
}

// 5. Result Processor (BM25 + pagination)
class SearchResultProcessor {
  async process(rawResults: RawSearchResult[], searchTerm: string): Promise<RankedSearchResult[]> {
    // Handle BM25 re-ranking and result processing
  }
}
```

### 3.2 Break Down `buildSearchQuery()` Function
**Current**: 171 lines handling 6+ query types
**Target**: Separate query builders

#### Proposed Structure:
```typescript
// Abstract base
abstract class QueryBuilder {
  abstract build(query: any, params: any[], paramIndex: number): QueryBuildResult;
}

// Specific implementations
class MatchQueryBuilder extends QueryBuilder { /* 20-30 lines */ }
class TermQueryBuilder extends QueryBuilder { /* 15-20 lines */ }
class WildcardQueryBuilder extends QueryBuilder { /* 25-35 lines */ }
class BoolQueryBuilder extends QueryBuilder { /* 30-40 lines */ }
class MatchAllQueryBuilder extends QueryBuilder { /* 10-15 lines */ }

// Factory
class QueryBuilderFactory {
  static create(queryType: string): QueryBuilder {
    switch (queryType) {
      case 'match': return new MatchQueryBuilder();
      case 'term': return new TermQueryBuilder();
      case 'wildcard': return new WildcardQueryBuilder();
      case 'bool': return new BoolQueryBuilder();
      default: return new MatchAllQueryBuilder();
    }
  }
}
```

### 3.3 Simplify Filter Building
**Current**: 80 lines of nested bool logic
**Target**: Recursive filter builder

```typescript
class FilterBuilder {
  buildConditions(filter: any): FilterResult {
    if (filter.bool) return this.buildBoolFilter(filter.bool);
    if (filter.term) return this.buildTermFilter(filter.term);
    if (filter.range) return this.buildRangeFilter(filter.range);
    throw new Error(`Unsupported filter type`);
  }

  private buildBoolFilter(boolFilter: any): FilterResult {
    const mustClauses = boolFilter.must?.map(clause => this.buildConditions(clause)) || [];
    const shouldClauses = boolFilter.should?.map(clause => this.buildConditions(clause)) || [];
    const mustNotClauses = boolFilter.must_not?.map(clause => this.buildConditions(clause)) || [];
    
    return this.combineClauses(mustClauses, shouldClauses, mustNotClauses);
  }
}
```

## Phase 4: Advanced Optimizations (Target: 2-3 weeks)

### 4.1 Implement Smart Caching
**Current Issues**:
- Expensive cache key generation
- No LRU eviction
- No cache warming

**Optimized Cache System**:
```typescript
class OptimizedQueryCache {
  private cache = new LRUCache<string, CacheEntry>({ max: 1000 });
  
  // Fast cache key generation (no JSON.stringify)
  generateKey(indexName: string, query: SearchQueryDto): string {
    const queryHash = this.hashQuery(query); // Use fast hash function
    return `${indexName}:${queryHash}`;
  }
  
  // Cache warming for popular queries
  async warmCache(indexName: string, popularQueries: string[]) {
    // Pre-populate cache with common searches
  }
}
```

### 4.2 Implement Result Streaming
**For large result sets**:
```typescript
class StreamingSearchExecutor {
  async* searchStream(indexName: string, query: SearchQueryDto): AsyncGenerator<SearchHit[]> {
    let offset = 0;
    const batchSize = 100;
    
    while (true) {
      const batch = await this.executeSearchBatch(indexName, query, offset, batchSize);
      if (batch.length === 0) break;
      
      yield batch;
      offset += batchSize;
    }
  }
}
```

### 4.3 Add Adaptive Query Optimization
```typescript
class AdaptiveQueryOptimizer {
  // Learn from query patterns and optimize automatically
  optimizeQuery(query: SearchQueryDto, indexStats: IndexStats): OptimizedQuery {
    // Analyze query performance history
    // Suggest index usage patterns
    // Recommend field weights based on user behavior
  }
}
```

## Phase 5: Configuration & Monitoring (Target: 1 week)

### 5.1 Make Configuration Dynamic
**Remove hardcoded values**:
```typescript
// Current: Hardcoded
fieldWeights: { name: 3.0, title: 3.0, ... }

// Optimized: Configuration-driven
class SearchConfiguration {
  getFieldWeights(indexName: string): FieldWeights {
    return this.config.indices[indexName]?.fieldWeights || this.defaultFieldWeights;
  }
}
```

### 5.2 Add Performance Monitoring
```typescript
class SearchMetrics {
  recordSearchLatency(indexName: string, queryType: string, duration: number): void;
  recordCacheHitRate(indexName: string, hitRate: number): void;
  recordSlowQuery(sql: string, duration: number): void;
  
  getPerformanceReport(): PerformanceReport {
    // Generate performance insights
  }
}
```

## Phase 6: Testing & Validation (Target: 1 week)

### 6.1 Performance Testing Suite
```typescript
class SearchPerformanceTests {
  async testSimpleQueries(): Promise<PerformanceReport>;
  async testWildcardQueries(): Promise<PerformanceReport>;
  async testComplexFilters(): Promise<PerformanceReport>;
  async testCachePerformance(): Promise<PerformanceReport>;
}
```

### 6.2 Load Testing
- Test with 500K+ documents
- Concurrent user simulation  
- Memory usage monitoring
- Query plan analysis

## Expected Results After All Phases

### Performance Targets:
- **Simple queries**: < 150ms (current: 1700ms)
- **Simple wildcards**: < 200ms (current: 1700ms)  
- **Complex wildcards**: < 400ms (current: 1700ms)
- **Cache hits**: < 5ms (current: 50ms)
- **Memory usage**: Stable (no leaks)

### Code Quality Improvements:
- **Function size**: All functions < 50 lines
- **Cyclomatic complexity**: Low to medium
- **Test coverage**: > 85%
- **Maintainability**: High (single responsibility functions)

### Operational Benefits:
- **Monitoring**: Real-time performance metrics
- **Debugging**: Focused, targeted logging
- **Scalability**: Horizontal scaling ready
- **Configuration**: Dynamic, environment-specific

## Risk Mitigation

### Rollback Plan:
- Each phase includes rollback procedures
- Feature flags for new implementations
- A/B testing for performance comparisons
- Gradual deployment strategy

### Testing Strategy:
- Unit tests for each new component
- Integration tests for search flows
- Performance regression tests
- Production monitoring during rollout

This optimization plan provides a clear path to restore and exceed previous search performance while dramatically improving code maintainability and operational capabilities. 