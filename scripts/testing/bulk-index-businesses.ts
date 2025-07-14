import axios from 'axios';
import { Client } from 'pg';
import { generateBusinessDocuments } from './generate-business-data';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:3000/api';
const INDEX_NAME = 'businesses';
const BATCH_SIZE = 1000;
const TOTAL_DOCUMENTS = 1200000; // 1.2M documents
const VERIFY_INTERVAL = 100000; // Verify count every 100k documents

// Configure axios for larger payloads
axios.defaults.maxBodyLength = Infinity;
axios.defaults.maxContentLength = Infinity;

async function verifyDocumentCount(expectedCount: number): Promise<number> {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: 'ogini_search_test',
  });

  try {
    await client.connect();
    const result = await client.query('SELECT COUNT(*) FROM documents WHERE index_name = $1', [
      INDEX_NAME,
    ]);
    const actualCount = parseInt(result.rows[0].count);

    if (actualCount < expectedCount) {
      console.log(
        `⚠️  Warning: Expected ${expectedCount.toLocaleString()} documents, but found ${actualCount.toLocaleString()}`,
      );
    } else {
      console.log(`✅ Verified ${actualCount.toLocaleString()} documents in database`);
    }

    return actualCount;
  } catch (error) {
    console.error('Error verifying document count:', error);
    return -1;
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    console.log('🚀 Starting bulk indexing of 1.2M business documents...\n');

    // Delete existing index if it exists
    try {
      await axios.delete(`${API_URL}/indices/${INDEX_NAME}`);
      console.log('✨ Cleaned up existing index');
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // Create new index with auto-detection enabled
    console.log('📦 Creating index with auto-detection...');
    await axios.post(`${API_URL}/indices`, {
      name: INDEX_NAME,
      settings: {
        auto_detect_mappings: true,
        analysis: {
          analyzer: {
            business_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding', 'stop', 'snowball'],
            },
          },
        },
      },
    });
    console.log('✅ Index created successfully\n');

    // Initialize tracking variables
    const startTime = Date.now();
    let totalIndexed = 0;
    let lastProgressTime = startTime;
    const batchTimes: number[] = [];
    let currentBatchStart = 0;

    console.log('📊 Indexing Progress:');
    while (totalIndexed < TOTAL_DOCUMENTS) {
      const batchSize = Math.min(BATCH_SIZE, TOTAL_DOCUMENTS - totalIndexed);
      const batchStartTime = Date.now();

      // Generate and index batch
      const documents = generateBusinessDocuments(batchSize, totalIndexed + 1);

      try {
        await axios.post(`${API_URL}/indices/${INDEX_NAME}/documents/_bulk`, {
          documents: documents.map(doc => ({
            id: doc.source.id.toString(),
            document: doc.source,
          })),
        });

        // Update progress tracking
        totalIndexed += batchSize;
        const batchTime = Date.now() - batchStartTime;
        batchTimes.push(batchTime);

        // Calculate metrics
        const progress = (totalIndexed / TOTAL_DOCUMENTS) * 100;
        const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
        const docsPerSecond = batchSize / (batchTime / 1000);
        const remainingDocs = TOTAL_DOCUMENTS - totalIndexed;
        const estimatedTimeRemaining = (remainingDocs / BATCH_SIZE) * avgBatchTime;

        // Log progress every 5 seconds or at verification intervals
        const now = Date.now();
        if (now - lastProgressTime >= 5000 || totalIndexed % VERIFY_INTERVAL === 0) {
          console.log(
            `\nProgress: ${progress.toFixed(
              2,
            )}% (${totalIndexed.toLocaleString()} / ${TOTAL_DOCUMENTS.toLocaleString()})`,
          );
          console.log(`Batch #${Math.ceil(totalIndexed / BATCH_SIZE)} completed in ${batchTime}ms`);
          console.log(`Current indexing rate: ${docsPerSecond.toFixed(2)} docs/sec`);
          console.log(`Average batch time: ${avgBatchTime.toFixed(2)}ms`);
          console.log(
            `Estimated time remaining: ${(estimatedTimeRemaining / 1000 / 60).toFixed(2)} minutes`,
          );

          if (totalIndexed % VERIFY_INTERVAL === 0) {
            await verifyDocumentCount(totalIndexed);
          }

          lastProgressTime = now;
        }

        // Save checkpoint every 100k documents
        if (totalIndexed % VERIFY_INTERVAL === 0) {
          const checkpoint = {
            totalIndexed,
            lastId: totalIndexed,
            timestamp: new Date().toISOString(),
          };
          fs.writeFileSync(
            path.join(__dirname, '../../data/indexing-checkpoint.json'),
            JSON.stringify(checkpoint, null, 2),
          );
        }
      } catch (error) {
        console.error(
          `\n❌ Error indexing batch ${Math.ceil(totalIndexed / BATCH_SIZE)}:`,
          error.response?.data || error.message,
        );

        // Save error details
        const errorLog = {
          timestamp: new Date().toISOString(),
          batchNumber: Math.ceil(totalIndexed / BATCH_SIZE),
          startId: currentBatchStart + 1,
          endId: currentBatchStart + batchSize,
          error: error.response?.data || error.message,
        };
        fs.appendFileSync(
          path.join(__dirname, '../../data/indexing-errors.log'),
          JSON.stringify(errorLog, null, 2) + '\n',
        );

        throw error;
      }

      currentBatchStart += batchSize;
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n✨ Bulk Indexing Complete!');
    console.log(`Total time: ${(totalTime / 60).toFixed(2)} minutes`);
    console.log(`Final indexing rate: ${(TOTAL_DOCUMENTS / totalTime).toFixed(2)} docs/sec`);

    // Final verification
    const finalCount = await verifyDocumentCount(TOTAL_DOCUMENTS);
    console.log(`\n📊 Final Statistics:`);
    console.log(`- Expected documents: ${TOTAL_DOCUMENTS.toLocaleString()}`);
    console.log(`- Actual documents: ${finalCount.toLocaleString()}`);
    console.log(
      `- Average batch time: ${(
        batchTimes.reduce((a, b) => a + b, 0) /
        batchTimes.length /
        1000
      ).toFixed(2)}s`,
    );
  } catch (error) {
    console.error('\n❌ Fatal error during bulk indexing:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the indexing process
main();
