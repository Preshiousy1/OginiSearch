/**
 * Chunked term postings E2E: term_postings with max 5000 per chunk, latency & completeness.
 * Seeds via TermPostingsRepository.update() (chunks automatically). Set POC_ENTRIES_COUNT
 * for benchmark size (default 5000; use 500000 for full POC).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { ApiModule } from '../../../src/api/api.module';
import { IndexModule } from '../../../src/index/index.module';
import { DocumentModule } from '../../../src/document/document.module';
import { SearchModule } from '../../../src/search/search.module';
import { TestDatabaseModule } from '../../utils/test-database.module';
import { TermPostingsRepository } from '../../../src/storage/mongodb/repositories/term-postings.repository';
import { RocksDBService } from '../../../src/storage/rocksdb/rocksdb.service';
import { MockRocksDBService } from '../../utils/test-database.module';
import { MongooseModule } from '@nestjs/mongoose';
import { PostingEntry } from '../../../src/storage/mongodb/schemas/term-postings.schema';
import * as fs from 'fs';
import * as path from 'path';

const POC_ENTRIES_COUNT = Number(process.env.POC_ENTRIES_COUNT) || 5000;
const WRITE_POC_REPORT = process.env.WRITE_POC_REPORT === '1' || process.env.WRITE_POC_REPORT === 'true';
const POC_INDEX_NAME = 'poc-index';
const POC_INDEX_AWARE_TERM = `${POC_INDEX_NAME}:name:limited`;
const LATENCY_RUNS = 20;
const P95_SUCCESS_MS = 500;
const P95_ABANDON_MS = 2000;

jest.setTimeout(300_000);

describe('Chunked term postings E2E', () => {
  let app: INestApplication;
  let termPostingsRepo: TermPostingsRepository;
  const latencies: number[] = [];

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(process.env.MONGODB_URI!),
        TestDatabaseModule,
        IndexModule,
        DocumentModule,
        SearchModule,
        ApiModule,
      ],
    })
      .overrideProvider(RocksDBService)
      .useValue(new MockRocksDBService());

    const moduleFixture: TestingModule = await builder.compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    termPostingsRepo = app.get(TermPostingsRepository);

    await request(app.getHttpServer())
      .post('/api/indices')
      .send({
        name: POC_INDEX_NAME,
        settings: { numberOfShards: 1, refreshInterval: '1s' },
        mappings: { properties: { name: { type: 'text' } } },
      })
      .expect(201);

    const postings: Record<string, PostingEntry> = {};
    for (let i = 0; i < POC_ENTRIES_COUNT; i++) {
      postings[`doc-${i}`] = {
        docId: `doc-${i}`,
        frequency: 1,
        positions: [0],
      };
    }
    await termPostingsRepo.update(POC_INDEX_AWARE_TERM, postings);
  });

  afterAll(async () => {
    if (WRITE_POC_REPORT && latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.min(Math.floor(latencies.length * 0.99), latencies.length - 1)];
      const report = {
        date: new Date().toISOString(),
        branch: 'new-mongodb-poc',
        postingCount: POC_ENTRIES_COUNT,
        latencyRuns: latencies.length,
        p50Ms: Math.round(p50 * 100) / 100,
        p95Ms: Math.round(p95 * 100) / 100,
        p99Ms: Math.round(p99 * 100) / 100,
        successThresholdMs: P95_SUCCESS_MS,
        abandonThresholdMs: P95_ABANDON_MS,
        goNoGo: p95 < P95_SUCCESS_MS ? 'go' : p95 >= P95_ABANDON_MS ? 'no-go' : 'document-and-decide',
      };
      const dir = path.join(__dirname, '../../../performance-results');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'poc-solution3-report.json'),
        JSON.stringify(report, null, 2),
      );
    }
    if (termPostingsRepo) {
      await termPostingsRepo.deleteByIndexAwareTerm(POC_INDEX_AWARE_TERM);
    }
    await app?.close();
  });

  describe('E1: Single-term search latency (p95 < 500ms)', () => {
    it(`should have p95 latency < ${P95_SUCCESS_MS}ms for term with ${POC_ENTRIES_COUNT} postings`, async () => {
      latencies.length = 0;
      for (let i = 0; i < LATENCY_RUNS; i++) {
        const start = Date.now();
        const res = await request(app.getHttpServer())
          .post(`/api/indices/${POC_INDEX_NAME}/_search`)
          .send({
            query: { match: { field: 'name', value: 'limited' } },
            size: 10,
            from: 0,
          });
        latencies.push(Date.now() - start);
        expect(res.status).toBe(201);
      }
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(LATENCY_RUNS * 0.95)];
      expect(p95).toBeLessThan(P95_SUCCESS_MS);
    });
  });

  describe('E2: Abandon threshold (p95 < 2000ms)', () => {
    it(`should have p95 latency < ${P95_ABANDON_MS}ms`, async () => {
      if (latencies.length === 0) {
        for (let i = 0; i < LATENCY_RUNS; i++) {
          const start = Date.now();
          await request(app.getHttpServer())
            .post(`/api/indices/${POC_INDEX_NAME}/_search`)
            .send({
              query: { match: { field: 'name', value: 'limited' } },
              size: 10,
            });
          latencies.push(Date.now() - start);
        }
        latencies.sort((a, b) => a - b);
      }
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      expect(p95).toBeLessThan(P95_ABANDON_MS);
    });
  });

  describe('E3: Result completeness', () => {
    it('should return total equal to seeded posting count', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/indices/${POC_INDEX_NAME}/_search`)
        .send({
          query: { match: { field: 'name', value: 'limited' } },
          size: 10,
          from: 0,
        })
        .expect(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.total).toBe(POC_ENTRIES_COUNT);
    });
  });
});
