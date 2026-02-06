# Post-Fix Verification Test Plan

**Date**: February 5, 2026  
**Status**: Ready for Testing  
**All Critical Fixes**: ✅ Implemented

## Pre-Test Checklist

- [x] All TypeScript compilation errors fixed
- [x] Build succeeds (`npm run build`)
- [x] Server starts without errors
- [x] Redis backing confirmed in logs: "BulkOperationTrackerService initialized with Redis backing"
- [x] RocksDB connected: "Connected to RocksDB successfully"
- [x] Search query parser bug fixed (no more crashes on `{"match": {"title": "value"}}`)

## Test Objectives

Validate that all architectural fixes resolve the critical issues:

1. **100% Term Persistence Success** (was 10-15%)
2. **Accurate Document Counts** (was 73/8000)
3. **State Survives Restarts** (BulkOperationTracker)
4. **Search Queries Work** (no crashes)

---

## Test 1: Clean Slate Bulk Indexing

### Purpose
Verify the complete flow with a fresh index to ensure all components work together.

### Steps

1. **Clean up old test index**:
   ```bash
   curl -X DELETE http://localhost:3000/api/indices/bulk-test-fresh
   ```

2. **Create new test index**:
   ```bash
   curl -X POST http://localhost:3000/api/indices \
     -H "Content-Type: application/json" \
     -d '{
       "name": "bulk-test-fresh",
       "mappings": {
         "title": {"type": "text", "weight": 2},
         "description": {"type": "text", "weight": 1}
       },
       "settings": {"analyzer": "standard"}
     }'
   ```

3. **Run bulk indexing script** (modify to use 1000 documents for quick test):
   ```bash
   cd /Users/preciousatam/Documents/ConnectNigeria/ConnectSearch
   npm run ts-node scripts/testing/measure-bulk-indexing.ts -- --count 1000 --indexName bulk-test-fresh
   ```

4. **Monitor logs** in terminal:
   - Look for: "Successfully indexed batch ... X/Y docs, Z dirty terms"
   - Look for: "✅ Persisted X/Y terms" (should be >90% success rate)
   - Look for: "🎉 Bulk operation COMPLETED"

5. **Verify document count**:
   ```bash
   curl -X GET http://localhost:3000/api/indices/bulk-test-fresh \
     | jq '.documentCount'
   ```
   **Expected**: 1000 (not 100 or 73)

6. **Verify term persistence** by searching:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"title": "test"}}, "size": 10}'
   ```
   **Expected**: Returns results (not 0 hits)

7. **Check RocksDB persistence** by searching for a specific term:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"title": "document"}}, "size": 10}'
   ```
   **Expected**: Multiple hits (documents indexed)

### Success Criteria

- ✅ All 1000 documents indexed
- ✅ Document count = 1000 (accurate)
- ✅ Term persistence success rate > 95%
- ✅ Search returns results
- ✅ No "No posting list found" warnings in logs

---

## Test 2: Server Restart (Redis State Persistence)

### Purpose
Verify that `BulkOperationTrackerService` state survives server restarts via Redis.

### Steps

1. **Start a bulk indexing operation**:
   ```bash
   npm run ts-node scripts/testing/measure-bulk-indexing.ts -- --count 5000 --indexName bulk-test-restart
   ```

2. **Wait for ~50% completion** (check logs for batch progress)

3. **Kill the server**:
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

4. **Restart the server**:
   ```bash
   npm run dev:start
   ```

5. **Check logs for Redis restoration**:
   ```
   [BulkOperationTrackerService] Restored X active bulk operations from Redis
   ```

6. **Verify operation can still be queried** (via API if exposed, or check logs)

### Success Criteria

- ✅ Redis restoration log appears
- ✅ Active operations count matches pre-restart
- ✅ Indexing can resume (if applicable)
- ✅ No "Bulk operation ... not found" warnings after restart

---

## Test 3: Search Query Format Compatibility

### Purpose
Verify the query parser handles multiple query formats without crashing.

### Steps

Test all these query formats:

1. **Standard Elasticsearch format**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"title": "test"}}, "size": 5}'
   ```

2. **Custom format**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"field": "title", "value": "test"}}, "size": 5}'
   ```

3. **Match_all**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match_all": {}}, "size": 10}'
   ```

4. **Wildcard**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"wildcard": {"title": "test*"}}, "size": 5}'
   ```

5. **Term query**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-fresh/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"term": {"title": "test"}}, "size": 5}'
   ```

### Success Criteria

- ✅ All queries return valid responses (no 500 errors)
- ✅ No "Cannot read properties of undefined" errors
- ✅ Results are reasonable (not necessarily non-empty, but valid structure)

---

## Test 4: RocksDB Durability (Cache Eviction)

### Purpose
Verify that terms persist to RocksDB even after memory cache eviction.

### Steps

1. **Index documents with many unique terms** (force LRU eviction):
   ```bash
   # Generate 10,000 documents with random terms
   npm run ts-node scripts/testing/measure-bulk-indexing.ts -- --count 10000 --indexName bulk-test-eviction
   ```

2. **Wait for indexing to complete**

3. **Search for a term that was likely evicted** (from early batches):
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-eviction/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"title": "document"}}, "size": 10}'
   ```

4. **Check persistence logs** for failures:
   ```bash
   grep "No posting list found" /path/to/terminal.txt | wc -l
   ```

### Success Criteria

- ✅ Term persistence failure rate < 5% (was 85-90%)
- ✅ Search returns results for early terms
- ✅ Document count is accurate (10,000/10,000)

---

## Test 5: Concurrent Batch Processing

### Purpose
Verify that concurrent batch indexing doesn't cause race conditions in document counts or dirty term tracking.

### Steps

1. **Run bulk indexing with high concurrency**:
   ```bash
   # Ensure BATCH_CONCURRENCY is set high (e.g., 12)
   npm run ts-node scripts/testing/measure-bulk-indexing.ts -- --count 8000 --indexName bulk-test-concurrent
   ```

2. **Monitor logs for batch completion**:
   - Look for: "Batch complete: X indexed, Y skipped"
   - Look for: "Successfully indexed batch ... Z dirty terms"

3. **Verify final document count**:
   ```bash
   curl -X GET http://localhost:3000/api/indices/bulk-test-concurrent \
     | jq '.documentCount'
   ```

4. **Run count rebuild to verify accuracy**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-concurrent/rebuild-count
   ```
   Should return same count (no discrepancy)

### Success Criteria

- ✅ Document count matches expected (8000)
- ✅ No duplicate documents
- ✅ Rebuild count matches original count
- ✅ No "race condition" errors in logs

---

## Test 6: End-to-End Integration (Full 8000 Document Test)

### Purpose
Replicate the original failing scenario to confirm all fixes work together.

### Steps

1. **Delete old test index**:
   ```bash
   curl -X DELETE http://localhost:3000/api/indices/bulk-test-8000
   ```

2. **Run the full 8000-document test**:
   ```bash
   npm run ts-node scripts/testing/measure-bulk-indexing.ts -- --count 8000 --indexName bulk-test-8000
   ```

3. **Wait for completion** (monitor terminal logs)

4. **Verify metrics**:
   
   **Document Count**:
   ```bash
   curl -X GET http://localhost:3000/api/indices/bulk-test-8000 | jq '.documentCount'
   ```
   **Expected**: 8000 (was 73)

   **Search Accuracy**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-8000/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match_all": {}}, "size": 10}' \
     | jq '.data.total'
   ```
   **Expected**: 8000 (was 59)

   **Term Persistence**:
   ```bash
   # Check logs for persistence failures
   grep "No posting list found" terminal.txt | wc -l
   ```
   **Expected**: < 400 failures (< 5% of ~8000 terms)

5. **Test various search queries**:
   ```bash
   curl -X POST http://localhost:3000/api/indices/bulk-test-8000/_search \
     -H "Content-Type: application/json" \
     -d '{"query": {"match": {"title": "system"}}, "size": 5}'
   ```

### Success Criteria

- ✅ Document count: 8000/8000 (was 73/8000)
- ✅ Search returns all 8000 docs for match_all (was 59)
- ✅ Term persistence success rate > 95% (was 10-15%)
- ✅ Search queries work without crashes
- ✅ BulkOperationTracker reports completion successfully

---

## Expected Performance Metrics

### Before Fixes

| Metric | Value |
|--------|-------|
| Document Count Accuracy | 73/8000 (0.9%) |
| Term Persistence Success | 10-15% |
| Search Result Accuracy | 59/8000 (0.7%) |
| State Persistence | ❌ Lost on restart |
| Query Parser Stability | ❌ Crashes on standard format |

### After Fixes (Target)

| Metric | Target |
|--------|--------|
| Document Count Accuracy | 100% (8000/8000) |
| Term Persistence Success | >95% |
| Search Result Accuracy | 100% (8000/8000) |
| State Persistence | ✅ Survives restarts |
| Query Parser Stability | ✅ No crashes |

---

## Troubleshooting

### If term persistence failures remain high:

1. Check RocksDB logs for write errors
2. Verify RocksDB directory permissions
3. Check disk space
4. Increase RocksDB write buffer size

### If document counts are still inaccurate:

1. Check for `incrementDocumentCount` calls in logs
2. Verify MongoDB atomic operations are working
3. Run rebuild count and compare

### If BulkOperationTracker state is lost:

1. Verify Redis connection in logs
2. Check Redis persistence settings (AOF/RDB)
3. Verify Redis TTL is correct (7 days)

### If search still returns 0 results:

1. Check if terms persisted to MongoDB
2. Query MongoDB directly for term_postings collection
3. Verify RocksDB → MongoDB persistence jobs ran
4. Check persistence queue is processing jobs

---

## Post-Test Actions

After successful testing:

1. **Document Results**: Update this file with actual metrics
2. **Performance Baseline**: Record indexing speed and memory usage
3. **Production Readiness**: Review deployment checklist
4. **Monitoring Setup**: Configure alerts for persistence failures
5. **Backup Strategy**: Verify RocksDB and MongoDB backups

---

## Test Results Log

| Test | Status | Notes | Date |
|------|--------|-------|------|
| Clean Slate Bulk Indexing | ⏳ Pending | | |
| Server Restart | ⏳ Pending | | |
| Search Query Compatibility | ✅ **PASSED** | Query parser handles all formats | 2026-02-05 |
| RocksDB Durability | ⏳ Pending | | |
| Concurrent Processing | ⏳ Pending | | |
| End-to-End 8000 Docs | ⏳ Pending | | |

---

## Next Steps

1. Run all tests sequentially
2. Document actual results vs expected
3. If any test fails, debug and fix
4. Repeat until all tests pass
5. Deploy to production with monitoring

---

## Conclusion

The architectural fixes are **ready for comprehensive testing**. All TypeScript errors resolved, server starts successfully, and initial smoke tests show the query parser fix working. The next step is to run the full test suite to validate 100% term persistence and accurate document counts.

**Critical Success Metric**: 8000 documents indexed with >95% term persistence and 100% search accuracy.
