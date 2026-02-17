// import { Ogini } from '@oginisearch/client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { setupTestApp } from '../../utils/test-helpers';
import { v4 as uuidv4 } from 'uuid';
import { Ogini } from '../../../packages/client/src';

/**
 * Integration tests for the Ogini client
 *
 * These tests will use a real running instance of the API to verify
 * that the client library works correctly.
 */
describe('Ogini Client Integration Tests', () => {
  let app: INestApplication;
  let client: Ogini;
  let testIndexName: string;

  beforeAll(async () => {
    // Setup test app
    app = await setupTestApp([AppModule]);

    // Start the server on a specific port
    const port = 3456;
    await app.listen(port);

    // Initialize client with the fixed port
    client = new Ogini({
      baseURL: `http://localhost:${port}`,
    });

    // Create a unique test index name
    testIndexName = `test-index-${uuidv4().substring(0, 8)}`;

    // Create the index for testing
    await client.indices.createIndex({
      name: testIndexName,
      settings: {
        numberOfShards: 1,
        refreshInterval: '1s',
      },
      mappings: {
        properties: {
          title: { type: 'text' },
          content: { type: 'text' },
          tags: { type: 'keyword' },
        },
      },
    });
  }, 30000); // Increase timeout for setup

  afterAll(async () => {
    // Clean up - delete test index if it exists
    try {
      await client.indices.deleteIndex(testIndexName);
    } catch (e) {
      // Ignore errors on cleanup
    }
    await app.close();
  });

  describe('Index Management', () => {
    it('should list indices including the test index', async () => {
      const response = await client.indices.listIndices();

      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);

      const foundIndex = response.data.find((index: { name: string }) => index.name === testIndexName);
      expect(foundIndex).toBeDefined();
      expect(foundIndex.status).toBe('open');
    });

    it('should get index details', async () => {
      const response = await client.indices.getIndex(testIndexName);

      expect(response.name).toBe(testIndexName);
      expect(response.status).toBe('open');
      expect(response.mappings).toBeDefined();
      expect(response.settings).toBeDefined();
    });
  });

  describe('Document Management', () => {
    let documentId: string;

    it('should index a document', async () => {
      const doc = {
        title: 'Test Document',
        content: 'This is a test document for integration testing.',
        tags: ['test', 'integration'],
      };

      const response = await client.documents.indexDocument(testIndexName, { document: doc });

      expect(response.id).toBeDefined();
      expect(response.version).toBeGreaterThan(0);

      // Save document ID for later tests
      documentId = response.id;
    });

    it('should get a document by ID', async () => {
      const response = await client.documents.getDocument(testIndexName, documentId);

      expect(response.id).toBe(documentId);
      expect(response.source).toMatchObject({
        title: 'Test Document',
        tags: expect.arrayContaining(['test']),
      });
    });

    it('should update a document', async () => {
      const doc = {
        title: 'Updated Document',
        content: 'This document has been updated.',
        tags: ['test', 'updated'],
      };

      const response = await client.documents.indexDocument(testIndexName, {
        id: documentId,
        document: doc,
      });

      expect(response.id).toBe(documentId);
      expect(response.version).toBeGreaterThan(0);

      // Verify update
      const updated = await client.documents.getDocument(testIndexName, documentId);
      expect(updated.source).toMatchObject({
        title: 'Updated Document',
        tags: expect.arrayContaining(['updated']),
      });
    });

    it('should delete a document', async () => {
      await client.documents.deleteDocument(testIndexName, documentId);

      // Try to get the deleted document - should throw an error
      await expect(client.documents.getDocument(testIndexName, documentId)).rejects.toThrow();
    });
  });

  describe('Search', () => {
    beforeAll(async () => {
      // Add some documents for search testing
      const docs = [
        {
          title: 'JavaScript Basics',
          content: 'Learn the basics of JavaScript programming.',
          tags: ['javascript', 'programming'],
        },
        {
          title: 'Advanced TypeScript',
          content: 'Explore advanced TypeScript concepts and patterns.',
          tags: ['typescript', 'programming'],
        },
        {
          title: 'Node.js Development',
          content: 'Building server-side applications with Node.js and TypeScript.',
          tags: ['nodejs', 'javascript', 'programming'],
        },
      ];

      await Promise.all(
        docs.map(doc => client.documents.indexDocument(testIndexName, { document: doc })),
      );
    });

    it('should search documents with a match query', async () => {
      const response = await client.search.search(
        testIndexName,
        client.search.createMatchQuery('title', 'typescript'),
      );

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(response.data.hits[0].source.title).toContain('TypeScript');
    });

    it('should search across multiple fields', async () => {
      const response = await client.search.search(
        testIndexName,
        client.search.createMultiFieldQuery('javascript', ['title', 'content']),
      );

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(
        response.data.hits.some(
          hit =>
            hit.source.title.includes('JavaScript') || hit.source.content.includes('JavaScript'),
        ),
      ).toBe(true);
    });
  });
});
