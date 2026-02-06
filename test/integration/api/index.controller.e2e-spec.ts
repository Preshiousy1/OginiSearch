import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ApiModule } from '../../../src/api/api.module';
import { IndexModule } from '../../../src/index/index.module';
import { TestDatabaseModule } from '../../utils/test-database.module';
import { RocksDBService } from '../../../src/storage/rocksdb/rocksdb.service';
import { setupTestApp } from '../../utils/test-helpers';

describe('IndexController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp([TestDatabaseModule, IndexModule, ApiModule]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/indices', () => {
    it('should create an index', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices')
        .send({
          name: 'test-index',
          settings: {
            numberOfShards: 1,
            refreshInterval: '1s',
          },
          mappings: {
            properties: {
              title: {
                type: 'text',
                analyzer: 'standard',
              },
              content: {
                type: 'text',
                analyzer: 'standard',
              },
              tags: {
                type: 'keyword',
              },
            },
          },
        })
        .expect(201);

      expect(res.body.name).toBe('test-index');
      expect(res.body.status).toBe('open');
      expect(res.body.settings.numberOfShards).toBe(1);
      expect(res.body.mappings.properties.title.type).toBe('text');
    });

    it('should not allow duplicate index names', async () => {
      // Create once
      await request(app.getHttpServer())
        .post('/api/indices')
        .send({ name: 'duplicate-index' })
        .expect(201);

      // Try to create again
      const res = await request(app.getHttpServer())
        .post('/api/indices')
        .send({ name: 'duplicate-index' })
        .expect(409);

      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should return 400 for invalid payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices')
        .send({}) // missing name
        .expect(400);

      expect(res.body.message).toBeDefined();
    });
  });

  describe('GET /api/indices', () => {
    beforeAll(async () => {
      // Ensure at least two indices exist
      await request(app.getHttpServer()).post('/api/indices').send({ name: 'list-index-1' });
      await request(app.getHttpServer()).post('/api/indices').send({ name: 'list-index-2' });
    });

    it('should list all indices', async () => {
      const res = await request(app.getHttpServer()).get('/api/indices').expect(200);

      expect(Array.isArray(res.body.indices)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      const names = res.body.indices.map((i: any) => i.name);
      expect(names).toEqual(expect.arrayContaining(['list-index-1', 'list-index-2']));
    });
  });

  describe('GET /api/indices/:name', () => {
    it('should get index details', async () => {
      await request(app.getHttpServer()).post('/api/indices').send({ name: 'details-index' });
      const res = await request(app.getHttpServer()).get('/api/indices/details-index').expect(200);

      expect(res.body.name).toBe('details-index');
      expect(res.body.status).toBe('open');
    });

    it('should return 404 for non-existent index', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/indices/non-existent-index')
        .expect(404);

      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('PUT /api/indices/:name/settings', () => {
    beforeAll(async () => {
      await request(app.getHttpServer()).post('/api/indices').send({ name: 'settings-index' });
    });

    it('should update index settings', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/indices/settings-index/settings')
        .send({ settings: { refreshInterval: '10s' } })
        .expect(200);

      expect(res.body.name).toBe('settings-index');
      expect(res.body.settings.refreshInterval).toBe('10s');
    });

    it('should return 404 for non-existent index', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/indices/does-not-exist/settings')
        .send({ settings: { refreshInterval: '5s' } })
        .expect(404);

      expect(res.body.message).toMatch(/not found/i);
    });

    it('should return 400 for invalid settings payload', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/indices/settings-index/settings')
        .send({}) // missing settings
        .expect(400);

      expect(res.body.message).toBeDefined();
    });

    it('should persist updated settings on subsequent GET', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/indices/settings-index')
        .expect(200);
      expect(getRes.body.settings?.refreshInterval).toBe('10s');
    });
  });

  describe('PUT /api/indices/:indexName/mappings', () => {
    const mappingsIndexName = 'mappings-update-index';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/indices')
        .send({
          name: mappingsIndexName,
          settings: { numberOfShards: 1, refreshInterval: '1s' },
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard', boost: 1.0 },
              body: { type: 'text', analyzer: 'standard' },
            },
          },
        });
    });

    it('should update mappings and return 200', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/indices/${mappingsIndexName}/mappings`)
        .send({
          properties: {
            title: { type: 'text', analyzer: 'standard', boost: 2.5 },
            body: { type: 'text', analyzer: 'standard', boost: 1.0 },
            tags: { type: 'keyword' },
          },
        })
        .expect(200);

      expect(res.body.name).toBe(mappingsIndexName);
      expect(res.body.mappings?.properties?.title?.boost).toBe(2.5);
      expect(res.body.mappings?.properties?.body?.boost).toBe(1.0);
      expect(res.body.mappings?.properties?.tags?.type).toBe('keyword');
    });

    it('should persist updated mappings on subsequent GET', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/indices/${mappingsIndexName}`)
        .expect(200);
      expect(getRes.body.mappings?.properties?.title?.boost).toBe(2.5);
      expect(getRes.body.mappings?.properties?.tags?.type).toBe('keyword');
    });

    it('should return 404 when updating mappings for non-existent index', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/indices/non-existent-mappings-index/mappings')
        .send({
          properties: {
            title: { type: 'text' },
          },
        })
        .expect(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('GET /api/indices/:name with mappings boost', () => {
    it('should return index with boost values when created with mappings', async () => {
      const indexName = 'index-with-boost';
      await request(app.getHttpServer())
        .post('/api/indices')
        .send({
          name: indexName,
          settings: { numberOfShards: 1, refreshInterval: '1s' },
          mappings: {
            properties: {
              name: { type: 'text', boost: 3.0 },
              description: { type: 'text', boost: 1.0 },
            },
          },
        })
        .expect(201);

      const getRes = await request(app.getHttpServer())
        .get(`/api/indices/${indexName}`)
        .expect(200);
      expect(getRes.body.mappings?.properties?.name?.boost).toBe(3.0);
      expect(getRes.body.mappings?.properties?.description?.boost).toBe(1.0);
    });
  });

  describe('DELETE /api/indices/:name', () => {
    beforeAll(async () => {
      await request(app.getHttpServer()).post('/api/indices').send({ name: 'delete-index' });
    });

    it('should delete an index', async () => {
      await request(app.getHttpServer()).delete('/api/indices/delete-index').expect(204);

      // Should not be found after deletion
      await request(app.getHttpServer()).get('/api/indices/delete-index').expect(404);
    });

    it('should return 404 when deleting non-existent index', async () => {
      await request(app.getHttpServer()).delete('/api/indices/never-existed').expect(404);
    });
  });
});
