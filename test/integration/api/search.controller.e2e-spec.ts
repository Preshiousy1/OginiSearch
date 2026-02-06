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
        .send({
          query: {
            match: {
              value: 'Alpha',
            },
          },
          fields: ['title'],
          filter: { tag: 'a' },
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
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
        .send({
          query: {
            match: {
              value: 'alpha',
            },
          },
          fields: ['title'],
          filter: { tag: 'a' },
        })
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

  describe('Search with field weights (mappings boost)', () => {
    const fieldWeightsIndexName = 'search-field-weights-index';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/indices')
        .send({
          name: fieldWeightsIndexName,
          settings: { numberOfShards: 1, refreshInterval: '1s' },
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard', boost: 2.0 },
              description: { type: 'text', analyzer: 'standard', boost: 1.0 },
            },
          },
        });
      await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/documents`)
        .send({ document: { title: 'ranking term here', description: 'other text' } });
      await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/documents`)
        .send({ document: { title: 'other text', description: 'ranking term here' } });
      await new Promise(resolve => setTimeout(resolve, 3500));
    });

    it('should rank title match higher than description match when title boost is greater', async () => {
      const searchTitle = await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/_search`)
        .send({
          query: { match: { field: 'title', value: 'ranking' } },
          size: 10,
          from: 0,
        })
        .expect(201);
      const searchDesc = await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/_search`)
        .send({
          query: { match: { field: 'description', value: 'ranking' } },
          size: 10,
          from: 0,
        })
        .expect(201);

      const scoreTitle = searchTitle.body?.data?.hits?.[0]?.score ?? 0;
      const scoreDesc = searchDesc.body?.data?.hits?.[0]?.score ?? 0;
      expect(scoreTitle).toBeGreaterThan(0);
      expect(scoreDesc).toBeGreaterThan(0);
      expect(scoreTitle).toBeGreaterThanOrEqual(scoreDesc);
    });

    it('should rank description match higher after updating mappings to boost description', async () => {
      await request(app.getHttpServer())
        .put(`/api/indices/${fieldWeightsIndexName}/mappings`)
        .send({
          properties: {
            title: { type: 'text', analyzer: 'standard', boost: 1.0 },
            description: { type: 'text', analyzer: 'standard', boost: 2.0 },
          },
        })
        .expect(200);

      const searchTitle = await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/_search`)
        .send({
          query: { match: { field: 'title', value: 'ranking' } },
          size: 10,
          from: 0,
        })
        .expect(201);
      const searchDesc = await request(app.getHttpServer())
        .post(`/api/indices/${fieldWeightsIndexName}/_search`)
        .send({
          query: { match: { field: 'description', value: 'ranking' } },
          size: 10,
          from: 0,
        })
        .expect(201);

      const scoreTitle = searchTitle.body?.data?.hits?.[0]?.score ?? 0;
      const scoreDesc = searchDesc.body?.data?.hits?.[0]?.score ?? 0;
      expect(scoreDesc).toBeGreaterThanOrEqual(scoreTitle);
    });
  });

  describe('Search pagination (size and from)', () => {
    const paginationIndexName = 'search-pagination-index';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/indices')
        .send({
          name: paginationIndexName,
          settings: { numberOfShards: 1, refreshInterval: '1s' },
          mappings: { properties: { title: { type: 'text' }, tag: { type: 'keyword' } } },
        });
      for (let i = 0; i < 15; i++) {
        await request(app.getHttpServer())
          .post(`/api/indices/${paginationIndexName}/documents`)
          .send({ document: { title: `Item ${i} common`, tag: 'x' } });
      }
      await new Promise(resolve => setTimeout(resolve, 2500));
    });

    it('should respect size parameter', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/indices/${paginationIndexName}/_search`)
        .send({
          query: { match: { field: 'title', value: 'common' } },
          size: 5,
          from: 0,
        })
        .expect(201);
      expect(res.body.data?.hits?.length).toBeLessThanOrEqual(5);
      expect(res.body.data?.total).toBeGreaterThanOrEqual(5);
    });

    it('should respect from parameter for offset', async () => {
      const page1 = await request(app.getHttpServer())
        .post(`/api/indices/${paginationIndexName}/_search`)
        .send({
          query: { match: { field: 'title', value: 'common' } },
          size: 5,
          from: 0,
        })
        .expect(201);
      const page2 = await request(app.getHttpServer())
        .post(`/api/indices/${paginationIndexName}/_search`)
        .send({
          query: { match: { field: 'title', value: 'common' } },
          size: 5,
          from: 5,
        })
        .expect(201);
      const ids1 = (page1.body.data?.hits ?? []).map((h: any) => h.id);
      const ids2 = (page2.body.data?.hits ?? []).map((h: any) => h.id);
      const overlap = ids1.filter((id: string) => ids2.includes(id));
      expect(overlap.length).toBe(0);
    });
  });
});
