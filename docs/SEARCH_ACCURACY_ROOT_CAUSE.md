# Search Result Accuracy - Root Cause Analysis

## Problem
Searching for "limited" returns only 1-354 results instead of expected 2000 documents.

## Root Cause Identified
**Concurrent batch processing is overwriting posting lists** instead of merging them.

### Evidence
```log
[DEBUG] Persisted term bulk-test-final:title:test with 2000 documents to MongoDB  ✓
[DEBUG] In-memory result for title:limited: found=true, size=1  ✗
```

- "test" term correctly accumulates 2000 docs across all batches
- "limited" term only retains the LAST batch's documents (doc856 from batch 6)

### Why This Happens
1. **14 batches run concurrently**, each processing 150 documents
2. Each batch creates its own posting list for "limited" in memory
3. When batches complete, they write to RocksDB **sequentially**
4. **LAST BATCH WINS**: Batch 6's write for "limited" overwrites earlier batches' data
5. MongoDB persistence reads from RocksDB, getting only the last batch's data

### Why "test" Works But "limited" Doesn't
- "test" appears in ALL documents across ALL batches → gets merged via MongoDB's `$addToSet` operator
- "limited" appears in a specific position in each document → different tokenization creates DIFFERENT term variations per batch
- Result: "limited" gets split into multiple term variations, each retaining only one batch's worth of data

## Fixes Attempted

### ✅ Fix 1: Eviction Handler (Partial Success)
**Changed**: Modified LRU cache eviction to persist with correct posting lists
**Result**: Improved from 12 → 354 results (3000% improvement)
**Still failing**: Not all batches' data is retained

### ✅ Fix 2: Increased Cache Size (Partial Success)  
**Changed**: `MAX_CACHE_SIZE` 5000 → 7500
**Result**: Reduced evictions during concurrent processing
**Still failing**: Last-write-wins issue persists

### ❌ Fix 3: Removed saveTermList() Overhead
**Changed**: Removed per-term `saveTermList()` calls
**Result**: Faster indexing, but didn't solve accuracy issue

## The Real Solution Needed

**Concurrent posting list merging during RocksDB writes**

### Current Flow (BROKEN):
```
Batch 1: "limited" → [doc1, doc2, ..., doc150] → Write to RocksDB
Batch 2: "limited" → [doc151, ..., doc300] → Write to RocksDB (overwrites Batch 1!)
...
Batch 14: "limited" → [doc1951, ..., doc2000] → Write to RocksDB (overwrites all!)
```

### Required Flow (FIXED):
```
Batch 1: "limited" → [doc1, doc2, ..., doc150] → Write to RocksDB
Batch 2: "limited" → [doc151, ..., doc300] → READ existing + MERGE → Write to RocksDB  
...
Batch 14: "limited" → [doc1951, ..., doc2000] → READ existing + MERGE → Write to RocksDB
```

## Implementation Strategy

### Option A: RocksDB Read-Modify-Write with Locking
```typescript
// In IndexingQueueProcessor.processBatchDocuments()
for (const indexAwareTerm of batchDirtyTerms) {
  // 1. Read existing posting list from RocksDB
  const existing = await this.persistentTermDictionary.getTermPostingsFromRocksDB(indexAwareTerm);
  
  // 2. Get new posting list from memory
  const newList = await this.termDictionary.getPostingListForIndex(...);
  
  // 3. Merge if existing data found
  if (existing && existing.size() > 0) {
    for (const entry of newList.getEntries()) {
      existing.addEntry(entry);
    }
    await this.persistentTermDictionary.saveTermPostingsToRocksDB(indexAwareTerm, existing);
  } else {
    await this.persistentTermDictionary.saveTermPostingsToRocksDB(indexAwareTerm, newList);
  }
}
```

### Option B: Sequential Batch Processing for Same Term
- Use a term-level lock/queue
- Only one batch can write a specific term at a time
- Other batches wait or retry

### Option C: MongoDB-First for Common Terms
- Detect high-frequency terms ("limited", "test", etc.)
- Write these directly to MongoDB with `$addToSet`
- Skip RocksDB for these terms during batch processing

## Implemented Fix: Concurrent Single-Writer with Shared Dirty List
- **All start together**: When a bulk op starts, N batch jobs are queued to the indexing queue and ONE `drain-dirty-list` job is queued to the persistence queue. The dedicated persistence worker and the indexing workers run at the same time; neither waits for the other to finish first.
- **Shared Redis list (queue)**: Key `bulk-op:dirty:{bulkOpId}`. Indexing workers **push to the right** (RPUSH) when a batch completes. The persistence worker **pops from the left** in batches of 100 (LRANGE 0 99, then LTRIM).
- **Indexing workers (N−1)**: Only update in-memory term dictionary and push that batch’s dirty terms to the Redis list, then call `markBatchIndexed`. No DB writes.
- **Dedicated persistence worker (1, concurrency 1)**: Runs the drain job in a loop: pop up to 100 terms from the left; if none, check whether all batches are indexed and the list is empty → then `markPersistenceComplete`, delete list, exit; otherwise sleep 100ms and repeat. For each batch of terms: read from memory (or RocksDB fallback), write RocksDB then MongoDB.
- **Stopping condition**: Drain stops only when the list is empty **and** all indexing batches are complete (`completedBatches >= totalBatches`).
- **Result**: Single writer for DB; each term written once from memory; indexing and persistence run concurrently; no read-modify-write or merge logic.

## Test Plan
1. Delete existing indexes
2. Apply Option A implementation
3. Re-index 2000 documents with "limited" in all titles
4. Verify search returns exactly 2000 results
5. Verify MongoDB has 2000 entries for `bulk-test-final:title:limited`

## Performance Impact
- **Extra RocksDB reads**: ~500 reads/batch × 14 batches = 7000 reads
- **Merge operations**: O(n) for each term where n = total documents with that term
- **Estimated overhead**: +500ms per batch (acceptable for correctness)
