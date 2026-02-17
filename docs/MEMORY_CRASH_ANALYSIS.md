# Memory Crash Analysis (JavaScript heap out of memory)

## What happened

The Node process hit the **V8 heap limit** and crashed with:

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

- **Heap before crash**: ~1704 MB (logs: `Heap: 1704.4MB`)
- **Configured limit**: 2048 MB (`--max-old-space-size=2048` in `scripts/development/start-debug.sh`)
- **GC**: Multiple "Scavenge" runs could not free enough; "mark-compacts near heap limit" failed → OOM

So the app was using almost the entire 2 GB heap, and one more allocation pushed it over the limit.

---

## Root causes

### 1. **Unbounded `termList` in `InMemoryTermDictionary`**

- **Location**: `src/index/term-dictionary.ts` – `addTermForIndex()` does `this.termList.add(indexAwareTerm)` with **no cap**.
- **On load** the term list is limited to `maxCacheSize * 2` (2000 terms), but **at runtime** every new term from every batch is added to the in-memory `Set`.
- With many batches (e.g. 100+ batches × thousands of terms per batch), the `termList` `Set` can grow to hundreds of thousands of strings and dominate heap.

### 2. **Accumulated `dirtyTerms` during concurrent bulks**

- Each batch adds thousands of dirty terms (logs show e.g. 5480, 8964, 9943 per batch) to the **global** `dirtyTerms.get(indexName)` set.
- `dirtyTerms` is only cleared when **one bulk** finishes (`cleanupDirtyTermsAfterBulkIndexing` in `BulkCompletionService`).
- With **multiple overlapping bulks** (e.g. several `bulk:listings:*` in the logs), the same index’s `dirtyTerms` set holds terms from many batches at once, so total size can be very large (e.g. tens or hundreds of thousands of entries) before any cleanup.

### 3. **Large per-batch payloads in memory**

- Each batch builds a big structure: `batchDirtyTerms` (Set of thousands of terms) and `batchTermPostings` (map of term → postings).
- This is then serialized (`JSON.stringify(payload)`) and stored in MongoDB/Redis; until that completes and references are released, **two copies** (object graph + string) exist in heap.
- Batches of 100 docs can produce 5k–10k terms and many postings; with multiple batches in flight, total live data is high.

### 4. **2 GB heap limit too low for this workload**

- Script sets `NODE_OPTIONS="--max-old-space-size=2048"`.
- With long-running bulk indexing, many batches, overlapping bulks, and the structures above, 2 GB is tight; once heap is near the limit, V8’s mark-compact can fail and trigger OOM.

### 5. **Contributing factors from the logs**

- **Job stalled**: `Job 780 (batch) FAILED ... job stalled more than allowable limit` – one batch took too long; stalled jobs can hold references and delay GC of large objects.
- **Missing persistence job**: `1 batches missing persistence jobs` – indicates Redis/Bull or enqueue pressure; doesn’t directly cause OOM but suggests the system was under load.
- **Batch durations**: Some batches took ~15–25 minutes (e.g. 1563699 ms, 1830795 ms). Long-lived batch objects and associated term/postings data stay in heap longer.

---

## Recommended fixes

### Immediate (reduce chance of OOM)

1. **Raise Node heap limit** (e.g. 4 GB for dev, tune for production):
   - In `scripts/development/start-debug.sh`: e.g. `--max-old-space-size=4096`.
2. **Cap in-memory `termList` size** in `InMemoryTermDictionary`:
   - When adding a term, if `termList.size >= maxCacheSize * K` (e.g. K = 2 or 3), stop adding or evict oldest/least recently used terms (e.g. keep a bounded structure or periodically trim to a max size).
   - Ensures `termList` cannot grow without bound and matches the intent of the existing load-time cap.

### Short-term (structural)

3. **Clear or trim `dirtyTerms` more aggressively**:
   - Option A: After **each batch’s** persistence job is **enqueued** (or after persistence worker has processed that batch), remove that batch’s terms from `dirtyTerms` instead of clearing the whole index only when a bulk completes.
   - Option B: If keeping “clear when bulk completes”, ensure only one bulk per index runs at a time (or limit concurrency) so `dirtyTerms` doesn’t accumulate across many bulks.
4. **Reduce peak memory per batch**:
   - Build and serialize the persistence payload in smaller chunks (e.g. by term slices) and avoid holding the full `termPostings` map and full `payloadJson` string at once.
   - Explicitly null out local references to `payload`, `payloadJson`, and large maps after storing to MongoDB/Redis so GC can reclaim them sooner.
5. **Lower concurrency** for batch indexing when memory is tight (e.g. fewer concurrent batch jobs per index or per process) so fewer large batch structures are live at once.

### Monitoring

6. **Log or expose** `termList.size` and `getDirtyTermCount(indexName)` periodically (e.g. with existing memory stats) to detect unbounded growth before OOM.
7. **Alert** when heap usage exceeds e.g. 80% of `max-old-space-size` so you can scale down or restart before crash.

---

## Summary

| Cause                         | Effect                          | Fix (summary)                          |
|------------------------------|----------------------------------|----------------------------------------|
| Unbounded `termList`         | Heap growth over long runs      | Cap size / evict in term dictionary   |
| Large `dirtyTerms` per index | High memory during many batches | Clear per batch or limit concurrency   |
| Big per-batch payloads       | Temporary heap spikes           | Chunking, null refs after persist      |
| 2 GB heap limit              | OOM when usage approaches limit | Increase `--max-old-space-size`       |
| Stalled / long-running jobs  | Long-lived references           | Tune stall interval; reduce concurrency |

Applying the immediate fixes (higher heap, capped `termList`) plus one or two of the short-term changes should prevent this crash under similar workloads.
