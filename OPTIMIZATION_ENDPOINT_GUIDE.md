# Search Performance Optimization Endpoint Guide

## 🎯 New Endpoint Created

**Endpoint**: `POST /debug/optimize-search-performance`

**Purpose**: Runs the search performance optimization script to add critical indexes that reduce search time from 400-500ms to < 200ms.

---

## 🚀 How to Use

### **Step 1: Call the Endpoint**

```bash
# Using curl
curl -X POST http://localhost:3000/debug/optimize-search-performance

# Or using your API client
POST /debug/optimize-search-performance
```

### **Step 2: Wait for Completion**

The endpoint will:
- Read the SQL script from `scripts/optimizations/01-add-search-performance-indexes.sql`
- Execute all statements (5-15 minutes depending on table size)
- Return detailed results

### **Step 3: Check Results**

The response includes:
- ✅ Status (success/partial_success/error)
- ✅ Execution statistics
- ✅ Created indexes and columns
- ✅ Table statistics
- ✅ Expected performance improvement

---

## 📊 Example Response

```json
{
  "status": "success",
  "message": "Search performance optimization executed successfully",
  "execution": {
    "total_statements": 25,
    "successful": 25,
    "errors": 0
  },
  "optimizations": [
    "name_lower column and index (for fast prefix matching)",
    "category_lower column and index (for fast category searches)",
    "Automatic triggers to keep lowercase columns updated",
    "Composite index for filtered searches",
    "Optimized GIN index settings",
    "Database configuration tuning",
    "Table statistics refresh (ANALYZE)"
  ],
  "createdIndexes": [
    {
      "name": "idx_documents_name_lower",
      "definition": "CREATE INDEX idx_documents_name_lower ON documents..."
    },
    {
      "name": "idx_documents_category_lower",
      "definition": "CREATE INDEX idx_documents_category_lower ON documents..."
    }
  ],
  "createdColumns": [
    {
      "name": "name_lower",
      "type": "text"
    },
    {
      "name": "category_lower",
      "type": "text"
    }
  ],
  "statistics": {
    "total_documents": "12232",
    "documents_with_name_lower": "12232",
    "documents_with_category_lower": "12232",
    "total_table_size": "45 MB",
    "indexes_created": 3,
    "columns_created": 2
  },
  "executionTime": "8.45s",
  "expectedImprovement": {
    "before": "400-500ms",
    "after": "120-200ms",
    "improvement": "60-75% faster"
  },
  "nextSteps": [
    "Test search performance with: GET /debug/test-search/:indexName/:term",
    "Verify indexes are being used: GET /debug/verify-search-indexes",
    "Monitor search query times in application logs",
    "Expected: Search queries should now complete in < 200ms"
  ],
  "timestamp": "2025-11-23T21:30:00.000Z"
}
```

---

## ✅ Verification Steps

### **1. Check Indexes Were Created**

```bash
GET /debug/verify-search-indexes
```

Look for:
- `idx_documents_name_lower`
- `idx_documents_category_lower`
- `idx_documents_active_verified_name`

### **2. Test Search Performance**

```bash
GET /debug/test-search/businesses/hotel
```

**Before optimization**: ~493ms  
**After optimization**: ~120-200ms ✅

### **3. Check Application Logs**

After optimization, search queries should show:
```
✅ Search completed in 120ms (was 493ms)
```

---

## ⚠️ Important Notes

1. **Zero Downtime**: Uses `CONCURRENTLY` for index creation (no table locking)
2. **Execution Time**: 5-15 minutes depending on table size
3. **Idempotent**: Safe to run multiple times (skips existing indexes)
4. **Errors**: Some errors may be acceptable (e.g., "already exists")

---

## 🔍 Troubleshooting

### If endpoint returns errors:

1. **Check script exists**:
   ```bash
   ls -la scripts/optimizations/01-add-search-performance-indexes.sql
   ```

2. **Check database connection**:
   ```bash
   GET /debug/health/businesses
   ```

3. **Check PostgreSQL logs** for detailed error messages

4. **Partial success is OK**: Some statements may fail if indexes already exist

### If search is still slow after optimization:

1. **Verify indexes exist**:
   ```bash
   GET /debug/verify-search-indexes
   ```

2. **Check if indexes are being used**:
   ```sql
   EXPLAIN ANALYZE 
   SELECT * FROM documents 
   WHERE name_lower LIKE 'hotel%' 
   LIMIT 10;
   ```
   Should show "Index Scan" not "Seq Scan"

3. **Run ANALYZE**:
   ```sql
   ANALYZE documents;
   ```

---

## 📈 Expected Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Search Time** | 493ms | 120ms | 76% faster ✅ |
| **Index Usage** | None | Full | ✅ |
| **Query Plan** | Seq Scan | Index Scan | ✅ |

---

## 🎉 Success Criteria

After running the endpoint, you should see:

1. ✅ **Status**: "success" or "partial_success"
2. ✅ **Indexes created**: At least 3 indexes (name_lower, category_lower, composite)
3. ✅ **Columns created**: name_lower and category_lower
4. ✅ **Search time**: < 200ms (test with `/debug/test-search/:indexName/:term`)

---

## 📝 Next Steps After Optimization

1. **Test search performance**:
   ```bash
   GET /debug/test-search/businesses/hotel
   ```

2. **Run integration test**:
   ```bash
   npx ts-node -r tsconfig-paths/register scripts/testing/test-tiered-ranking-integration.ts
   ```

3. **Monitor production**:
   - Watch application logs for search query times
   - Should see: "Search completed in XXXms" (target: < 200ms)

4. **Verify tiered ranking still works**:
   - Search results should still be correctly ordered by tier
   - Ranking metadata should still be present

---

**Ready to optimize?** Run `POST /debug/optimize-search-performance` now! 🚀

