# Search flow and payload

## Payload as received (example)

From your request, the **exact body** received by the API looks like:

```json
{
  "query": { "match": { "value": "car*" } },
  "size": 15,
  "from": 0,
  "filter": {
    "bool": {
      "must": [
        { "term": { "field": "is_active", "value": true } },
        { "term": { "field": "is_verified", "value": true } },
        { "term": { "field": "is_blocked", "value": false } },
        { "term": { "field": "category_id", "value": "Entertainment" } },
        { "term": { "field": "location_text", "value": "Lagos" } }
      ]
    }
  }
}
```

- **query**: Turned into a wildcard `car*` on field `_all` (no field in match → default `_all`).
- **filter**: Elasticsearch-style `bool.must` with five `term` clauses. The app now supports this shape and ANDs all of them.

The controller logs this once per request as:  
`Search payload (as received): <full JSON>`.

---

## Why search took ~30 seconds (flow)

Rough timeline from your logs:

| Time     | What happened |
|----------|----------------|
| 10:09:21 | Request starts; query plan runs; field boosts loaded. |
| 10:09:21 | Wildcard `car*` on `_all` → “field _all; scanning all terms” (no single-term shortcut). |
| 10:09:21 | **0 terms in memory** for index `listings`. |
| 10:09:21 | **Fallback to MongoDB for terms** → `findByIndex("listings")` runs. |
| 10:09:21 → 10:09:50 | **~29 s** spent loading **all** term-postings docs for the index (228,286 terms). |
| 10:09:50 | 228,286 terms in memory; filter in JS to pattern `car*` → **380** matching terms. |
| 10:09:50 | Fetch posting lists for those 380 terms (MongoDB lookups); merge scores → **206** doc IDs. |
| 10:09:50 | **Apply filter**: filter was `bool.must` (was not applied before; now it is). |
| 10:09:50 | Fetch 206 docs for filter, then paginate (size 15), fetch 15 for response. |
| 10:09:51 | Response: 206 total, 15 in page. **Total ~30 s.** |

So the **main cost** was:

1. **Loading 228k terms from MongoDB**  
   `getTermsByIndex(indexName)` with no prefix called `findByIndex(indexName)`, which does a `find({ indexName })` and returns **every** term-postings document for the index. That’s a very large read and transfer.

2. **Filter not applied (before fix)**  
   The filter had shape `filter.bool.must` (array of term clauses). Only `filter.term` (single term) was supported, so the 206 matches were returned without applying your filters.

---

## Flow summary (after fixes)

1. **Controller**  
   Logs full payload: `Search payload (as received): ...`.

2. **SearchService**  
   Builds `RawQuery` and `options` (from, size, sort, **filter**). Filter is passed through as `dto.filter`.

3. **QueryProcessor**  
   Converts `match.value` `car*` into a **wildcard** step: pattern `car*`, field `_all`.

4. **SearchExecutor**  
   - Preloads field boosts (once).  
   - Runs **wildcard** step:
     - Field is `_all` → no single-term shortcut.
     - Calls **`getTermsByIndex(indexName, basePattern)`** with **valuePrefix = "car"** so MongoDB returns only term **keys** whose value part starts with `"car"` (~380 terms) instead of all 228k terms.
     - Fetches posting lists for those ~380 terms; merges scores → list of doc IDs.
   - **applyFilters**: supports **`filter.bool.must`** (array of `{ term: { field, value } }`) and ANDs them; also supports single **`filter.term`**. Fetches docs for candidate IDs, applies clauses, returns filtered list.
   - Sorts, paginates (from/size), fetches document bodies for the page, returns result.

So now:

- **Payload** is visible in one log line.
- **Filter** is applied when you send `filter.bool.must` or `filter.term`.
- **Wildcard on _all** uses a **term value prefix** in MongoDB so only matching terms are loaded (~380 instead of 228k), which should cut the previous ~30 s down to a few seconds.

---

## Filter shapes supported

- **Single term**: `filter: { term: { field: "status", value: "active" } }`
- **Bool must (AND)**: `filter: { bool: { must: [ { term: { field: "is_active", value: true } }, ... ] } }`

Other shapes (e.g. `range`, `bool.should`) are not implemented yet; if sent, a debug log explains that only `filter.term` / `filter.bool.must` are applied.
