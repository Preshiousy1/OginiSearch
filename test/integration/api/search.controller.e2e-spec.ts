import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ApiModule } from '../../../src/api/api.module';
import { IndexModule } from '../../../src/index/index.module';
import { DocumentModule } from '../../../src/document/document.module';
import { SearchModule } from '../../../src/search/search.module';
import { TestDatabaseModule } from '../../utils/test-database.module';
import { setupTestApp } from '../../utils/test-helpers';

describe('SearchController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp([
      TestDatabaseModule,
      IndexModule,
      DocumentModule,
      SearchModule,
      ApiModule,
    ]);
    // Create an index and add documents
    await request(app.getHttpServer())
      .post('/api/indices')
      .send({
        name: 'search-index',
        settings: { numberOfShards: 1, refreshInterval: '1s' },
        mappings: { properties: { title: { type: 'text' }, tag: { type: 'keyword' } } },
      });
    await request(app.getHttpServer())
      .post('/api/indices/search-index/documents')
      .send({ document: { title: 'Alpha', tag: 'a' } });
    await request(app.getHttpServer())
      .post('/api/indices/search-index/documents')
      .send({ document: { title: 'Beta', tag: 'b' } });
    await request(app.getHttpServer())
      .post('/api/indices/search-index/documents')
      .send({ document: { title: 'Gamma', tag: 'a' } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/indices/:index/_search', () => {
    it('should return search results', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/search-index/_search')
        .send({ query: 'Alpha', fields: ['title'], filter: { tag: 'a' } })
        .expect(201);

      expect(Array.isArray(res.body.data)).toBeDefined();
      expect(res.body.data.hits.length).toBeGreaterThanOrEqual(1);
      expect(res.body.took).toBeDefined();
    });

    it('should return 400 for invalid search query', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/search-index/_search')
        .send({})
        .expect(400);
    });

    it('should return 404 for non-existent index', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/does-not-exist/_search')
        .send({ query: 'alpha', fields: ['title'], filter: { tag: 'a' } })
        .expect(404);
    });
  });

  describe('POST /api/indices/:index/_search/_suggest', () => {
    it('should return suggestions', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/search-index/_search/_suggest')
        .send({ text: 'Al' })
        .expect(201);

      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body.took).toBeDefined();
    });

    it('should return 400 for invalid suggest query', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/search-index/_search/_suggest')
        .send({})
        .expect(400);
    });

    it('should return 404 for non-existent index', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/does-not-exist/_search/_suggest')
        .send({ text: 'Al' })
        .expect(404);
    });
  });
});
