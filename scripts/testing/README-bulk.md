# Bulk indexing test scripts

Measure bulk indexing **against a running API** (start the app first, e.g. `npm run start:dev` or `npm run dev:start`).

## 1. Generate bulk data

Writes `data/bulk-test-data.json`. Document count is configurable via `BULK_DOC_COUNT` (default 10000).

```bash
# 10,000 documents (default)
npm run bulk:generate

# 50,000 documents
BULK_DOC_COUNT=50000 npm run bulk:generate

# Custom count
BULK_DOC_COUNT=100000 npm run bulk:generate
```

## 2. Measure bulk indexing

Uses `data/bulk-test-data.json`. If the file is missing, runs the generator first (using `BULK_DOC_COUNT` if set).

**Requires the API to be running** (e.g. `npm run start:dev`).

```bash
npm run bulk:measure
```

Optional env:

- `API_URL` – default `http://localhost:3000`
- `BULK_DOC_COUNT` – used only when generating data (when the data file is missing)

The script will:

1. Create/delete index `bulk-test-{count}`
2. POST all documents to `POST /api/indices/{index}/documents/_bulk`
3. Poll `GET /bulk-indexing/health` until the queue is empty
4. Print: documents submitted, documents in index, time, throughput (docs/s)

For 10k documents, expect a few minutes for the queue to drain depending on concurrency and hardware.

## Next: 50k-term chunking test

A separate script will generate data where **one term appears in 50k documents** to verify the 5000-doc-id chunking for long posting lists.
