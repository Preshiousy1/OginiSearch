# Solution #3 POC: Implementation Plan

**Branch:** `legacy-mongodb-architecture`  
**Scope:** Proof-of-concept for storing posting entries as **separate MongoDB documents** to eliminate the 16MB limit and data loss.  
**References:** [ARCHITECTURE_COMPARISON.md](./ARCHITECTURE_COMPARISON.md#critical-unknown-solution-3-performance), [MONGODB_ROCKSDB_ARCHITECTURE_ANALYSIS.md](./MONGODB_ROCKSDB_ARCHITECTURE_ANALYSIS.md)

---

## 1. POC Objective and Success Criteria

### Hypothesis
MongoDB can serve queries for a term with **500K posting entries** (stored as one document per posting) within **&lt;500ms** when using a compound index `{ indexName: 1, term: 1 }`.

### Success Criteria (from ARCHITECTURE_COMPARISON.md)

| Criterion | Target | Measure |
|-------------|--------|---------|
| **Query latency** | &lt;500ms (acceptable) | p95 of single-term search for a 500K-posting term |
| **Failure threshold** | &gt;2s = abandon | Same query; if p95 &gt;2s, do not proceed |
| **Result completeness** | 100% | All 500K document IDs returned for that term |
| **Storage overhead** | Document | 2–3x vs current (acceptable if perf works) |

### Out of Scope for POC
- Full refactor of write path (indexing can still use current RocksDB path; we only need a **read path** that uses the new collection for the benchmark).
- Migration of existing data.
- Production rollout decisions.

---

## 2. Code Audit

### 2.1 Audit Objective
Identify every place that assumes “one MongoDB document per term” (with nested `postings`) so the POC can add a parallel read path and tests without breaking current behavior.

### 2.2 Files to Audit (by role)

#### A. Schema and repository (MongoDB term postings)

| File | Purpose | Current assumption | POC impact |
|------|---------|--------------------|------------|
| `src/storage/mongodb/schemas/term-postings.schema.ts` | One doc per term, `postings: Record<string, PostingEntry>` | Single document per term; 16MB limit. | Add new schema **or** new collection for “posting entries” (one doc per `(term, documentId)`). |
| `src/storage/mongodb/repositories/term-postings.repository.ts` | CRUD for term postings | `findByIndexAwareTerm()` returns one doc; `create`/`update`/`bulkUpsert` write one doc per term. | Add **read-only** path: e.g. `findPostingEntriesByTerm(indexName, indexAwareTerm): Promise<PostingEntry[]>` that queries the new collection and returns 500K entries. |

#### B. Persistence and restoration

| File | Purpose | Current assumption | POC impact |
|------|---------|--------------------|------------|
| `src/storage/index-storage/persistent-term-dictionary.service.ts` | Restore from MongoDB → RocksDB; save RocksDB → MongoDB | Restore uses `findByIndex(indexName)` and loops over docs whose `postings` are objects. Migrate/save use `saveTermPostings(indexAwareTerm, postings)` writing one doc per term. | POC: **no change**. Restore/save stay on current schema. POC only adds a **separate read path** for the benchmark. |

#### C. Search execution (critical path)

| File | Purpose | Current assumption | POC impact |
|------|---------|--------------------|------------|
| `src/search/search-executor.service.ts` | Resolve term → posting list; execute steps | `getPostingListByIndexAwareTerm()` calls `termPostingsRepository.findByIndexAwareTerm()` and builds `PostingList` from `termPosting.postings`. | POC: add a **branch** (e.g. env/flag `USE_POSTING_ENTRIES_COLLECTION`) that calls the new repository method, aggregates 500K entries into a `PostingList`, and runs the same execution. Measure only this path for the 500K-term benchmark. |

#### D. Indexing and document service

| File | Purpose | Current assumption | POC impact |
|------|---------|--------------------|------------|
| `src/indexing/indexing.service.ts` | Index documents; periodically persist to MongoDB | Persist uses `persistentTermDictionary.saveTermPostings()`, which writes one doc per term. | POC: **no change** for writes. Optionally add a **one-off seed script** that writes 500K posting **entries** into the new collection for one term, for benchmarking. |

#### E. Index module and wiring

| File | Purpose | POC impact |
|------|---------|------------|
| `src/storage/mongodb/mongodb.module.ts` | Registers `TermPostingsRepository` and schemas. | Register new schema/model for posting entries and a small `TermPostingEntriesRepository` (or extend repo) used only when the POC flag is on. |

### 2.3 Audit Checklist

- [ ] **Schema:** Enumerate all usages of `TermPostings` and `term_postings` collection. Confirm no other code assumes one-doc-per-term except the files above.
- [ ] **Repository:** Confirm `findByIndexAwareTerm` is the **only** MongoDB read used to build posting lists in the search path. (Greps for `findByIndexAwareTerm`, `getPostingListByIndexAwareTerm` are done; re-verify before implementing.)
- [ ] **Search path:** Trace `executeTermStep` / `executeBooleanStep` → `getIndexAwareTermPostings` → `getPostingListByIndexAwareTerm` → `termPostingsRepository.findByIndexAwareTerm`. Ensure the POC branch injects “aggregate from new collection” only in this chain.
- [ ] **Restoration:** Confirm `restoreTermPostings` and `migrateTermPostings` never need to read from the new “posting entries” collection for the POC (they can stay on current schema).

### 2.4 Risk Summary

| Risk | Mitigation |
|------|------------|
| New collection grows to 500K+ docs per term and degrades other queries | POC runs in isolation (e.g. dedicated test DB or prefix). |
| Index `{ indexName: 1, term: 1 }` not used | Verify with `explain()` in a short manual test before the formal benchmark. |
| Aggregation in app (building `PostingList` from 500K docs) dominates latency | Measure “MongoDB query only” vs “query + aggregation” in spec tests. |

---

## 3. POC Implementation Steps

### Phase 1: Schema and read-only repository (no behavior change)

1. **New schema** `TermPostingEntry`:
   - Collection: `term_posting_entries`.
   - Fields: `indexName`, `term` (index-aware, e.g. `index:field:term`), `documentId`, `frequency`, `positions` (array), optional `metadata`.
   - Compound index: `{ indexName: 1, term: 1 }`.
2. **New repository** (or new methods on a new repo class):
   - `findPostingEntriesByTerm(indexName: string, indexAwareTerm: string): Promise<{ docId: string; frequency: number; positions?: number[] }[]>`.
   - Implementation: `find({ indexName, term: indexAwareTerm }).lean()` (or cursor/stream if you prefer to avoid loading 500K into memory at once; for POC, in-memory is acceptable if it fits).
3. **Wire** the new schema and repository in `MongoDBModule` (or a dedicated POC module). No change to existing `TermPostings` usage.

### Phase 2: Search path branch (feature-flagged)

4. **Search executor:**
   - Add flag (e.g. `USE_POSTING_ENTRIES_FOR_READS` from env or config).
   - When the flag is set and a term lookup would call `getPostingListByIndexAwareTerm`, instead call the new repository’s `findPostingEntriesByTerm`, then build a `SimplePostingList` from the returned entries (loop: `addEntry({ docId, frequency, positions })`).
   - Use this path only for the **read** side; leave all writes on the current term-postings schema.
5. **Seed data for benchmark:**
   - Script or test helper that, for one index and one index-aware term, inserts **500,000** documents into `term_posting_entries` with that term, distinct `documentId`s, and minimal `frequency`/`positions`. Optionally ensure those document IDs exist in the document store so that a later e2e “search then fetch docs” is valid.

### Phase 3: Measurements and thresholds

6. **Latency:** In e2e or a dedicated perf spec, run the single-term search for the 500K-term repeatedly (e.g. 20 runs), record p50/p95/p99, and assert p95 &lt; 500ms (success) and p95 &lt; 2000ms (abandon threshold).
7. **Correctness:** Assert that the number of document IDs in the posting list equals 500,000 and that the top N returned hits are consistent (e.g. order by score) when using the new path.
8. **Storage:** After seeding, measure collection sizes (e.g. `term_postings` vs `term_posting_entries` for that one term) and document count; record 2–3x overhead in the POC report.

---

## 4. E2E Test Plan

### 4.1 Purpose
Validate full search flow for a term that has **500K posting entries** in the new collection, and enforce latency and completeness criteria.

### 4.2 Environment
- Use the same test setup as existing e2e (e.g. `TestDatabaseModule`, in-memory or test MongoDB).
- Enable `USE_POSTING_ENTRIES_FOR_READS` (or equivalent) only in this describe block so default e2e stays on current behavior.

### 4.3 Scenarios

| ID | Scenario | Steps | Pass criteria |
|----|----------|--------|----------------|
| **E1** | Single-term search with 500K postings (latency) | 1) Ensure index exists. 2) Seed `term_posting_entries` with 500K entries for one index-aware term. 3) Call search API for that term (e.g. match on the same field). 4) Repeat 20 times, collect response times. | p95 latency &lt; 500ms. |
| **E2** | Single-term search with 500K postings (abandon threshold) | Same as E1. | p95 latency &lt; 2000ms (if this fails, POC fails “do not proceed”). |
| **E3** | Result completeness | After E1, parse response and (if possible) count distinct document IDs in hits or in the posting list used. | Count = 500,000 (or “all seeds returned” if API only returns a slice). |
| **E4** | Regression: default path unchanged | Run existing `search.controller.e2e-spec` (and any other search e2e) **without** the POC flag. | All existing tests pass. |

### 4.4 Suggested structure
- New file: `test/integration/api/search.solution3-poc.e2e-spec.ts` (or `search.controller.solution3-poc.e2e-spec.ts`).
- `beforeAll`: start app with POC flag, create index, run seed for 500K entries for one term.
- `describe('Solution #3 POC – 500K postings')`: E1, E2, E3.
- Separate `describe` or suite for E4, or run the existing search e2e suite in the same matrix with the flag off.

### 4.5 Data and fixtures
- Reuse existing test index name/configuration where possible.
- Seed script/helper: e.g. `seedTermPostingEntries(indexName, indexAwareTerm, count = 500_000)` inserting into `term_posting_entries` only.

---

## 5. Spec (Unit/Integration) Test Plan

### 5.1 Purpose
- Verify that the new repository returns the correct list of postings for a term.
- Verify that the search executor builds a correct `PostingList` from those entries.
- Optionally simulate 500K documents in the DB to catch N+1 or missing indexes in unit-level tests.

### 5.2 New or Extended Specs

| Test file | What to test | Type |
|-----------|--------------|------|
| `term-posting-entries.repository.spec.ts` (new) | `findPostingEntriesByTerm` returns correct entries for a small fixture (e.g. 100 docs). With an in-memory or test MongoDB, insert 10K entries and assert count and content. | Unit / integration |
| `term-posting-entries.repository.spec.ts` | If test DB allows, insert 500K entries and measure time for `findPostingEntriesByTerm`; assert &lt; 500ms (or a configurable threshold). | Performance spec |
| `search-executor.service.spec.ts` | When `getPostingListByIndexAwareTerm` is implemented via the new “posting entries” path (mocked repo returning 500K entries), the executor produces a `PostingList` of size 500K and does not throw. Optional: assert that a downstream step (e.g. AND with another term) receives a non-null posting list. | Unit |
| `persistent-term-dictionary.service.spec.ts` | No change required for POC; existing behavior (current schema) remains. Optional: add a short note that “Solution #3 read path is not used by this service.” | Regression |

### 5.3 Mocks and test data
- **Repository:** For `SearchExecutorService` tests, mock `TermPostingEntriesRepository.findPostingEntriesByTerm` to return an array of 500K items (e.g. `Array.from({ length: 500000 }, (_, i) => ({ docId: `doc-${i}`, frequency: 1, positions: [0] }))`). Avoid hitting a real DB in this test; goal is to stress aggregation and any in-memory logic.
- **Performance spec:** Use a real test MongoDB and the real repository; seed 500K and run `findPostingEntriesByTerm` multiple times, then assert p95.

### 5.4 Coverage goals
- New repository logic: branch coverage on `findPostingEntriesByTerm`.
- Search executor branch: the “posting entries” path is exercised by at least one test with a large mocked list (e.g. 500K entries) and one e2e (E1–E3).

---

## 6. Decision Workflow and Next Steps

### 6.1 After POC

| Outcome | Next step |
|---------|-----------|
| p95 &lt; 500ms, results complete, storage overhead documented | Proceed with full Solution #3 refactor (write path, migration, restore from new collection). |
| 500ms ≤ p95 &lt; 2s | Document numbers; decide whether to optimize (e.g. cursor, projection, batching) or to adopt “fix PostgreSQL” / hybrid. |
| p95 ≥ 2s or incomplete results | Abandon MongoDB for posting lists for this use case; prioritize fixing PostgreSQL or hybrid (e.g. PostgreSQL for posting lists, MongoDB for documents). |

### 6.2 Artifacts to produce
- **POC report:** p50/p95/p99 latencies, result counts, collection sizes, and a go/no-go recommendation.
- **Code:** New schema, repository, search-path branch, seed helper, e2e and spec tests as above. All behind a feature flag so `legacy-mongodb-architecture` remains safe to run without the POC.

### 6.3 Estimated effort (POC only)
- Code audit: 0.5 day.
- Schema + repository + search branch + seed: 1–2 days.
- E2E (E1–E4) + spec tests: 1 day.
- Benchmark runs, storage measures, and short report: 0.5 day.  
**Total:** ~3–4 days for the POC, before any decision to do the full 1–2 week refactor.

---

**Document status:** Implementation plan for Solution #3 POC.  
**Last updated:** January 2025.
