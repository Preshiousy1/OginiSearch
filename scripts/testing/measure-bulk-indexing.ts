import axios from 'axios';
import { generateTestDocuments } from './generate-bulk-data';

const API_URL = 'http://localhost:3000/api';
const INDEX_NAME = 'third-index-10000';
const BATCH_SIZE = 1000;

async function waitForIndexing(startCount: number) {
  let currentCount = startCount;
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    const response = await axios.get(`${API_URL}/indices/${INDEX_NAME}`);
    const newCount = response.data.documentCount || 0;

    if (newCount > currentCount) {
      const progress = ((newCount - startCount) / 10000) * 100;
      console.log(`Indexing progress: ${progress.toFixed(2)}% (${newCount} documents)`);
      currentCount = newCount;
    }

    if (currentCount >= startCount + 10000) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  return currentCount;
}

async function main() {
  try {
    console.log('Starting bulk indexing of 10000 documents...');

    // Delete existing index if it exists
    try {
      await axios.delete(`${API_URL}/indices/${INDEX_NAME}`);
      console.log('Deleted existing index');
    } catch (error) {
      // Ignore 404 errors
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // Create new index
    await axios.post(`${API_URL}/indices`, {
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

    // Generate test documents
    const documents = generateTestDocuments(10000);
    console.log(`Generated ${documents.length} test documents`);

    // Split documents into batches
    const batches = [];
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      batches.push(documents.slice(i, i + BATCH_SIZE));
    }

    // Index documents in batches
    const startTime = Date.now();
    let totalIndexed = 0;

    for (const batch of batches) {
      const batchStartTime = Date.now();

      // Submit batch for indexing
      const response = await axios.post(`${API_URL}/indices/${INDEX_NAME}/documents/_bulk`, {
        documents: batch.map(doc => ({
          id: doc.id,
          document: {
            title: doc.title,
            content: doc.content,
            tags: doc.tags,
            metadata: doc.metadata,
          },
        })),
      });

      console.log('bulk indexing response.data', response.data);

      const batchEndTime = Date.now();
      const batchDuration = batchEndTime - batchStartTime;
      totalIndexed += batch.length;

      console.log(`Indexed batch of ${batch.length} documents in ${batchDuration}ms`);
      console.log(`Progress: ${((totalIndexed / documents.length) * 100).toFixed(2)}%`);
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const docsPerSecond = (documents.length / totalDuration) * 1000;

    console.log('\nBulk indexing completed:');
    console.log(`Total documents indexed: ${documents.length}`);
    console.log(`Total time: ${totalDuration}ms`);
    console.log(`Average speed: ${docsPerSecond.toFixed(2)} documents/second`);
  } catch (error) {
    console.error('Error during bulk indexing:', error.response?.data || error.message);
    process.exit(1);
  }
}

main();
