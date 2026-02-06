import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'bulk-test-data.json');

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForQueueToEmpty() {
  while (true) {
    try {
      const healthResponse = await axios.get(`${API_URL}/bulk-indexing/health`);
      const queues = healthResponse.data?.queues ?? {};
      const active = queues.totalActive ?? 0;
      const waiting = queues.totalWaiting ?? 0;
      const failed = queues.totalFailed ?? 0;
      if (active === 0 && waiting === 0 && failed === 0) {
        break;
      }
      console.log('Queue:', { active, waiting, failed });
      await sleep(1000);
    } catch (error: any) {
      console.error('Error checking queue health:', error.message);
      break;
    }
  }
}

async function measureBulkIndexing() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Generate test data if file doesn't exist
    if (!fs.existsSync(DATA_FILE)) {
      console.log('Generating test data first (set BULK_DOC_COUNT for document count)...');
      const count = process.env.BULK_DOC_COUNT || '10000';
      execSync('npx ts-node -r tsconfig-paths/register scripts/testing/generate-bulk-data.ts', {
        cwd: path.join(__dirname, '../..'),
        stdio: 'inherit',
        env: { ...process.env, BULK_DOC_COUNT: count },
      });
    }

    const testData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const documentCount = testData.documents.length;
    const INDEX_NAME = `bulk-test-${documentCount}`;

    console.log(`API: ${API_URL}`);
    console.log(
      `Starting bulk indexing of ${documentCount} documents into index "${INDEX_NAME}"...`,
    );

    // Delete existing index if it exists
    try {
      await axios.delete(`${API_URL}/api/indices/${INDEX_NAME}`);
      console.log('Deleted existing index');
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error('Error deleting index:', error.message);
      }
    }

    // Create new index
    await axios.post(`${API_URL}/api/indices`, {
      name: INDEX_NAME,
      mappings: {
        properties: {
          title: { type: 'text', analyzer: 'standard' },
          content: { type: 'text', analyzer: 'standard' },
          tags: { type: 'keyword' },
          metadata: {
            type: 'object',
            properties: {
              author: { type: 'keyword' },
              createdAt: { type: 'date' },
              views: { type: 'integer' },
              score: { type: 'float' },
            },
          },
        },
      },
    });
    console.log('Created index');

    // Start timing (bulk request + queue drain)
    const startTime = Date.now();

    const documents = testData.documents.map((doc: any) => ({
      id: doc.id,
      document: {
        title: doc.document.title,
        content: doc.document.content,
        tags: doc.document.tags,
        metadata: doc.document.metadata,
      },
    }));

    const response = await axios.post(
      `${API_URL}/api/indices/${INDEX_NAME}/documents/_bulk`,
      { documents },
      { maxContentLength: Infinity, maxBodyLength: Infinity },
    );
    console.log(
      'Submitted bulk request:',
      response.data?.items?.length ? `${response.data.items.length} items` : response.data,
    );

    console.log('Waiting for queue to drain...');
    await waitForQueueToEmpty();

    const endTime = Date.now();
    const timeTaken = (endTime - startTime) / 1000;

    const indexInfo = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
    const indexedCount = indexInfo.data.documentCount ?? 0;

    console.log('\n--- Bulk Indexing Results ---');
    console.log(`Documents submitted: ${documentCount}`);
    console.log(`Documents in index: ${indexedCount}`);
    console.log(`Time (submit + drain): ${timeTaken.toFixed(2)} s`);
    console.log(`Throughput: ${(documentCount / timeTaken).toFixed(2)} docs/s`);
  } catch (error: any) {
    console.error('Error during bulk indexing:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
  }
}

measureBulkIndexing().catch(console.error);
