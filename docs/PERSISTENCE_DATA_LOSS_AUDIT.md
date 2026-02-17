# Bulk indexing persistence – root cause audit

This document summarizes the root causes of data loss and inconsistencies during bulk indexing (e.g. 44,100 / 50,000 documents, “13 batches missing persistence jobs”, “payload key not found”, Redis WRONGTYPE) and the fixes applied.

---

## 1. Root cause: order of operations (batches missing persistence jobs)

### What was happening

- **Symptom:** “13 batches missing persistence jobs for bulk:… Expected 250, got 237 persistence jobs.”
- **Symptom:** Search returning 44,100 instead of 50,000 for an index where 50k were indexed.

In `IndexingQueueProcessor.processBatchDocuments()` the order was:

1. `pushDirtyTerms(bulkOpId, …)`
2. **`markBatchIndexed(bulkOpId, batchId)`** ← runs verification when `completedBatches === totalBatches`
3. `enqueuePersistBatchTerms(…)` ← enqueues the persistence job and calls `markPersistenceJobEnqueued`

So when the **last** batch (e.g. batch 250) finished indexing, we called `markBatchIndexed` first. That triggered “all batches indexed” and **immediately** ran `verifyPersistenceJobsEnqueued()`. At that moment the **current** batch (and any other batch that had just completed in parallel) had **not** yet run `enqueuePersistBatchTerms`, so they were not in `persistenceJobsEnqueued`. Verification therefore always under-counted (e.g. 237 instead of 250). Those “missing” batches did enqueue their persistence jobs shortly after, but:

- The CRITICAL log made it look like 13 batches would never be persisted.
- Any logic that depended on “all enqueued” at the moment the last batch completed could be wrong.
- In practice, with concurrency, the exact set of “last” batches varied; the gap (e.g. 13) is the number of batches that had not yet called `markPersistenceJobEnqueued` when the 250th `markBatchIndexed` ran.

### Fix

- **Enqueue persistence before marking the batch as indexed.**
- New order in `indexing-queue.processor.ts`:
  1. `pushDirtyTerms(bulkOpId, …)`
  2. `buildSerializedTermPostings(batchTermPostings)`
  3. **`enqueuePersistBatchTerms(…)`** (includes `markPersistenceJobEnqueued` inside it)
  4. **`markBatchIndexed(bulkOpId, batchId)`**

When the last batch completes, all 250 persistence jobs are already enqueued and recorded, so verification reports “all enqueued” correctly and no batches are reported as missing.

---

## 2. Root cause: Redis WRONGTYPE when loading bulk operations

### What was happening

- **Symptom:** “Failed to load operations from Redis: WRONGTYPE Operation against a key holding the wrong kind of value”.

`BulkOperationTrackerService` stores:

- **Operation state** in Redis **strings**: `bulk-op:bulk:indexName:timestamp:randomId` (via `SETEX`).
- **Dirty term lists** in Redis **lists**: `bulk-op:dirty:bulkOpId` (via `RPUSH`).

In `restoreOperationsFromRedis()` and `getOperationsByIndexName()` we did:

```ts
const keys = await this.redisClient.keys(`${this.REDIS_KEY_PREFIX}*`);
for (const key of keys) {
  const data = await this.redisClient.get(key);  // WRONGTYPE if key is a list
  ...
}
```

`keys('bulk-op:*')` returns **both** operation keys (strings) and dirty list keys (lists). Calling `GET` on a list key causes Redis to return **WRONGTYPE**. So any request that merged in Redis state (e.g. verify-index, recovery, or startup restore) could throw and fall back to in-memory only or fail.

### Fix

- Only run `GET` on keys that are operation keys, not dirty list keys.
- In both `restoreOperationsFromRedis()` and `getOperationsByIndexName()` we filter keys before calling `get`:

```ts
const keys = await this.redisClient.keys(`${this.REDIS_KEY_PREFIX}*`);
const operationKeys = keys.filter((k: string) => !k.startsWith(this.DIRTY_LIST_PREFIX));
for (const key of operationKeys) {
  const data = await this.redisClient.get(key);
  ...
}
```

`DIRTY_LIST_PREFIX` is `'bulk-op:dirty:'`, so we no longer call `GET` on list keys and WRONGTYPE is eliminated.

---

## 3. “Payload key not found in Redis or MongoDB”

### What was happening

- **Symptom:** “payload key persist:payload:bulk:… not found in Redis or MongoDB; batch … will not be persisted.”

This can happen in three situations:

1. **Duplicate persistence job**  
   The same batch is processed twice (e.g. retry, recovery, or duplicate enqueue). The first run loads the payload, persists, then **deletes** the payload. The second run then sees “payload not found”. The code already treats this as idempotent when the bulk operation is already fully persisted (skips and returns success). So no data loss, only a no-op for the duplicate.

2. **Batches that never enqueued a persistence job**  
   Before the order-of-operations fix, verification reported “13 batches missing”; those batches *did* enqueue later, so in theory they should have been persisted. The main risk was batches that **failed** before `enqueuePersistBatchTerms` (e.g. exception after `markBatchIndexed` in the old order, or MongoDB/Redis failure during payload store). Those batches would never create a persistence job, so no payload would exist for them and they would never be persisted. Fixing the order of operations does not fix batches that fail during enqueue; it only ensures that when the last batch completes, we don’t falsely report “missing” for batches that are still in flight.

3. **Payload eviction / expiry / deletion**  
   If the payload was never stored (e.g. MongoDB write failed and we threw), or was evicted from Redis and then deleted from MongoDB by another process, or expired, the job would see “payload not found”. Mitigations: MongoDB is the source of truth with a long TTL; Redis is an optional cache; and we only delete from MongoDB after successful processing.

### No code change for (1)

- Duplicate jobs are handled by the existing idempotency check and graceful skip when the bulk op is already fully persisted.

### After the order fix

- All batches that complete indexing without throwing will enqueue their persistence job **before** being marked indexed, so verification will no longer report “X batches missing” due to the race. Remaining “payload not found” cases should be either duplicates (safe to ignore) or genuine failures (e.g. payload store failed), which should be rare and visible in logs.

---

## 4. Why 44,100 vs 50,000?

Possible contributors:

1. **Batches that never got a persistence job**  
   Before the fix, the “13 batches missing” were the ones that hadn’t yet been marked enqueued when the last batch completed. They did enqueue shortly after, so they might still have been persisted. However, if any of those (or others) **failed** during `enqueuePersistBatchTerms` (e.g. MongoDB/Redis error), they would never get a persistence job and would never be persisted. That could explain part of the gap.

2. **Duplicate persistence jobs**  
   Duplicate jobs see “payload not found” and skip (idempotent). They don’t reduce the document count; they just don’t double-write.

3. **Indexing-side failures**  
   If some documents or batches failed during **indexing** (e.g. only 45,800 of 50k “successfully indexed”), those documents were never indexed and will never appear in search regardless of persistence. So part of the gap can be indexing failures, not persistence.

4. **Persistence worker failures**  
   If a persistence job ran but failed after loading the payload (e.g. MongoDB write error), that batch’s terms might not be fully persisted. Retries would then see “payload not found” (payload already removed) and skip, so that batch could be under-represented in search.

So the 44,100 vs 50,000 gap is likely a combination of: (a) some batches never enqueuing a persistence job (e.g. due to the race or enqueue failures), (b) some indexing failures, and (c) possible persistence job failures. The two code fixes above address the race and Redis WRONGTYPE so that:

- Verification and recovery no longer fail or misreport due to WRONGTYPE.
- Every batch that completes indexing without error will have its persistence job enqueued (and marked) **before** it is counted as indexed, so we no longer under-count “batches with persistence jobs” and we avoid the race that made it look like 13 batches were missing.

---

## 5. Summary of code changes

| File | Change |
|------|--------|
| `src/indexing/queue/indexing-queue.processor.ts` | Call `enqueuePersistBatchTerms` **before** `markBatchIndexed` so verification runs after all persistence jobs are enqueued. |
| `src/indexing/services/bulk-operation-tracker.service.ts` | In `restoreOperationsFromRedis()` and `getOperationsByIndexName()`, filter out keys that start with `DIRTY_LIST_PREFIX` before calling `redis.get()` to avoid WRONGTYPE on list keys. |

---

## 6. Recommendations

1. **Re-run bulk indexing** for the affected index (e.g. 50k) after deploying these fixes; expect verification to show “All 250 batches have persistence jobs enqueued” and search count to align with document count (assuming no indexing or persistence failures).
2. **Monitor logs** for “Failed to store persistence payload in MongoDB” or “Failed to add persistence job to Bull queue”; those indicate batches that will not be persisted and need investigation.
3. **Keep Redis memory and TTL** sufficient so that optional Redis payload cache is useful without evicting other keys; MongoDB remains the source of truth for payloads.
4. **Use verify-index and recover** after bulk runs to confirm batch counts and to recover any batches that had a payload stored but no job enqueued (recovery path).
