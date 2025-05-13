import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { setupTestApp } from '../../utils/test-helpers';
import { DocumentGenerator } from '../../utils/document-generator';
import { QueryGenerator } from '../../utils/query-generator';
import { TestCorpusLoader } from '../../utils/test-corpus-loader';
import { Ogini } from '../../../packages/client/src';
import { faker } from '@faker-js/faker';

describe('Search Integration Tests', () => {
  let app: INestApplication;
  let client: Ogini;
  let testIndexName: string;
  let testCorpus: string;

  beforeAll(async () => {
    // Setup test app
    app = await setupTestApp([AppModule]);
    const port = 3457;
    await app.listen(port);

    // Initialize client
    client = new Ogini({
      baseURL: `http://localhost:${port}`,
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
      documentGenerator: () =>
        DocumentGenerator.generateDocument({
          content: `This is a test document containing test-related content for testing search functionality. ${faker.lorem.paragraph()}`,
          tags: ['test', ...Array.from({ length: 2 }, () => faker.word.sample())],
        }),
    });

    // Create index
    await client.indices.createIndex({
      name: testIndexName,
      settings: {
        numberOfShards: 1,
        refreshInterval: '1s',
        analysis: {
          analyzer: {
            default: {
              type: 'standard',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop'],
            },
          },
          normalizer: {
            lowercase: {
              type: 'custom',
              filter: ['lowercase'],
            },
          },
        },
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
            normalizer: 'lowercase',
          },
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
    await Promise.all(
      corpus.documents.map(doc => client.documents.indexDocument(testIndexName, { document: doc })),
    );
    // Verify index
    await client.indices.getIndex(testIndexName);
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
      const doc = DocumentGenerator.generateDocument({
        title: 'Test Document',
        content: 'This is a test document for search testing.',
        tags: ['test', 'search'],
      });

      // Index the document
      const response = await client.documents.indexDocument(testIndexName, { document: doc });

      expect(response.id).toBeDefined();
      expect(response.version).toBeGreaterThan(0);
    });

    it('should generate and index multiple documents', async () => {
      // Generate multiple documents
      const documents = DocumentGenerator.generateDocuments(5, {
        tags: ['bulk', 'test'],
      });

      // Index the documents
      await Promise.all(
        documents.map(doc => client.documents.indexDocument(testIndexName, { document: doc })),
      );
    });

    it('should generate and index searchable documents', async () => {
      // Generate a document with specific keywords
      const keywords = ['typescript', 'nodejs', 'testing'];
      const doc = DocumentGenerator.generateSearchableDocument(keywords);

      // Index the document
      const response = await client.documents.indexDocument(testIndexName, { document: doc });

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
