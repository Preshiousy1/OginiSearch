import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { RocksDBService } from '../src/storage/rocksdb/rocksdb.service';
import { setupTestApp } from './utils/test-helpers';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp([AppModule]);
  });

  afterAll(async () => {
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
