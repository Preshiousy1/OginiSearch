import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const API_URL = 'http://localhost:3000';
const INDEX_NAME = 'bulk-test-10000'; // Use a new index name for 10000 docs
const BATCH_SIZE = 50; // Process documents in batches of 50

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForQueueToEmpty() {
  while (true) {
    try {
      const healthResponse = await axios.get(`${API_URL}/bulk-indexing/health`);
      const queues = healthResponse.data.queues;
      if (queues.totalActive === 0 && queues.totalFailed === 0) {
        break;
      }
      console.log('Queue Status:', {
        active: queues.totalActive,
        failed: queues.totalFailed,
        waiting: queues.totalWaiting,
      });
      await sleep(1000);
    } catch (error) {
      console.error('Error checking queue health:', error.message);
      break;
    }
  }
}

async function measureBulkIndexing() {
  try {
    // Load the test data
    const dataPath = path.join(__dirname, '../../data/bulk-test-data.json');
    if (!fs.existsSync(dataPath)) {
      console.log('Generating test data first...');
      require('./generate-bulk-data');
    }

    const testData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const documentCount = testData.documents.length;

    console.log(`Starting bulk indexing of ${documentCount} documents...`);

    // Delete existing index if it exists
    try {
      await axios.delete(`${API_URL}/api/indices/${INDEX_NAME}`);
      console.log('Deleted existing index');
    } catch (error) {
      // Ignore 404 errors
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
    console.log('Created new index');

    // Initialize the term dictionary
    await axios.post(`${API_URL}/api/indices/${INDEX_NAME}/_rebuild_all`);
    console.log('Initialized term dictionary');

    // Start timing
    const startTime = Date.now();

    // Submit documents in batches
    const documents = testData.documents.map((doc: any) => ({
      id: doc.id,
      document: {
        title: doc.document.title,
        content: doc.document.content,
        tags: doc.document.tags,
        metadata: doc.document.metadata,
      },
    }));

    // Submit all documents in a single batch request
    const response = await axios.post(`${API_URL}/api/indices/${INDEX_NAME}/documents/_bulk`, {
      documents,
    });

    console.log('Submitted bulk indexing request:', response.data);

    // Wait for queue to empty
    console.log('Waiting for indexing to complete...');
    await waitForQueueToEmpty();

    // Calculate time taken
    const endTime = Date.now();
    const timeTaken = (endTime - startTime) / 1000; // Convert to seconds

    // Verify document count
    const indexInfo = await axios.get(`${API_URL}/api/indices/${INDEX_NAME}`);
    const indexedCount = indexInfo.data.documentCount;

    console.log('\nBulk Indexing Results:');
    console.log('------------------------');
    console.log(`Total documents processed: ${documentCount}`);
    console.log(`Documents in index: ${indexedCount}`);
    console.log(`Time taken: ${timeTaken.toFixed(2)} seconds`);
    console.log(`Indexing speed: ${(documentCount / timeTaken).toFixed(2)} documents/second`);
  } catch (error) {
    console.error('Error during bulk indexing:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
  }
}

measureBulkIndexing().catch(console.error);
