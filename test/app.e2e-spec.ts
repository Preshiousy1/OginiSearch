import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { RocksDBService } from '../src/storage/rocksdb/rocksdb.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Create mock for RocksDBService
    const mockRocksDBService = {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      getByPrefix: jest.fn().mockResolvedValue([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RocksDBService)
      .useValue(mockRocksDBService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // Test the health endpoint instead of root endpoint
  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  // Test schema endpoint
  it('/schemas (GET)', () => {
    return request(app.getHttpServer()).get('/schemas').expect(200);
  });
});
