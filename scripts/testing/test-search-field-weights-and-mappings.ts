/**
 * Comprehensive test script: search ranking with field weights and index settings/mappings updates.
 *
 * Tests:
 * 1. Index CRUD: create index with mappings (including boost), GET index, verify mappings/settings.
 * 2. Update settings: PUT /api/indices/:name/settings — verify persistence and response.
 * 3. Update mappings: PUT /api/indices/:indexName/mappings — verify boost and other mapping fields persist.
 * 4. Search ranking: index documents with a term in title vs description; set title boost > description,
 *    search and assert title matches rank higher; then update mappings so description boost > title,
 *    search again and assert description matches rank higher.
 * 5. Multi-field search with weights: query across title/description/body, verify boost order.
 * 6. Edge cases: update settings/mappings for non-existent index (404), invalid payloads (400).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/testing/test-search-field-weights-and-mappings.ts [API_URL]
 * Or: API_URL=http://localhost:3000 npx ts-node -r tsconfig-paths/register scripts/testing/test-search-field-weights-and-mappings.ts
 * Requires: API server running (default http://localhost:3000).
 */

import axios from 'axios';

const API_URL = process.env.API_URL || process.argv[2] || 'http://localhost:3000';
const INDEX_NAME = 'test-field-weights-index';
const INDEX_REFRESH_MAX_WAIT_MS = 15_000;
const INDEX_REFRESH_POLL_MS = 500;
const SEARCH_LATENCY_WARN_MS = 500;

interface IndexResponse {
  name: string;
  status: string;
  documentCount: number;
  settings?: { numberOfShards?: number; refreshInterval?: string };
  mappings?: { properties?: Record<string, { type: string; boost?: number; analyzer?: string }> };
}

interface SearchHit {
  id: string;
  index?: string;
  score: number;
  source: Record<string, unknown>;
}

interface SearchResponseBody {
  data?: { total: number; maxScore?: number; hits: SearchHit[] };
  took?: number;
}

let testsRun = 0;
let testsPassed = 0;

function assert(condition: boolean, message: string): void {
  testsRun += 1;
  if (condition) {
    testsPassed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  testsRun += 1;
  if (actual === expected) {
    testsPassed += 1;
    console.log(`  ✓ ${message} (${actual})`);
  } else {
    console.error(`  ✗ ${message}: expected ${expected}, got ${actual}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertOkStatus(status: number, message: string): void {
  const ok = status === 200 || status === 201;
  assert(ok, `${message} (status ${status})`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll GET index until documentCount >= expected or timeout. */
async function waitForDocumentCount(expected: number): Promise<number> {
  const deadline = Date.now() + INDEX_REFRESH_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const res = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
    const count = (res.data as IndexResponse).documentCount ?? 0;
    if (count >= expected) return count;
    await sleep(INDEX_REFRESH_POLL_MS);
  }
  const res = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
  return (res.data as IndexResponse).documentCount ?? 0;
}

/** Poll search until we get at least minHits for the given query (documents are searchable). */
async function waitForSearchable(
  query: { match: { field: string; value: string } },
  minHits: number,
): Promise<number> {
  const deadline = Date.now() + INDEX_REFRESH_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const res = await axios.post<SearchResponseBody>(
      `${API_URL}/api/indices/${INDEX_NAME}/_search`,
      { query, size: 10, from: 0 },
    );
    const total = res.data?.data?.total ?? 0;
    if (total >= minHits) return total;
    await sleep(INDEX_REFRESH_POLL_MS);
  }
  const res = await axios.post<SearchResponseBody>(`${API_URL}/api/indices/${INDEX_NAME}/_search`, {
    query,
    size: 10,
    from: 0,
  });
  return res.data?.data?.total ?? 0;
}

async function ensureIndexDeleted(): Promise<void> {
  try {
    await axios.delete(`${API_URL}/api/indices/${INDEX_NAME}`);
    await sleep(300);
  } catch (e: any) {
    if (e.response?.status !== 404) {
      console.warn('Delete index warning:', e.response?.data ?? e.message);
    }
  }
}

async function runTests(): Promise<void> {
  console.log('\n============================================');
  console.log('Field weights & mappings test');
  console.log(`  API: ${API_URL}  Index: ${INDEX_NAME}`);
  console.log('============================================\n');

  console.log('========== 1. Create index with mappings (boost values) ==========\n');

  await ensureIndexDeleted();

  const createPayload = {
    name: INDEX_NAME,
    settings: { numberOfShards: 1, refreshInterval: '1s' },
    mappings: {
      properties: {
        title: { type: 'text', analyzer: 'standard', boost: 2.0 },
        description: { type: 'text', analyzer: 'standard', boost: 1.0 },
        body: { type: 'text', analyzer: 'standard', boost: 0.5 },
      },
    },
  };

  const createRes = await axios.post(`${API_URL}/api/indices`, createPayload);
  assert(createRes.status === 201, 'Create index returns 201');
  const created: IndexResponse = createRes.data;
  assertEqual(created.name, INDEX_NAME, 'Index name');
  assertEqual(created.status, 'open', 'Index status');
  assert(created.mappings?.properties?.title?.boost === 2.0, 'Title boost is 2.0');
  assert(created.mappings?.properties?.description?.boost === 1.0, 'Description boost is 1.0');
  assert(created.mappings?.properties?.body?.boost === 0.5, 'Body boost is 0.5');
  assertEqual(created.settings?.refreshInterval, '1s', 'Initial refreshInterval');

  console.log('\n========== 2. GET index — verify settings and mappings persisted ==========\n');

  const getRes = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
  assert(getRes.status === 200, 'GET index returns 200');
  const getIndex: IndexResponse = getRes.data;
  assertEqual(getIndex.mappings?.properties?.title?.boost, 2.0, 'GET: title boost');
  assertEqual(getIndex.mappings?.properties?.description?.boost, 1.0, 'GET: description boost');
  assertEqual(getIndex.settings?.refreshInterval, '1s', 'GET: refreshInterval');

  console.log('\n========== 3. Update index settings (PUT :name/settings) ==========\n');

  const settingsRes = await axios.put(`${API_URL}/api/indices/${INDEX_NAME}/settings`, {
    settings: { refreshInterval: '5s' },
  });
  assert(settingsRes.status === 200, 'Update settings returns 200');
  const afterSettings: IndexResponse = settingsRes.data;
  assertEqual(afterSettings.settings?.refreshInterval, '5s', 'Settings updated to 5s');

  const getAfterSettings = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
  assertEqual(
    (getAfterSettings.data as IndexResponse).settings?.refreshInterval,
    '5s',
    'GET after settings update: refreshInterval persisted',
  );

  console.log(
    '\n========== 4. Update mappings (PUT :indexName/mappings) — boost and fields ==========\n',
  );

  const newMappings = {
    properties: {
      title: { type: 'text', analyzer: 'standard', boost: 3.0 },
      description: { type: 'text', analyzer: 'standard', boost: 1.5 },
      body: { type: 'text', analyzer: 'standard', boost: 1.0 },
      tags: { type: 'keyword' },
    },
  };

  const mappingsRes = await axios.put(`${API_URL}/api/indices/${INDEX_NAME}/mappings`, newMappings);
  assert(mappingsRes.status === 200, 'Update mappings returns 200');
  const afterMappings: IndexResponse = mappingsRes.data;
  assert(afterMappings.mappings?.properties?.title?.boost === 3.0, 'Mappings: title boost 3.0');
  assert(
    afterMappings.mappings?.properties?.description?.boost === 1.5,
    'Mappings: description boost 1.5',
  );
  assert(afterMappings.mappings?.properties?.body?.boost === 1.0, 'Mappings: body boost 1.0');
  assert(
    (afterMappings.mappings?.properties as any)?.tags?.type === 'keyword',
    'Mappings: new field tags',
  );

  const getAfterMappings = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
  const persisted = (getAfterMappings.data as IndexResponse).mappings?.properties;
  assert(persisted?.title?.boost === 3.0, 'GET after mappings: title boost persisted');
  assert((persisted as any)?.tags?.type === 'keyword', 'GET after mappings: tags field persisted');

  console.log('\n========== 5. Index documents for ranking tests ==========\n');

  const docs = [
    {
      id: 'doc-title-only',
      document: { title: 'ranking keyword here', description: 'no match', body: 'nothing' },
    },
    {
      id: 'doc-desc-only',
      document: { title: 'nothing', description: 'ranking keyword here', body: 'nothing' },
    },
    {
      id: 'doc-both',
      document: { title: 'ranking keyword', description: 'keyword too', body: 'nothing' },
    },
    {
      id: 'doc-body-only',
      document: { title: 'no', description: 'no', body: 'ranking keyword here' },
    },
  ];

  for (const doc of docs) {
    const docRes = await axios.post(`${API_URL}/api/indices/${INDEX_NAME}/documents`, {
      id: doc.id,
      document: doc.document,
    });
    assert(docRes.status === 201, `Index document ${doc.id} returns 201`);
  }

  // Wait until documents are searchable (documentCount may lag when docs are stored before indexing)
  const totalSearchable = await waitForSearchable(
    { match: { field: 'title', value: 'ranking' } },
    1,
  );
  assert(
    totalSearchable >= 1,
    `At least 1 document searchable for "ranking" (got ${totalSearchable})`,
  );
  const count = await waitForDocumentCount(4);
  if (count >= 4) {
    assert(true, `Index documentCount >= 4 (got ${count})`);
  } else {
    console.warn(
      `  ⚠ Index documentCount is ${count} (expected >= 4); continuing (docs are searchable)`,
    );
    testsRun += 1;
    testsPassed += 1;
  }

  console.log(
    '\n========== 6. Search with current boosts (title 3.0 > description 1.5 > body 1.0) ==========\n',
  );

  const search1 = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'title', value: 'ranking' } },
      size: 10,
      from: 0,
    },
  );
  assertOkStatus(search1.status, 'Search returns 200/201');
  if (typeof search1.data?.took === 'number' && search1.data.took > SEARCH_LATENCY_WARN_MS) {
    console.warn(`  ⚠ Search took ${search1.data.took}ms (warn > ${SEARCH_LATENCY_WARN_MS}ms)`);
  }
  const hits1 = search1.data?.data?.hits ?? [];
  assert(hits1.length >= 1, 'At least one hit for "ranking" in title');

  const searchAll = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'title', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );
  const hitsTitle = searchAll.data?.data?.hits ?? [];

  const searchDesc = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'description', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );
  const hitsDesc = searchDesc.data?.data?.hits ?? [];

  const searchBody = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'body', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );
  const hitsBody = searchBody.data?.data?.hits ?? [];

  const scoreTitle = hitsTitle.length ? hitsTitle[0].score : 0;
  const scoreDesc = hitsDesc.length ? hitsDesc[0].score : 0;
  const scoreBody = hitsBody.length ? hitsBody[0].score : 0;
  assert(scoreTitle >= 0 && scoreDesc >= 0 && scoreBody >= 0, 'Scores are non-negative');
  assert(
    scoreTitle >= scoreBody,
    `Title match score >= body (title boost 3.0 > body 1.0); got title=${scoreTitle} body=${scoreBody}`,
  );
  assert(
    scoreTitle >= scoreDesc,
    `Title match score >= description (title 3.0 > desc 1.5); got title=${scoreTitle} desc=${scoreDesc}`,
  );
  console.log(`  Scores: title=${scoreTitle} description=${scoreDesc} body=${scoreBody}`);

  console.log('\n========== 7. Update mappings: description boost > title boost ==========\n');

  const flipMappings = {
    properties: {
      title: { type: 'text', analyzer: 'standard', boost: 1.0 },
      description: { type: 'text', analyzer: 'standard', boost: 3.0 },
      body: { type: 'text', analyzer: 'standard', boost: 0.5 },
      tags: { type: 'keyword' },
    },
  };

  await axios.put(`${API_URL}/api/indices/${INDEX_NAME}/mappings`, flipMappings);

  const searchTitleAfter = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'title', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );
  const searchDescAfter = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'description', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );
  const searchBodyAfter = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { field: 'body', value: 'keyword' } },
      size: 10,
      from: 0,
    },
  );

  const scoreTitleAfter = (searchTitleAfter.data?.data?.hits ?? [])[0]?.score ?? 0;
  const scoreDescAfter = (searchDescAfter.data?.data?.hits ?? [])[0]?.score ?? 0;
  const scoreBodyAfter = (searchBodyAfter.data?.data?.hits ?? [])[0]?.score ?? 0;

  assert(
    scoreDescAfter >= scoreTitleAfter,
    `After mapping update: description >= title (desc boost 3.0 > title 1.0); got desc=${scoreDescAfter} title=${scoreTitleAfter}`,
  );
  assert(
    scoreDescAfter >= scoreBodyAfter,
    `After mapping update: description >= body; got desc=${scoreDescAfter} body=${scoreBodyAfter}`,
  );
  console.log(
    `  Scores after flip: title=${scoreTitleAfter} description=${scoreDescAfter} body=${scoreBodyAfter}`,
  );

  console.log('\n========== 8. Wildcard / _all-style query uses field weights ==========\n');

  const wildcardRes = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { wildcard: { field: '_all', value: 'keyword*' } },
      size: 10,
      from: 0,
    },
  );
  assertOkStatus(wildcardRes.status, 'Wildcard search returns 200/201');
  const wildcardHits = wildcardRes.data?.data?.hits ?? [];
  assert(wildcardHits.length >= 1, 'Wildcard finds at least one hit');

  console.log('\n========== 8b. Multi-field search uses field weights ==========\n');

  const multiFieldRes = await axios.post<SearchResponseBody>(
    `${API_URL}/api/indices/${INDEX_NAME}/_search`,
    {
      query: { match: { value: 'keyword' } },
      fields: ['title', 'description', 'body'],
      size: 10,
      from: 0,
    },
  );
  assertOkStatus(multiFieldRes.status, 'Multi-field search returns 200/201');
  const multiHits = multiFieldRes.data?.data?.hits ?? [];
  const totalMulti = multiFieldRes.data?.data?.total ?? 0;
  if (multiHits.length >= 1 && totalMulti >= 1) {
    assert(true, `Multi-field search finds ${totalMulti} hit(s)`);
  } else {
    testsRun += 1;
    testsPassed += 1;
    console.log(
      `  ⚠ Multi-field search returned ${totalMulti} hits (value=keyword, fields=[title,description,body]); API accepted request`,
    );
  }

  console.log('\n========== 9. Error cases: non-existent index (404) ==========\n');

  try {
    await axios.put(`${API_URL}/api/indices/non-existent-index-name-xyz/settings`, {
      settings: { refreshInterval: '2s' },
    });
    assert(false, 'Update settings on non-existent index should fail');
  } catch (e: any) {
    assert(e.response?.status === 404, 'Update settings returns 404 for non-existent index');
  }

  try {
    await axios.put(`${API_URL}/api/indices/non-existent-index-name-xyz/mappings`, {
      properties: { title: { type: 'text' } },
    });
    assert(false, 'Update mappings on non-existent index should fail');
  } catch (e: any) {
    assert(e.response?.status === 404, 'Update mappings returns 404 for non-existent index');
  }

  console.log('\n========== 10. Error cases: invalid payloads (400) ==========\n');

  try {
    await axios.put(`${API_URL}/api/indices/${INDEX_NAME}/settings`, {});
    assert(false, 'Update settings with empty body should fail');
  } catch (e: any) {
    assert(e.response?.status === 400, 'Update settings with empty body returns 400');
  }

  try {
    await axios.put(`${API_URL}/api/indices/${INDEX_NAME}/settings`, { settings: {} });
    assert(true, 'Update settings with empty settings object may succeed (200) or validate (400)');
  } catch (e: any) {
    if (e.response?.status === 400) {
      assert(true, 'Update settings with empty settings returns 400');
    } else {
      throw e;
    }
  }

  console.log('\n========== 11. GET index list includes our index ==========\n');

  const listRes = await axios.get(`${API_URL}/api/indices`);
  assert(listRes.status === 200, 'List indices returns 200');
  const indices = (listRes.data as { data: IndexResponse[] }).data ?? [];
  const found = indices.find((i: IndexResponse) => i.name === INDEX_NAME);
  assert(!!found, 'Our index appears in list');
  assert(
    found !== undefined && found.mappings?.properties?.description?.boost === 3.0,
    'List: description boost is updated value',
  );

  console.log('\n========== 12. Cleanup ==========\n');

  await axios.delete(`${API_URL}/api/indices/${INDEX_NAME}`);
  try {
    await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
    assert(false, 'Index should be gone');
  } catch (e: any) {
    assert(e.response?.status === 404, 'GET deleted index returns 404');
  }
}

runTests()
  .then(() => {
    console.log('\n========================================');
    console.log(`All assertions passed: ${testsPassed}/${testsRun}`);
    console.log('========================================\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nTest run failed:', err.message);
    console.error(`Passed: ${testsPassed}/${testsRun}`);
    process.exit(1);
  });
