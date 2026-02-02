import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ApiModule } from '../../../src/api/api.module';
import { IndexModule } from '../../../src/index/index.module';
import { DocumentModule } from '../../../src/document/document.module';
import { TestDatabaseModule } from '../../utils/test-database.module';
import { setupTestApp } from '../../utils/test-helpers';

describe('DocumentController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupTestApp([TestDatabaseModule, IndexModule, DocumentModule, ApiModule]);
    // Create an index for document tests
    await request(app.getHttpServer())
      .post('/api/indices')
      .send({
        name: 'doc-index',
        settings: { numberOfShards: 1, refreshInterval: '1s' },
        mappings: { properties: { title: { type: 'text' } } },
      });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /api/indices/:index/documents', () => {
    it('should index a document', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'Test Doc' } })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.source.title).toBe('Test Doc');
    });

    it('should return 404 for non-existent index', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/does-not-exist/documents')
        .send({ document: { title: 'Test Doc' } })
        .expect(404);
    });

    it('should return 400 for invalid payload', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/indices/:index/documents/_bulk', () => {
    it('should bulk index documents', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents/_bulk')
        .send({
          documents: [{ document: { title: 'Bulk 1' } }, { document: { title: 'Bulk 2' } }],
        })
        .expect(201);

      expect(res.body.items.length).toBe(2);
    });

    it('should return 400 for invalid bulk payload', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents/_bulk')
        .send({})
        .expect(400);
    });

    it('should return 404 for non-existent index', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/does-not-exist/documents/_bulk')
        .send({ documents: [{ document: { title: 'Bulk 1' } }] })
        .expect(404);
    });
  });

  describe('GET /api/indices/:index/documents/:id', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'Get Doc' } });
      docId = res.body.id;
    });

    it('should get a document by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/indices/doc-index/documents/${docId}`)
        .expect(200);

      expect(res.body.id).toBe(docId);
      expect(res.body.source.title).toBe('Get Doc');
    });

    it('should return 404 for non-existent document', async () => {
      await request(app.getHttpServer())
        .get('/api/indices/doc-index/documents/non-existent-id')
        .expect(404);
    });

    it('should return 404 for non-existent index', async () => {
      await request(app.getHttpServer())
        .get('/api/indices/does-not-exist/documents/some-id')
        .expect(404);
    });
  });

  describe('PUT /api/indices/:index/documents/:id', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'Update Me' } });
      docId = res.body.id;
    });

    it('should update a document', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/indices/doc-index/documents/${docId}`)
        .send({ document: { title: 'Updated Title' } })
        .expect(200);

      expect(res.body.source.title).toBe('Updated Title');
    });

    it('should return 404 for non-existent document', async () => {
      await request(app.getHttpServer())
        .put('/api/indices/doc-index/documents/non-existent-id')
        .send({ document: { title: 'Nope' } })
        .expect(404);
    });

    it('should return 400 for invalid payload', async () => {
      await request(app.getHttpServer())
        .put(`/api/indices/doc-index/documents/${docId}`)
        .send({})
        .expect(400);
    });
  });

  describe('DELETE /api/indices/:index/documents/:id', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'Delete Me' } });
      docId = res.body.id;
    });

    it('should delete a document', async () => {
      await request(app.getHttpServer())
        .delete(`/api/indices/doc-index/documents/${docId}`)
        .expect(204);

      // Should not be found after deletion
      await request(app.getHttpServer())
        .get(`/api/indices/doc-index/documents/${docId}`)
        .expect(404);
    });

    it('should return 404 for non-existent document', async () => {
      await request(app.getHttpServer())
        .delete('/api/indices/doc-index/documents/non-existent-id')
        .expect(404);
    });
  });

  describe('POST /api/indices/:index/documents/_delete_by_query', () => {
    beforeAll(async () => {
      // Add some docs to delete
      const res1 = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'DeleteByQuery1', tag: 'gamma' } });

      const res2 = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents')
        .send({ document: { title: 'DeleteByQuery2', tag: 'gamma' } });
    });

    it('should delete documents by query', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents/_delete_by_query')
        .send({
          query: { term: { field: 'title', value: 'DeleteByQuery1' } },
          fields: ['title'],
          filter: { tag: 'gamma' },
        })
        .expect(201);

      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for invalid query', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/doc-index/documents/_delete_by_query')
        .send({})
        .expect(400);
    });

    it('should return 404 for non-existent index', async () => {
      await request(app.getHttpServer())
        .post('/api/indices/does-not-exist/documents/_delete_by_query')
        .send({
          query: { term: { field: 'title', value: 'DeleteByQuery1' } },
          fields: ['title'],
          filter: { tag: 'gamma' },
        })
        .expect(404);
    });
  });
});
