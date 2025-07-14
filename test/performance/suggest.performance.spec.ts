import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { getPort } from '../utils/port-helper';
import { setupTestApp } from '../utils/test-helpers';
import { faker } from '@faker-js/faker';
import axios from 'axios';
import { Client } from 'pg';

jest.setTimeout(300000); // 5 minutes timeout for large dataset

describe('Suggest Performance Tests', () => {
  let app: INestApplication;
  let port: number;
  let baseURL: string;
  const testIndexName = 'perf-suggest-test';
  const results: any[] = [];

  // Test configuration
  const TOTAL_DOCUMENTS = 1200000; // 1.2M documents
  const BATCH_SIZE = 10000;
  const CONCURRENT_USERS = 1000;
  const TARGET_P95_MS = 50;

  beforeAll(async () => {
    console.log('\n=== Test Setup ===');
    console.log('Creating test database connection...');

    // Create test index in database first
    const client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: 'ogini_search_test',
    });

    try {
      await client.connect();
      console.log('Connected to database successfully');

      // Delete existing index if it exists
      console.log(`Cleaning up any existing test data for index "${testIndexName}"...`);
      await client.query('DELETE FROM documents WHERE index_name = $1', [testIndexName]);
      await client.query('DELETE FROM indices WHERE index_name = $1', [testIndexName]);
      console.log('Cleanup complete');

      // Create new index
      console.log('Creating new test index...');
      await client.query(
        'INSERT INTO indices (index_name, settings, status, document_count) VALUES ($1, $2, $3, $4)',
        [testIndexName, '{}', 'open', 0],
      );
      console.log('Test index created successfully');
    } finally {
      await client.end();
      console.log('Database connection closed');
    }

    // Get a free port and setup test app
    console.log('\nStarting test application...');
    port = await getPort();
    app = await setupTestApp([AppModule]);
    await app.listen(port);
    baseURL = `http://localhost:${port}`;
    console.log(`Test application started on port ${port}`);

    // Configure index mappings
    console.log('\nConfiguring index mappings...');
    await axios.post(`${baseURL}/api/indices/${testIndexName}/mappings`, {
      properties: {
        title: { type: 'text' },
        description: { type: 'text' },
        category: { type: 'keyword' },
        tags: { type: 'keyword' },
      },
    });
    console.log('Index mappings configured successfully');

    console.log('\n=== Starting Document Indexing ===');
    console.log(`Total documents to index: ${TOTAL_DOCUMENTS.toLocaleString()}`);
    console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
    console.log(`Expected batches: ${Math.ceil(TOTAL_DOCUMENTS / BATCH_SIZE).toLocaleString()}\n`);

    let totalIndexed = 0;
    const startTime = Date.now();
    let lastProgressTime = startTime;
    const batchTimes: number[] = [];

    for (let i = 0; i < TOTAL_DOCUMENTS; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      const batchSize = Math.min(BATCH_SIZE, TOTAL_DOCUMENTS - i);
      const batch = Array.from({ length: batchSize }, (_, j) => ({
        id: `doc${i + j}`,
        document: {
          title: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          category: faker.commerce.department(),
          tags: [faker.commerce.productAdjective(), faker.commerce.productMaterial()],
        },
      }));

      try {
        await axios.post(`${baseURL}/api/indices/${testIndexName}/documents/_bulk`, {
          documents: batch,
        });

        totalIndexed += batchSize;
        const batchTime = Date.now() - batchStartTime;
        batchTimes.push(batchTime);

        // Calculate progress metrics
        const progress = (totalIndexed / TOTAL_DOCUMENTS) * 100;
        const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
        const docsPerSecond = BATCH_SIZE / (batchTime / 1000);
        const remainingDocs = TOTAL_DOCUMENTS - totalIndexed;
        const estimatedTimeRemaining = (remainingDocs / BATCH_SIZE) * avgBatchTime;

        // Log progress every 5 seconds or for every 100k documents
        const now = Date.now();
        if (now - lastProgressTime >= 5000 || totalIndexed % 100000 === 0) {
          console.log(
            `Progress: ${progress.toFixed(2)}% (${totalIndexed.toLocaleString()} documents)`,
          );
          console.log(`Batch #${Math.ceil(totalIndexed / BATCH_SIZE)} completed in ${batchTime}ms`);
          console.log(`Current indexing rate: ${docsPerSecond.toFixed(2)} docs/sec`);
          console.log(`Average batch time: ${avgBatchTime.toFixed(2)}ms`);
          console.log(
            `Estimated time remaining: ${(estimatedTimeRemaining / 1000 / 60).toFixed(
              2,
            )} minutes\n`,
          );

          // Verify actual document count in database every 100k documents
          if (totalIndexed % 100000 === 0) {
            const client = new Client({
              host: process.env.POSTGRES_HOST || 'localhost',
              port: parseInt(process.env.POSTGRES_PORT || '5432'),
              user: process.env.POSTGRES_USER || 'postgres',
              password: process.env.POSTGRES_PASSWORD || 'postgres',
              database: 'ogini_search_test',
            });

            try {
              await client.connect();
              const result = await client.query(
                'SELECT COUNT(*) FROM documents WHERE index_name = $1',
                [testIndexName],
              );
              console.log(
                `Database verification - Actual document count: ${result.rows[0].count}\n`,
              );
            } catch (error) {
              console.error('Error verifying document count:', error);
            } finally {
              await client.end();
            }
          }

          lastProgressTime = now;
        }
      } catch (error) {
        console.error(
          `Error indexing batch starting at document ${i}:`,
          error.response?.data || error.message,
        );
        throw error;
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n=== Document Indexing Complete ===');
    console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
    console.log(`Average indexing rate: ${(TOTAL_DOCUMENTS / totalTime).toFixed(2)} docs/sec`);
    console.log(`Final document count: ${totalIndexed.toLocaleString()}\n`);
  });

  afterAll(async () => {
    try {
      // Save performance results
      console.log('\n=== Saving Test Results ===');
      const resultsDir = path.join(__dirname, '../../performance-results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
        console.log('Created results directory');
      }
      fs.writeFileSync(
        path.join(resultsDir, 'suggest-performance.json'),
        JSON.stringify(results, null, 2),
      );
      console.log('Test results saved successfully');

      // Cleanup database
      console.log('\n=== Cleaning Up ===');
      console.log('Connecting to database...');
      const client = new Client({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'postgres',
        database: 'ogini_search_test',
      });

      try {
        await client.connect();
        console.log('Deleting test data...');
        await client.query('DELETE FROM documents WHERE index_name = $1', [testIndexName]);
        await client.query('DELETE FROM indices WHERE index_name = $1', [testIndexName]);
        console.log('Test data deleted successfully');
      } finally {
        await client.end();
        console.log('Database connection closed');
      }

      await app.close();
      console.log('Test application stopped');
      console.log('Cleanup complete\n');
    } catch (error) {
      console.error('Error during cleanup:', error);
      throw error;
    }
  });

  describe('Suggest Performance', () => {
    it(`should handle ${CONCURRENT_USERS} concurrent users with p95 < ${TARGET_P95_MS}ms`, async () => {
      console.log('\n=== Starting Performance Test ===');
      console.log(`Concurrent users: ${CONCURRENT_USERS}`);
      console.log(`Target P95 latency: ${TARGET_P95_MS}ms`);

      const searchTerms = ['sma', 'pro', 'dig', 'tech', 'com', 'app', 'ser', 'sys', 'net', 'dat'];
      console.log('Search terms:', searchTerms);

      // Create concurrent requests
      console.log('\nGenerating test requests...');
      const requests = Array(CONCURRENT_USERS)
        .fill(null)
        .map(() => {
          const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
          return axios.post(`${baseURL}/api/indices/${testIndexName}/_search/_suggest`, {
            text: term,
            field: 'title',
            size: 5,
          });
        });

      // Measure response times
      const latencies: number[] = [];
      const errors: Error[] = [];

      // Execute requests in batches to avoid overwhelming the system
      const BATCH_SIZE = 50;
      const totalBatches = Math.ceil(requests.length / BATCH_SIZE);
      console.log(`\nExecuting ${totalBatches} batches of ${BATCH_SIZE} requests each...`);

      for (let i = 0; i < requests.length; i += BATCH_SIZE) {
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batch = requests.slice(i, i + BATCH_SIZE);
        const batchStart = performance.now();

        console.log(`\nProcessing batch ${batchNumber}/${totalBatches}...`);

        try {
          await Promise.all(
            batch.map(async request => {
              const start = performance.now();
              try {
                await request;
                const latency = performance.now() - start;
                latencies.push(latency);

                // Log every 100th request for progress visibility
                if (latencies.length % 100 === 0) {
                  console.log(`Completed ${latencies.length} requests`);
                  const currentP95 = latencies.slice().sort((a, b) => a - b)[
                    Math.floor(latencies.length * 0.95)
                  ];
                  console.log(`Current P95: ${currentP95.toFixed(2)}ms`);
                }
              } catch (error) {
                errors.push(error);
                latencies.push(performance.now() - start);
                console.error('Request error:', error.message);
              }
            }),
          );

          const batchTime = performance.now() - batchStart;
          console.log(`Batch completed in ${batchTime.toFixed(2)}ms`);
          console.log(`Progress: ${((batchNumber / totalBatches) * 100).toFixed(2)}%`);
        } catch (error) {
          console.error('Batch error:', error);
        }

        // Add small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Calculate metrics
      console.log('\n=== Performance Results ===');
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95Latency = latencies[p95Index];
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const errorRate = (errors.length / CONCURRENT_USERS) * 100;

      // Save results
      results.push({
        test: 'suggest-concurrent-users',
        concurrentUsers: CONCURRENT_USERS,
        p95Latency,
        avgLatency,
        errorRate,
        totalRequests: CONCURRENT_USERS,
        successfulRequests: CONCURRENT_USERS - errors.length,
        failedRequests: errors.length,
        requirement: {
          p95: TARGET_P95_MS,
          errorRate: 0.1,
        },
        passed: p95Latency < TARGET_P95_MS && errorRate < 0.1,
      });

      // Log detailed results
      console.log('\nLatency Distribution:');
      const percentiles = [50, 75, 90, 95, 99];
      percentiles.forEach(p => {
        const index = Math.floor(latencies.length * (p / 100));
        console.log(`P${p}: ${latencies[index].toFixed(2)}ms`);
      });

      console.log('\nSummary:');
      console.log(`P95 Latency: ${p95Latency.toFixed(2)}ms (target: ${TARGET_P95_MS}ms)`);
      console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`Error Rate: ${errorRate.toFixed(2)}% (target: < 0.1%)`);
      console.log(`Failed Requests: ${errors.length}`);
      console.log(
        `Success Rate: ${(((CONCURRENT_USERS - errors.length) / CONCURRENT_USERS) * 100).toFixed(
          2,
        )}%`,
      );

      // Assert requirements
      expect(p95Latency).toBeLessThan(TARGET_P95_MS);
      expect(errorRate).toBeLessThan(0.1);
    });
  });
});

// Helper function to generate test documents
function generateTestDocuments(count: number) {
  const documents = [];
  const categories = ['Technology', 'Business', 'Healthcare', 'Education', 'Entertainment'];

  for (let i = 0; i < count; i++) {
    const title = `${faker.commerce.productAdjective()} ${faker.commerce.product()}`;
    documents.push({
      id: `doc_${i}`,
      document: {
        title,
        description: faker.commerce.productDescription(),
        category: categories[Math.floor(Math.random() * categories.length)],
        tags: Array.from({ length: 3 }, () => faker.commerce.department()),
      },
    });
  }

  return documents;
}
