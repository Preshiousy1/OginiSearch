# Phased plan: feedback items (investigation & implementation)

This document outlines a phased plan for investigating and addressing four feedback items. Each phase is self-contained: research first, then a simple implementation plan. No code changes until each phase is approved.

---

## Phase 1: Bulk indexing too slow (~10 min for 10k documents)

### 1.1 Investigation summary

**Current flow**

- **Document service** (`document.service.ts`): For bulk requests with &gt;5 docs, delegates to `BulkIndexingService.queueBulkIndexing()`. Options:
  - Batches &lt;= 20 docs: “real-time” → `batchSize: min(docs.length, 10)`, `priority: 8`.
  - Batches &gt; 20: “background” → `batchSize: 100`, `priority: 5`.
- **BulkIndexingService** (`bulk-indexing.service.ts`): Splits documents into batches (default `batchSize: 100` from options; document service passes 10 or 100). Each batch is one Bull job on the **`indexing`** queue. No concurrency setting here; concurrency is on the consumer.
- **Queue config** (`config/queue.config.ts`):
  - **indexing** queue: `concurrency: INDEXING_CONCURRENCY || 5`, `maxConcurrency: 10`.
  - So at most 5 jobs run at once by default (10k docs → 100 batches → 20 rounds of 5).
- **IndexingQueueProcessor** (`indexing-queue.processor.ts`): Processes `batch` jobs by calling `documentService.bulkIndexDocuments()` (or similar) for each batch. Each batch does full document processing (analysis, term extraction, storage, MongoDB term postings, etc.).
- **Document processing**: Can involve worker pool (`DocumentProcessorPool`) and external workers; potential bottleneck.

**Findings**

1. **Concurrency**: Default 5 concurrent indexing jobs. Increasing `INDEXING_CONCURRENCY` (e.g. 10–15) would process more batches in parallel, if CPU/memory allow.
2. **Batch size**: Document service uses 10 (real-time) or 100 (background). Larger batches = fewer jobs and less queue overhead, but more memory per job and risk of timeouts.
3. **No explicit limit in fetch**: Bulk indexing path is queue-based; the main lever is queue concurrency and batch size.
4. **Config vs code**: `BulkIndexingService` uses `DEFAULT_BATCH_SIZE = 500` and `DEFAULT_CONCURRENCY = 3` internally for *other* code paths (e.g. `bulkIndexFromDatabase`); document service does not use those for the HTTP bulk endpoint—it passes its own options.

### 1.2 Implementation plan (simple, low-risk)

1. **Environment / config**
   - Document in README or env example: `INDEXING_CONCURRENCY` (default 5) and, if applicable, queue `maxConcurrency`.
   - For local/dev, suggest trying `INDEXING_CONCURRENCY=10` or `12` for bulk runs (tune to CPU/memory).
2. **Bulk endpoint batch size**
   - Review the “real-time” threshold (20 docs) and batch size (10). For large bulk requests (e.g. 1000+ docs), consider:
     - Always using “background” mode (e.g. threshold at 50 or 100), and/or
     - Using a larger batch size (e.g. 100 or 150) so fewer jobs are enqueued and processed.
   - Keep a cap (e.g. 200–500) to avoid OOM or timeouts.
3. **Measure**
   - Re-run bulk measurement script with current defaults, then with `INDEXING_CONCURRENCY=10` and (if changed) larger batch size; record throughput (docs/s) and latency.
4. **Optional later**
   - Consider batching at the Bull level (e.g. multiple batches per job) only if profiling shows job overhead is significant; otherwise keep one batch per job for simplicity.

**Success criteria**: Same 10k dataset indexes in meaningfully less time (e.g. &lt;5 min) without instability or OOM.

### 1.3 Implementation status

- ✅ **Batch size optimization**: Updated `document.service.ts` with dynamic batch sizing:
  - Real-time threshold increased: 20 → 50 docs
  - Large bulk detection (>1000 docs) with batch size 150-200
  - Small (≤50): batch size 10, Medium (51-1000): batch size 100, Large (>1000): batch size 150-200
- ✅ **Documentation**: Created `docs/PERFORMANCE-TUNING.md` with comprehensive tuning guide
- ✅ **Environment variables**: Added `INDEXING_CONCURRENCY` and related vars to `.env.example`
- ⏳ **Manual testing**: Pending - run `npm run bulk:measure` with defaults and `INDEXING_CONCURRENCY=10`
- ⏳ **E2E tests**: Existing tests should pass (batch sizing is internal optimization)

---

## Phase 2: Search returns only 5 results when size=10 or size=100

### 2.1 Investigation summary

**Intended flow**

- **SearchQueryDto** (`api/dtos/search.dto.ts`): Has optional `size` and `from` (no class-level default).
- **Search controller**: Passes full `SearchQueryDto` (from body) to `searchService.search(index, searchDto)`.
- **SearchService.convertToSearchRequest()**: Builds `options` with `from: dto.from || 0`, `size: dto.size || 10`. So `size` should be passed through.
- **SearchExecutorService.executeQuery()**: Uses `options.size` (default 10) and `options.from` (default 0), then:
  - `paginatedMatches = sortedMatches.slice(from, from + size)`,
  - `fetchDocuments(indexName, paginatedMatches.map(m => m.id))`.
- **fetchDocuments()**: Calls `documentStorage.getDocuments(indexName, { filter: { documentId: { $in: docIds } } })` and does **not** pass `limit` or `offset`.
- **DocumentRepository.findAll()** (`document.repository.ts`): Uses `limit = options.limit ?? 100`, `offset = options.offset ?? 0`. So when `limit` is omitted, **limit defaults to 100**. That can cap the number of documents returned when `docIds.length` &gt; 100.

**Findings**

1. **Size/from flow**: DTO → convertToSearchRequest → executor is correct; no hardcoded 5 in the search result size path. The only “5” in search is `suggestQuery.size || 5` for the **suggest** endpoint, which is unrelated to main search.
2. **Possible causes for “only 5 results”**
   - **Actual matches**: Only 5 documents matched the query (e.g. rare term). User should check `data.total`; if total is 5, behavior is correct.
   - **fetchDocuments limit**: If more than 100 doc IDs are requested, `getDocuments` is called without `limit`, so the repository applies default `limit: 100`. So at most 100 hits can get their documents; for size=10 or 100 this is enough. So this does not explain “only 5” unless there’s another cap.
   - **Request body shape**: If the client sends `size` in a nested object or with a different key, it might not be bound to `SearchQueryDto.size`. Need to confirm the exact request shape (e.g. `{ query: {...}, size: 10 }`).
3. **Robustness**
   - **fetchDocuments**: Should pass `limit: docIds.length` (or a safe upper bound) when fetching by ID list so that the repository returns all requested documents and is not capped by default 100.

### 2.2 Implementation plan (simple)

1. **Verify request binding**
   - Add a short note in API docs: search request body must include `size` and `from` at the same level as `query` (e.g. `{ query: {...}, size: 10, from: 0 }`).
   - Optionally log `dto.size` and `dto.from` in `convertToSearchRequest` (or controller) in dev to confirm values.
2. **Fix fetchDocuments limit**
   - In `SearchExecutorService.fetchDocuments()`, pass `limit: docIds.length` (and `offset: 0`) in the options to `documentStorage.getDocuments()` so that when many doc IDs are requested, the repository does not cap at 100. Consider a reasonable max (e.g. 10_000) if you want to guard against huge ID lists.
3. **Clarify “5” with user**
   - If after the above the user still sees 5 results, ask them to confirm `data.total` in the response. If `total === 5`, the query truly has 5 matches; if `total > 5` but `hits.length === 5`, then there is another bug to trace (e.g. in mapping hits to documents).

**Success criteria**: For a query that matches at least N documents, requesting `size=N` (e.g. 10 or 100) returns N hits (and correct `data.total`), with no unintended cap at 5.

### 2.3 Implementation status

- ✅ **Fixed fetchDocuments limit**: Updated `SearchExecutorService.fetchDocuments()` to pass `limit: docIds.length` (with safety cap of 10,000) to ensure all requested documents are returned. Added logging to track document retrieval.
- ✅ **Added request binding logging**: Added debug logging in `SearchService.convertToSearchRequest()` to log `dto.size` and `dto.from` values in development mode for verification.
- ✅ **API documentation**: Updated `SearchController` API operation description to clarify that `size` and `from` must be included at the same level as `query` in the request body.
- ⏳ **Manual testing**: Pending - test search with `size=10` and `size=100` to verify correct number of results are returned
- ⏳ **E2E tests**: Update/verify E2E tests to ensure pagination works correctly

---

## Phase 3: Ranking rules (user-defined, and _all field precedence)

### 3.1 Investigation summary

**Current state**

- **Index mappings**: Support a `boost` (or similar) per field in mappings (e.g. `index.dto.ts`, index controller examples). This is schema-level field boost.
- **BM25Scorer** (`index/bm25-scorer.ts`): Supports `fieldWeights` in constructor and uses them in `score()`. Used by index stats / scoring layer where injected.
- **SearchExecutorService**: Does **not** inject or use `BM25Scorer`. It has its own **inline** `calculateScores()` that uses a fixed BM25-like formula (idf, tf, length norm) but **does not apply per-field weights**. The field name is derived from the term (e.g. `term.split(':')[0]`) but there is no lookup into index mappings or a “ranking rules” store.
- **Wildcard / _all**: For wildcard or _all-style queries, multiple terms/fields are combined (e.g. `mergeWildcardScores`); scoring is still the same inline formula with no field-specific boost.
- **No stored “ranking rules”**: There is no dedicated store (e.g. index settings or a separate collection) for “ranking rules” (e.g. “title &gt; description &gt; body”). Only static mapping boost exists, and it is not used in the search executor.

**Findings**

1. Index mappings have boost, but the search executor does not read or use them.
2. There is no mechanism for users to define or edit “ranking rules” per index (e.g. order of fields for _all, or custom weights).
3. To rank “title/name above description” for _all searches, the executor would need to apply field weights (from mappings or from a new ranking rules config) when computing scores.

### 3.2 Implementation plan (simple, phased)

1. **Use existing mapping boost in search**
   - In **SearchExecutorService**, obtain index mappings (or a minimal “field weights” view) for the index. When calculating scores (e.g. in `calculateScores` or wherever field is known), look up the field’s boost from mappings and multiply the score by it. Default boost 1.0 if missing.
   - Ensures that existing mapping configuration affects ranking without new APIs yet.
2. **Optional: ranking rules store**
   - If product requirements call for user-defined ranking (e.g. “title &gt; description &gt; body”):
     - Add an index-level setting or small document: “ranking rules” = ordered list of field names and/or (field, weight) pairs.
     - Default: derive from index mappings (e.g. use mapping boost order or boost values).
     - Search executor uses this (or mapping boost) to set per-field weights when scoring.
3. **_all / multi-field precedence**
   - For _all (or multi-field) queries, ensure the executor:
     - Resolves which field(s) each match came from (if available),
     - Applies the corresponding field weight/boost when aggregating scores.
   - If a single document matches in both title and description, title match should contribute a higher score (e.g. title boost 2.0, description 1.0). This is achieved by applying field weights in the existing score aggregation (e.g. in wildcard/merge logic and in term-level scoring).

**Success criteria**: (1) Changing a field’s boost in index mappings changes search result order. (2) For _all-style queries, matches in title/name rank above matches in description/body when so configured.

---

## Phase 4: Spellcheck (when no results, suggest corrections from dictionary)

### 4.1 Investigation summary

**Current state**

- **Suggest endpoint** (`search.service.suggest()`): Uses index terms (from term dictionary) and does:
  - Prefix and fuzzy (Levenshtein) matching,
  - Scoring by prefix/exact/substring, edit distance, term frequency, length.
- **Search flow**: No automatic “did you mean?” when `total === 0`. The client could call suggest separately, but there is no built-in spellcheck step.

**Findings**

1. There is **no** spellcheck system that runs automatically when a search returns 0 results.
2. Building blocks exist: term dictionary (in-memory and MongoDB term postings), and suggest logic (fuzzy, edit distance). These can be reused for “no results → find similar terms”.
3. Constraints: Must stay simple and avoid slowing down the hot path. Spellcheck should run only when results are zero (or optionally when below a threshold).

### 4.2 Implementation plan (simple)

1. **When to run**
   - Only when the main search returns **0** results (or optionally when `total < k` for a small k). Do not run on every search.
2. **Data source**
   - Use the same dictionary as suggest: for the index, get candidate terms (e.g. from MongoDB term_postings or in-memory term list for that index). Prefer terms that appear in the index so suggestions are meaningful.
3. **Matching**
   - Reuse suggest-style logic: for the user’s query term(s), find dictionary terms within a small edit distance (e.g. 1–2) and optionally prefix/substring. Cap candidates (e.g. top 5–10 by score) to keep latency low.
4. **API shape**
   - Option A: In the search response, when `total === 0`, add a field e.g. `suggestions` or `didYouMean: [{ term, score }]` with the top candidates. Client can display “Did you mean X?” and re-query if user clicks.
   - Option B: New optional query parameter e.g. `suggestWhenEmpty: true`; when true and total is 0, run spellcheck and return suggestions in the same response.
5. **Performance**
   - Spellcheck only after confirming 0 results; use a single batch of candidate terms (e.g. by prefix or first character) to avoid scanning the full dictionary; limit number of candidates and edit distance; consider caching frequent “no result” queries if needed later.

**Success criteria**: For a query that returns 0 results, the response can include a small set of suggested terms (from the index dictionary) that are close in spelling, without materially increasing latency for normal searches.

---

## Execution order

| Phase | Topic              | Order |
|-------|--------------------|-------|
| 1     | Bulk indexing speed| 1     |
| 2     | Search result size | 2     |
| 3     | Ranking rules      | 3     |
| 4     | Spellcheck         | 4     |

Address one phase at a time: complete investigation and implementation for that phase (and tests/docs as needed) before moving to the next. Store any phase-specific notes or sub-tasks in this file or in a linked doc per phase.
