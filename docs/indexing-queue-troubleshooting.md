# Indexing queue troubleshooting

## Search total lower than document count

**Symptom:** Index shows e.g. 20,000 documents but a search returns only 15,200 (or any number below the stored count).

**Cause:** Search results come from **term postings** (in MongoDB): each term has a list of document IDs. The **document count** is the number of documents in document storage. If some **persistence jobs** were skipped or failed (e.g. "Unnamed persistence job with empty payload" or "payload key not found in Redis"), those batches’ terms were never written to the term dictionary, so those documents are in storage but do not appear in any term’s posting list and will not be found by search.

**What to do:**

1. **Prevent persistence loss:** Persistence payloads are stored in MongoDB, so Redis eviction of payload data no longer causes this. Ensure Redis has enough memory for **Bull job keys** (small); if those are evicted, you may see unnamed jobs. Then re-run the bulk index if needed.
2. **Verify:** After a full re-index, run a **match_all** query (or use the index’s document count). If match_all total equals document count, term postings are complete. If a **term** query returns fewer hits than document count, that’s expected for that term; if it’s much lower and you expect almost all docs to contain the term, persistence may have missed batches.
3. **Rebuild document count:** If index metadata is wrong, use the API to rebuild document count from document storage so the reported count matches storage.

## "Unnamed persistence job with unknown/empty payload"

When the **term-persistence** worker sees a job with no name (Bull’s `__default__`) and empty payload (`keys: []`), it used to skip and the batch was lost. Now we **recover** from MongoDB so the batch is still persisted.

**Cause:** Bull stores each job in Redis. Under memory pressure, Redis can **evict** that job key. The worker then gets a stub with default name and empty data (no `payloadKey` to look up).

**What we do:**
- Each enqueued persist job is recorded in MongoDB (**`persistence_pending_jobs`**) with `payloadKey`, `indexName`, `batchId`, `bulkOpId`. The full payload is in **`persistence_payloads`**.
- When the worker sees an **unnamed job with empty data**, it pops the oldest pending ref from MongoDB, loads the payload by `payloadKey`, processes it, and removes it from both collections. So **no batch is lost** even when Bull’s job key was evicted.
- You may see a log: `Recovered batch X from MongoDB pending (Bull job Y had empty data)`.

**Stale pending refs:** If you see "pending ref batch X had no payload" (or "skipping stale pending ref"), those refs were left in MongoDB from an older run (e.g. before we fixed the order of "remove pending" vs "delete payload"). The worker now **skips** such refs and tries the next oldest until it finds one with a payload, so recovery still succeeds when possible. To clean the collection without waiting for recovery: call **POST /bulk-indexing/persistence/drain-stale-pending** or run **npm run drain-stale-pending**. This processes every ref that has a payload and removes refs that have no payload.

**What you should do:** If recovery runs often, consider increasing Redis memory or using `noeviction` for the Bull DB so job keys are not evicted. The system will still persist all batches via recovery.

## "Payload key ... not found in Redis" (persistence) — largely resolved

Persistence payloads are now stored in **MongoDB** (collection `persistence_payloads`) as the primary store. The worker tries Redis first (optional cache), then **MongoDB** if the key is missing in Redis. So Redis eviction or expiry of `persist:payload:*` no longer causes lost batches.

If you still see "payload key not found in Redis **or** MongoDB", possible causes:

1. **Payload never written** – e.g. indexing processor failed before calling the payload store.
2. **MongoDB unavailable** at write or read time.
3. **TTL** – payloads expire after 7 days (TTL index on `createdAt`); if the job runs very late, the document may have been removed.

**What to do:** Check indexing and MongoDB logs; re-run the bulk index for the affected batches if needed.

## "Missing lock for job X finished"

This error comes from **Bull** (the Redis-backed queue). It occurs when Bull tries to move a job from "active" to "completed" or "failed", but the job’s lock in Redis is already missing or expired.

### Causes

1. **Job runs longer than the lock window** – The worker holds a lock while processing. If the job takes longer than `stalledInterval`, Bull may treat it as stalled and the lock can expire. When the worker later finishes and Bull tries to complete the job, the lock is gone and you see "Missing lock for job X finished".
2. **Worker or process dies** – The process exits after doing work but before Bull updates the job state; another process or retry then hits the missing lock.
3. **Redis issues** – Brief Redis unavailability or connection drops can prevent lock renewal.

### What we did

- **Increased `stalledInterval`** for the **indexing** queue from 30s to **120s (2 minutes)** in both `BulkIndexingModule` and `IndexingModule`. This gives large batch jobs time to finish before Bull considers them stalled, reducing "Missing lock" on normal runs.
- The **term-persistence** queue already uses a longer `stalledInterval` (60s) and lower concurrency.

### If you still see it

- Ensure batch sizes or per-job work stay within a couple of minutes, or increase `stalledInterval` further for the indexing queue.
- Check Redis stability and connectivity.
- Failed jobs with this reason can be **retried** via the bulk-indexing API (e.g. retry failed job or re-run the bulk op); with the new settings, retries are less likely to hit the same error.
