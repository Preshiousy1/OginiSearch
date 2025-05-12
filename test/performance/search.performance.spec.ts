import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { Ogini } from '../../src/client';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getPort } from '../utils/port-helper';
import { MongooseModule } from '@nestjs/mongoose';

jest.setTimeout(30000); // 30 second timeout for the entire suite

describe('Search Performance Tests', () => {
  let app: INestApplication;
  let client: Ogini;
  let testIndexName: string;
  let mongod: MongoMemoryServer;
  let port: number;
  const results: any[] = [];

  beforeAll(async () => {
    console.log('Starting test setup...');

    // Start MongoDB Memory Server first
    console.log('Starting MongoDB...');
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();
    console.log('MongoDB started at:', mongoUri);

    // Get a free port
    port = await getPort();
    console.log(`Using port: ${port}`);

    // Setup test app with MongoDB URI
    console.log('Setting up test app...');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongoUri), AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(port);
    console.log('Test app started');

    // Initialize client
    console.log('Initializing client...');
    client = new Ogini({
      baseURL: `http://localhost:${port}`,
    });

    // Create test index
    console.log('Creating test index...');
    testIndexName = 'perf-test-index';
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
    console.log('Generating test data...');
    const testData = generateTestData(10);
    await indexTestData(testData, client, testIndexName);
    console.log('Test setup complete');
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    console.log('Starting cleanup...');
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
        console.log('Deleting test index...');
        await client.indices.deleteIndex(testIndexName);
      }
      if (app) {
        console.log('Closing app...');
        await app.close();
      }
      if (mongod) {
        console.log('Stopping MongoDB...');
        await mongod.stop();
      }
      console.log('Cleanup complete');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }, 30000); // 30 second timeout for cleanup

  describe('Query Latency', () => {
    it('should meet p95 latency requirement for basic queries', async () => {
      const latencies: number[] = [];
      const iterations = 20;

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
      const iterations = 100;

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
              price: {
                gte: 100,
                lte: 1000,
              },
            },
          },
          facets: ['tags'],
        });
        const end = performance.now();
        latencies.push(end - start);
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
  });

  describe('Indexing Speed', () => {
    it('should meet indexing speed requirement', async () => {
      const batchSize = 200;
      const batches = 5;
      const totalDocs = batchSize * batches;
      const start = performance.now();

      for (let i = 0; i < batches; i++) {
        const batch = generateTestData(batchSize).map(doc => ({ document: doc }));
        await client.documents.bulkIndexDocuments(testIndexName, batch);
      }

      const end = performance.now();
      const totalTime = (end - start) / 1000; // Convert to seconds
      const docsPerSecond = totalDocs / totalTime;

      results.push({
        test: 'indexing-speed',
        docsPerSecond,
        requirement: 50,
        passed: docsPerSecond > 50,
      });

      expect(docsPerSecond).toBeGreaterThan(50);
    });
  });

  describe('Memory Usage', () => {
    it('should meet memory usage requirement', async () => {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;

      results.push({
        test: 'memory-usage',
        heapUsedMB,
        requirement: 1024, // 1GB
        passed: heapUsedMB < 1024,
      });

      expect(heapUsedMB).toBeLessThan(1024);
    });
  });
});

// Helper functions
function generateTestData(count: number) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      title: `Test Document ${i}`,
      content: `This is test content for document ${i}`,
      tags: ['test', 'document', `tag${i % 10}`],
      price: Math.floor(Math.random() * 1000),
    });
  }
  return data;
}

async function indexTestData(data: any[], client: Ogini, indexName: string) {
  const batchSize = 20;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize).map(doc => ({ document: doc }));
    await client.documents.bulkIndexDocuments(indexName, batch);
  }
}
