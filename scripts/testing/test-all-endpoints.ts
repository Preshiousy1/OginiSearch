/**
 * Test all API endpoints (Laravel Scout driver contract).
 * Run with: npx ts-node -r tsconfig-paths/register scripts/testing/test-all-endpoints.ts
 * Requires: API running at API_URL (default http://localhost:3000)
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const INDEX_NAME = `test-endpoints-${Date.now()}`;

type Result = { name: string; ok: boolean; error?: string };

async function request(
  method: string,
  path: string,
  body?: object,
  qs?: Record<string, string | number>,
): Promise<{ status: number; data: any }> {
  const url = new URL(path, API_BASE_URL);
  if (qs) {
    Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  let data: any = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, data };
}

async function run(): Promise<void> {
  const results: Result[] = [];

  function ok(name: string, condition: boolean, error?: string) {
    results.push({ name, ok: condition, error });
  }

  console.log(`\n=== Testing all endpoints (${API_BASE_URL}) ===\n`);

  // 1. Health
  try {
    const health = await request('GET', '/health');
    ok('GET /health', health.status === 200 && (health.data?.status === 'ok' || health.data?.status === 'OK'));
    if (health.data?.version) console.log(`   version: ${health.data.version}`);
  } catch (e: any) {
    ok('GET /health', false, e.message);
  }

  // 2. List indices (expect data array)
  try {
    const list = await request('GET', '/api/indices');
    const hasData = Array.isArray(list.data?.data) && typeof list.data?.total === 'number';
    ok('GET /api/indices (list) - response has data & total', list.status === 200 && hasData);
    if (!hasData && list.status === 200) {
      ok('GET /api/indices (list)', false, 'expected { data: [], total }');
    }
  } catch (e: any) {
    ok('GET /api/indices', false, e.message);
  }

  // 3. Create index
  try {
    const create = await request('POST', '/api/indices', {
      name: INDEX_NAME,
      mappings: { properties: { title: { type: 'text' }, count: { type: 'integer' } } },
    });
    ok('POST /api/indices (create)', create.status === 201 && create.data?.name === INDEX_NAME);
  } catch (e: any) {
    ok('POST /api/indices (create)', false, e.message);
  }

  // 4. Get index
  try {
    const get = await request('GET', `/api/indices/${INDEX_NAME}`);
    ok('GET /api/indices/:name', get.status === 200 && get.data?.name === INDEX_NAME);
  } catch (e: any) {
    ok('GET /api/indices/:name', false, e.message);
  }

  // 5. Update index settings
  try {
    const update = await request('PUT', `/api/indices/${INDEX_NAME}/settings`, {
      settings: { refreshInterval: '2s' },
    });
    ok('PUT /api/indices/:name/settings', update.status === 200);
  } catch (e: any) {
    ok('PUT /api/indices/:name/settings', false, e.message);
  }

  // 6. Index document
  try {
    const indexDoc = await request('POST', `/api/indices/${INDEX_NAME}/documents`, {
      id: 'doc-1',
      document: { title: 'Hello World', count: 10 },
    });
    ok('POST /api/indices/:index/documents', indexDoc.status === 201 && indexDoc.data?.id);
  } catch (e: any) {
    ok('POST /api/indices/:index/documents', false, e.message);
  }

  // 7. Get document
  try {
    const getDoc = await request('GET', `/api/indices/${INDEX_NAME}/documents/doc-1`);
    ok('GET /api/indices/:index/documents/:id', getDoc.status === 200 && getDoc.data?.source?.title === 'Hello World');
  } catch (e: any) {
    ok('GET /api/indices/:index/documents/:id', false, e.message);
  }

  // 8. Update document
  try {
    const updateDoc = await request('PUT', `/api/indices/${INDEX_NAME}/documents/doc-1`, {
      document: { title: 'Hello Updated', count: 20 },
    });
    ok('PUT /api/indices/:index/documents/:id', updateDoc.status === 200);
  } catch (e: any) {
    ok('PUT /api/indices/:index/documents/:id', false, e.message);
  }

  // 9. List documents
  try {
    const listDocs = await request('GET', `/api/indices/${INDEX_NAME}/documents`, undefined, {
      limit: 10,
      offset: 0,
    });
    ok('GET /api/indices/:index/documents (list)', listDocs.status === 200);
  } catch (e: any) {
    ok('GET /api/indices/:index/documents (list)', false, e.message);
  }

  // 10. Bulk index (_bulk)
  try {
    const bulk = await request('POST', `/api/indices/${INDEX_NAME}/documents/_bulk`, {
      documents: [
        { id: 'doc-2', document: { title: 'Bulk One', count: 1 } },
        { id: 'doc-3', document: { title: 'Bulk Two', count: 2 } },
      ],
    });
    ok('POST /api/indices/:index/documents/_bulk', (bulk.status === 200 || bulk.status === 201) && bulk.data?.items);
  } catch (e: any) {
    ok('POST /api/indices/:index/documents/_bulk', false, e.message);
  }

  // 11. Bulk index alias (bulk)
  try {
    const bulkAlias = await request('POST', `/api/indices/${INDEX_NAME}/documents/bulk`, {
      documents: [{ id: 'doc-4', document: { title: 'Bulk Alias', count: 4 } }],
    });
    ok('POST /api/indices/:index/documents/bulk (alias)', (bulkAlias.status === 200 || bulkAlias.status === 201));
  } catch (e: any) {
    ok('POST /api/indices/:index/documents/bulk (alias)', false, e.message);
  }

  // 12. Search (_search) — response: { data: { total, hits, pagination?, ... }, took? }
  try {
    const search = await request('POST', `/api/indices/${INDEX_NAME}/_search`, {
      query: { match: { field: 'title', value: 'Hello' } },
      size: 10,
      from: 0,
    });
    const payload = search.data?.data ?? search.data;
    const hasData =
      search.status === 200 &&
      payload &&
      Array.isArray(payload.hits) &&
      typeof payload.total === 'number';
    const hasPagination =
      payload?.pagination && typeof payload.pagination.currentPage === 'number';
    const hasTook = typeof (search.data?.took ?? payload?.took) === 'number';
    ok('POST /api/indices/:index/_search', hasData);
    ok('  - response has data.pagination', hasPagination);
    ok('  - response has took', hasTook);
  } catch (e: any) {
    ok('POST /api/indices/:index/_search', false, e.message);
  }

  // 13. Search alias (search)
  try {
    const searchAlias = await request('POST', `/api/indices/${INDEX_NAME}/search`, {
      query: { match_all: {} },
      size: 5,
      from: 0,
    });
    const aliasPayload = searchAlias.data?.data ?? searchAlias.data;
    ok(
      'POST /api/indices/:index/search (alias)',
      searchAlias.status === 200 && aliasPayload && Array.isArray(aliasPayload.hits),
    );
  } catch (e: any) {
    ok('POST /api/indices/:index/search (alias)', false, e.message);
  }

  // 14. Suggest — response: { suggestions: string[], took? }
  try {
    const suggest = await request('POST', `/api/indices/${INDEX_NAME}/_search/_suggest`, {
      text: 'Hel',
      field: 'title',
      size: 5,
    });
    const suggestions = suggest.data?.suggestions ?? suggest.data?.data?.suggestions;
    ok(
      'POST /api/indices/:index/_search/_suggest',
      suggest.status === 200 && Array.isArray(suggestions),
    );
  } catch (e: any) {
    ok('POST /api/indices/:index/_search/_suggest', false, e.message);
  }

  // 15. Delete by query (DELETE _query) — body: { query: { term: { field, value } } }
  try {
    const deleteByQuery = await request('DELETE', `/api/indices/${INDEX_NAME}/documents/_query`, {
      query: { term: { field: 'title', value: 'Bulk Alias' } },
    });
    ok(
      'DELETE /api/indices/:index/documents/_query',
      deleteByQuery.status === 200 || deleteByQuery.status === 204,
    );
  } catch (e: any) {
    ok('DELETE /api/indices/:index/documents/_query', false, e.message);
  }

  // 16. Delete document
  try {
    const delDoc = await request('DELETE', `/api/indices/${INDEX_NAME}/documents/doc-4`);
    ok('DELETE /api/indices/:index/documents/:id', delDoc.status === 200 || delDoc.status === 204);
  } catch (e: any) {
    ok('DELETE /api/indices/:index/documents/:id', false, e.message);
  }

  // 17. Delete by query (POST _delete_by_query) - delete one more for cleanup
  try {
    const postDeleteByQuery = await request('POST', `/api/indices/${INDEX_NAME}/documents/_delete_by_query`, {
      query: { term: { field: 'title', value: 'Bulk Two' } },
    });
    ok(
      'POST /api/indices/:index/documents/_delete_by_query',
      postDeleteByQuery.status === 200 || postDeleteByQuery.status === 204,
    );
  } catch (e: any) {
    ok('POST /api/indices/:index/documents/_delete_by_query', false, e.message);
  }

  // 18. Delete index
  try {
    const delIndex = await request('DELETE', `/api/indices/${INDEX_NAME}`);
    ok('DELETE /api/indices/:name', delIndex.status === 200 || delIndex.status === 204);
  } catch (e: any) {
    ok('DELETE /api/indices/:name', false, e.message);
  }

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log('\n--- Results ---\n');
  results.forEach(r => {
    console.log(r.ok ? `  ✓ ${r.name}` : `  ✗ ${r.name}${r.error ? ` - ${r.error}` : ''}`);
  });
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('\nFailed:');
    failed.forEach(r => console.log(`  - ${r.name}${r.error ? `: ${r.error}` : ''}`));
    process.exit(1);
  }
  console.log('\nAll endpoint tests passed.\n');
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
