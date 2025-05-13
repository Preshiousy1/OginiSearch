import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { Ogini } from '../../packages/client/src';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { getPort } from '../utils/port-helper';
import { setupTestApp } from '../utils/test-helpers';

jest.setTimeout(30000); // 30 second timeout for the entire suite

describe('Search Performance Tests', () => {
  let app: INestApplication;
  let client: Ogini;
  let testIndexName: string;
  let port: number;
  const results: any[] = [];

  beforeAll(async () => {
    // Get a free port
    port = await getPort();

    // Setup test app using the helper
    app = await setupTestApp([AppModule]);
    await app.listen(port);

    // Initialize client with increased timeout
    client = new Ogini({
      baseURL: `http://localhost:${port}`,
      timeout: 30000,
    });

    // Create test index
    testIndexName = 'perf-test-index';
    try {
      await client.indices.deleteIndex(testIndexName);
    } catch (error) {
      // Ignore error if index doesn't exist
    }

    await client.indices.createIndex({
      name: testIndexName,
      mappings: {
        properties: {
          title: { type: 'text' },
          content: { type: 'text' },
          tags: { type: 'keyword' },
          price: { type: 'float' },
        },
      },
    });

    // Generate and index test data
    const testData = generateTestData(10);
    await indexTestData(testData, client, testIndexName);
  });

  afterAll(async () => {
    try {
      // Save performance results
      const resultsDir = path.join(__dirname, '../../performance-results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
      }
      fs.writeFileSync(
        path.join(resultsDir, 'search-performance.json'),
        JSON.stringify(results, null, 2),
      );

      // Cleanup
      if (client?.indices) {
        try {
          await client.indices.deleteIndex(testIndexName);
        } catch (error) {
          // Log but don't fail the test
          console.warn('Failed to delete index:', error.message);
        }
      }

      if (app) {
        await app.close();
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('Query Latency', () => {
    it('should meet p95 latency requirement for basic queries', async () => {
      const latencies: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.search.search(testIndexName, {
          query: {
            match: {
              field: 'title',
              value: 'test',
            },
          },
        });
        const end = performance.now();
        latencies.push(end - start);

        // Add delay between iterations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Calculate p95
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(iterations * 0.95);
      const p95Latency = latencies[p95Index];

      results.push({
        test: 'basic-query-latency',
        p95: p95Latency,
        requirement: 100,
        passed: p95Latency < 100,
      });

      expect(p95Latency).toBeLessThan(100);
    });

    it('should meet p95 latency requirement for complex queries', async () => {
      const latencies: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.search.search(testIndexName, {
          query: {
            match: {
              field: 'title',
              value: 'test',
            },
          },
          filter: {
            range: {
              field: 'price',
              gte: 100,
              lte: 1000,
            },
          },
          facets: ['tags'],
        });
        const end = performance.now();
        latencies.push(end - start);

        // Add delay between iterations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Calculate p95
      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(iterations * 0.95);
      const p95Latency = latencies[p95Index];

      results.push({
        test: 'complex-query-latency',
        p95: p95Latency,
        requirement: 150,
        passed: p95Latency < 150,
      });

      expect(p95Latency).toBeLessThan(150);
    });

    it('should meet p95 latency requirement for term queries', async () => {
      const latencies: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.search.search(testIndexName, {
          query: {
            term: {
              field: 'tags',
              value: 'test',
            },
          },
        });
        const end = performance.now();
        latencies.push(end - start);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const p95Index = Math.floor(iterations * 0.95);
      const p95Latency = latencies.sort((a, b) => a - b)[p95Index];

      results.push({
        test: 'term-query-latency',
        p95: p95Latency,
        requirement: 50,
        passed: p95Latency < 50,
      });

      expect(p95Latency).toBeLessThan(50);
    });

    it('should meet p95 latency requirement for multi-match queries', async () => {
      const latencies: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await client.search.search(testIndexName, {
          query: {
            match: {
              field: 'title,content',
              value: 'test',
            },
          },
        });
        const end = performance.now();
        latencies.push(end - start);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const p95Index = Math.floor(iterations * 0.95);
      const p95Latency = latencies.sort((a, b) => a - b)[p95Index];

      results.push({
        test: 'multi-match-query-latency',
        p95: p95Latency,
        requirement: 120,
        passed: p95Latency < 120,
      });

      expect(p95Latency).toBeLessThan(120);
    });
  });

  describe('Indexing Performance', () => {
    it('should meet indexing speed requirement for single documents', async () => {
      const batchSize = 10;
      const batches = 2;
      const totalDocs = batchSize * batches;
      const start = performance.now();

      for (let i = 0; i < batches; i++) {
        const batch = generateTestData(batchSize);
        await Promise.all(
          batch.map(doc => client.documents.indexDocument(testIndexName, { document: doc })),
        );
        // Add delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const end = performance.now();
      const totalTime = (end - start) / 1000; // Convert to seconds
      const docsPerSecond = totalDocs / totalTime;

      results.push({
        test: 'indexing-speed',
        docsPerSecond,
        requirement: 15,
        passed: docsPerSecond > 15,
      });

      expect(docsPerSecond).toBeGreaterThan(15);
    });

    it('should meet bulk indexing speed requirement', async () => {
      const batchSize = 50;
      const batches = 2;
      const totalDocs = batchSize * batches;
      const start = performance.now();

      for (let i = 0; i < batches; i++) {
        const batch = generateTestData(batchSize);
        await Promise.all(
          batch.map(doc => client.documents.indexDocument(testIndexName, { document: doc })),
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const end = performance.now();
      const totalTime = (end - start) / 1000;
      const docsPerSecond = totalDocs / totalTime;

      results.push({
        test: 'bulk-indexing-speed',
        docsPerSecond,
        requirement: 50,
        passed: docsPerSecond > 50,
      });

      expect(docsPerSecond).toBeGreaterThan(50);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous searches', async () => {
      const searches = Array(5)
        .fill(null)
        .map(() => ({
          query: {
            match: {
              field: 'title',
              value: 'test',
            },
          },
        }));

      const start = performance.now();
      await Promise.all(searches.map(query => client.search.search(testIndexName, query)));
      const end = performance.now();
      const totalTime = end - start;

      results.push({
        test: 'concurrent-searches',
        totalTime,
        requirement: 500,
        passed: totalTime < 500,
      });

      expect(totalTime).toBeLessThan(500);
    });

    it('should handle mixed read/write operations', async () => {
      const operations = [
        // Search operations
        () =>
          client.search.search(testIndexName, {
            query: { match: { field: 'title', value: 'test' } },
          }),
        // Index operations
        () =>
          client.documents.indexDocument(testIndexName, {
            document: generateTestData(1)[0],
          }),
        // Term query
        () =>
          client.search.search(testIndexName, {
            query: { term: { field: 'tags', value: 'test' } },
          }),
        // Multi-match query
        () =>
          client.search.search(testIndexName, {
            query: { match: { field: 'title,content', value: 'test' } },
          }),
        // Complex query
        () =>
          client.search.search(testIndexName, {
            query: { match: { field: 'title', value: 'test' } },
            filter: { range: { field: 'price', gte: 100, lte: 1000 } },
            facets: ['tags'],
          }),
      ];

      const start = performance.now();
      await Promise.all(operations.map(op => op()));
      const end = performance.now();
      const totalTime = end - start;

      results.push({
        test: 'mixed-operations',
        totalTime,
        requirement: 1000,
        passed: totalTime < 1000,
      });

      expect(totalTime).toBeLessThan(1000);
    });
  });

  describe('Memory Usage', () => {
    it('should meet memory usage requirement under load', async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Create some load
      const operations = [];
      for (let i = 0; i < 5; i++) {
        operations.push(
          client.search.search(testIndexName, {
            query: { match: { field: 'title', value: 'test' } },
          }),
          client.documents.indexDocument(testIndexName, {
            document: generateTestData(1)[0],
          }),
        );
      }

      // Run operations
      await Promise.all(operations);

      // Wait for any pending operations to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;

      results.push({
        test: 'memory-usage-under-load',
        heapUsedMB,
        requirement: 512,
        passed: heapUsedMB < 512,
      });

      expect(heapUsedMB).toBeLessThan(512);
    });
  });
});

// Helper functions
function generateTestData(count: number) {
  const data = [];
  const contentBase = 'This is test content for document';
  const tags = ['test', 'document', 'performance'];

  for (let i = 0; i < count; i++) {
    data.push({
      title: `Test Document ${i}`,
      content: `${contentBase} ${i}`,
      tags: [tags[i % tags.length]],
      price: Math.floor(Math.random() * 1000),
    });
  }
  return data;
}

async function indexTestData(data: any[], client: Ogini, indexName: string) {
  const batchSize = 5;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    await Promise.all(
      batch.map(doc => client.documents.indexDocument(indexName, { document: doc })),
    );
    // Add delay between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
