import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { setupTestApp } from '../../utils/test-helpers';
import { DocumentGenerator } from '../../utils/document-generator';
import { QueryGenerator } from '../../utils/query-generator';
import { TestCorpusLoader } from '../../utils/test-corpus-loader';
import { Ogini } from '../../../packages/client/src';

describe('Search Integration Tests', () => {
  let app: INestApplication;
  let client: Ogini;
  let testIndexName: string;
  let testCorpus: string;

  beforeAll(async () => {
    // Setup test app
    app = await setupTestApp([AppModule]);
    await app.listen(3456);

    // Initialize client
    client = new Ogini({
      baseURL: 'http://localhost:3456',
    });

    // Create a unique test index name
    testIndexName = `test-index-${Date.now()}`;

    // Create test corpus
    testCorpus = 'search-test-corpus';
    TestCorpusLoader.createCorpus(testCorpus, 10, {
      description: 'Test corpus for search integration tests',
      metadata: {
        category: 'test',
        createdAt: new Date().toISOString(),
      },
    });

    // Create index
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
          metadata: {
            type: 'object',
            properties: {
              createdAt: { type: 'date' },
              author: { type: 'keyword' },
              category: { type: 'keyword' },
            },
          },
        },
      },
    });

    // Load test corpus and index documents
    const corpus = TestCorpusLoader.loadCorpus(testCorpus);
    await client.documents.bulkIndexDocuments(
      testIndexName,
      corpus.documents.map(doc => ({ document: doc })),
    );
  }, 30000);

  afterAll(async () => {
    // Clean up
    try {
      await client.indices.deleteIndex(testIndexName);
    } catch (e) {
      // Ignore errors on cleanup
    }
    await app.close();
  });

  describe('Document Search', () => {
    it('should find documents using match query', async () => {
      // Generate a match query
      const query = QueryGenerator.generateMatchQuery('content', 'test');
      const response = await client.search.search(testIndexName, query);

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(response.data.total).toBeGreaterThan(0);
    });

    it('should find documents using multi-match query', async () => {
      // Generate a multi-match query
      const query = QueryGenerator.generateMultiMatchQuery(['title', 'content'], 'test');
      const response = await client.search.search(testIndexName, query);

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(response.data.total).toBeGreaterThan(0);
    });

    it('should find documents using term query', async () => {
      // Generate a term query for tags
      const query = QueryGenerator.generateTermQuery('tags', 'test');
      const response = await client.search.search(testIndexName, query);

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(response.data.total).toBeGreaterThan(0);
    });

    it('should find documents using bool query', async () => {
      // Generate a bool query
      const query = QueryGenerator.generateBoolQuery();
      const response = await client.search.search(testIndexName, query);

      expect(response.data.hits.length).toBeGreaterThan(0);
      expect(response.data.total).toBeGreaterThan(0);
    });
  });

  describe('Document Generation', () => {
    it('should generate and index a single document', async () => {
      // Generate a single document
      const document = DocumentGenerator.generateDocument({
        title: 'Test Document',
        content: 'This is a test document for search testing.',
        tags: ['test', 'search'],
      });

      // Index the document
      const response = await client.documents.indexDocument(testIndexName, document);

      expect(response.id).toBeDefined();
      expect(response.index).toBe(testIndexName);
      expect(response.found).toBe(true);
    });

    it('should generate and index multiple documents', async () => {
      // Generate multiple documents
      const documents = DocumentGenerator.generateDocuments(5, {
        tags: ['bulk', 'test'],
      });

      // Index the documents
      const response = await client.documents.bulkIndexDocuments(
        testIndexName,
        documents.map(doc => ({ document: doc })),
      );

      expect(response.items.length).toBe(5);
      expect(response.errors).toBe(false);
    });

    it('should generate and index searchable documents', async () => {
      // Generate a document with specific keywords
      const keywords = ['typescript', 'nodejs', 'testing'];
      const document = DocumentGenerator.generateSearchableDocument(keywords);

      // Index the document
      const response = await client.documents.indexDocument(testIndexName, document);

      // Search for the document using one of the keywords
      const query = QueryGenerator.generateMatchQuery('content', keywords[0]);
      const searchResponse = await client.search.search(testIndexName, query);

      expect(response.id).toBeDefined();
      expect(searchResponse.data.hits.length).toBeGreaterThan(0);
      expect(searchResponse.data.hits[0].source.content).toContain(keywords[0]);
    });
  });

  describe('Test Corpus Management', () => {
    it('should list available test corpora', () => {
      const corpora = TestCorpusLoader.listCorpora();
      expect(corpora).toContain(testCorpus);
    });

    it('should load and use a test corpus', async () => {
      // Load the test corpus
      const corpus = TestCorpusLoader.loadCorpus(testCorpus);

      // Verify corpus contents
      expect(corpus.name).toBe(testCorpus);
      expect(corpus.documents.length).toBe(10);
      expect(corpus.description).toBe('Test corpus for search integration tests');

      // Search for documents from the corpus
      const query = QueryGenerator.generateMatchQuery(
        'content',
        corpus.documents[0].content.split(' ')[0],
      );
      const response = await client.search.search(testIndexName, query);

      expect(response.data.hits.length).toBeGreaterThan(0);
    });
  });
});
