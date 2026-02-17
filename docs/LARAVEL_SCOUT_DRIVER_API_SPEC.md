# Laravel Scout Driver – API contract (ConnectSearch engine)

This document describes how the ConnectSearch API aligns with the `laravel-scout-driver` package (`OginiClient`, `AsyncOginiClient`, `OginiEngine`, `OginiPaginator`). The engine implements these endpoints, payloads, and response shapes so the driver works without changes.

---

## 1. Endpoints

| Driver method | HTTP | Engine path | Notes |
|---------------|------|-------------|--------|
| `createIndex` | POST | `/api/indices` | Body: `{ name, ...configuration }` |
| `getIndex` | GET | `/api/indices/:indexName` | |
| `deleteIndex` | DELETE | `/api/indices/:indexName` | |
| `listIndices` | GET | `/api/indices` | Query: `status?` |
| `updateIndexSettings` | PUT | `/api/indices/:indexName/settings` | Body: `{ settings?, mappings? }` |
| `indexDocument` | POST | `/api/indices/:indexName/documents` | Body: `{ id, document }` |
| `getDocument` | GET | `/api/indices/:indexName/documents/:documentId` | |
| `updateDocument` | PUT | `/api/indices/:indexName/documents/:documentId` | Body: `{ document }` |
| `deleteDocument` | DELETE | `/api/indices/:indexName/documents/:documentId` | |
| `bulkIndexDocuments` | POST | `/api/indices/:indexName/documents/_bulk` | Body: `{ documents }` |
| `bulkIndexDocuments` (async alias) | POST | `/api/indices/:indexName/documents/bulk` | Same body and behaviour as `_bulk` |
| `deleteByQuery` | DELETE | `/api/indices/:indexName/documents/_query` | Body: `{ query }` (JSON) |
| delete by query (alias) | POST | `/api/indices/:indexName/documents/_delete_by_query` | Same body and behaviour |
| `listDocuments` | GET | `/api/indices/:indexName/documents` | Query: `limit`, `offset`, `filter?` |
| `search` | POST | `/api/indices/:indexName/_search` | Body: see Search payload |
| `search` (async alias) | POST | `/api/indices/:indexName/search` | Same body and behaviour as `_search` |
| `suggest` | POST | `/api/indices/:indexName/_search/_suggest` | Body: `{ text, field?, size? }` |
| `healthCheck` | GET | `/health` | Response: `{ status, version?, server_info? }` |

---

## 2. List indices response

**Driver expects:** `response['data']` = array of index objects; optional `response['total']`.

**Engine returns:**

```json
{
  "data": [
    {
      "name": "my-index",
      "status": "open",
      "documentCount": 100,
      "createdAt": "2023-06-15T10:00:00.000Z",
      "settings": {},
      "mappings": {}
    }
  ],
  "total": 1
}
```

---

## 3. Search payload (from driver)

- **Full query:** `{ query: { match | match_all | ... }, size?, from?, filter?, sort?, fields?, facets?, highlight? }`
- **Simple:** `query.match` with `field` + `value`, or `value` only; `query.match_all: {}` for match-all.
- **Pagination:** `size` (defaulted/capped in driver), `from` (offset).

Engine accepts the same body; `size` and `from` drive pagination and `data.pagination` in the response.

---

## 4. Search response (for OginiEngine / OginiPaginator)

**Driver uses:**

- `results['data']['total']` – total hit count
- `results['data']['hits']` – array of hits
- `results['data']['maxScore']` – max score
- `results['data']['pagination']` – optional; used by `extractOginiPagination()`
- `results['took']` – search time (ms)
- `results['data']['typoTolerance']` or `results['typoTolerance']` – optional

**Engine returns:**

```json
{
  "data": {
    "total": 123,
    "maxScore": 1.0,
    "hits": [
      {
        "id": "doc-1",
        "index": "my-index",
        "score": 1.0,
        "source": { "title": "...", "description": "..." }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "pageSize": 25,
      "hasNext": true,
      "hasPrevious": false,
      "totalResults": 123
    }
  },
  "took": 15
}
```

Each hit has `id`, `index`, `score`, `source` (document body). `OginiPaginator` uses `data.pagination` when present, otherwise derives from `total`, `size`, `from`.

---

## 5. Pagination (OginiPaginator)

- **Input:** `size` and `from` in the search request body (or query).
- **Output:** `data.pagination` with:
  - `currentPage`, `totalPages`, `pageSize`, `totalResults`
  - `hasNext`, `hasPrevious`
- Engine computes these from `total`, `size`, and `from` and includes them in every search response so the driver does not need a separate pagination endpoint.

---

## 6. Delete by query

- **Driver:** `DELETE /api/indices/:indexName/documents/_query` with JSON body `{ query }`.
- **Engine:** Implements that route and forwards to the same handler as `POST .../documents/_delete_by_query` (same body shape and behaviour).

---

## 7. Health

- **Driver:** `GET /health`; expects `status`; optional `version`, `server_info` for detailed checks.
- **Engine:** Returns `{ status: 'ok', version?, server_info? }` so the driver’s health and detailed health checks work.

---

## 8. Error responses

Driver expects error body to have `message` or `error` (string) and optional `code`. Engine should return JSON error body with at least one of these for the driver to throw `OginiException` with a clear message.

---

## 9. Files changed (engine side)

- **List indices:** Response shape `{ data, total }` (was `{ indices, total }`); DTO and tests updated.
- **Search:** Added `data.pagination` to the search response; pagination derived from `size` and `from`.
- **Documents:** Added `DELETE .../documents/_query` (body `{ query }`) and `POST .../documents/bulk` (alias of `_bulk`).
- **Search route:** Controller base path `api/indices/:index` with `Post('_search')` and `Post('search')`; suggest at `Post('_search/_suggest')`, clear at `Delete('_search/_clear_dictionary')`.
- **Health:** Response includes `status`, `version`, `server_info`.

All of the above keep the Laravel Scout driver (`OginiClient`, `AsyncOginiClient`, `OginiEngine`, `OginiPaginator`) in sync with the ConnectSearch API.
