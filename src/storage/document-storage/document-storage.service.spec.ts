import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DocumentStorageService } from './document-storage.service';
import { DocumentRepository } from '../mongodb/repositories/document.repository';
import { SourceDocument, SourceDocumentSchema } from '../mongodb/schemas/document.schema';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RocksDBService } from '../rocksdb/rocksdb.service';
import { SchemaVersionManagerService } from '../../schema/schema-version-manager.service';

describe('DocumentStorageService', () => {
  let service: DocumentStorageService;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    // Start an in-memory MongoDB instance
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();

    // Create mock for RocksDBService
    const mockRocksDBService = {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      getByPrefix: jest.fn().mockResolvedValue([]),
    };

    // Create mock for SchemaVersionManagerService
    const mockSchemaVersionManager = {
      validateDocument: jest.fn().mockResolvedValue({ valid: true }),
      getSchema: jest.fn().mockResolvedValue({ name: 'test', version: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        // Add ConfigModule with a factory to provide the values needed by RocksDBService
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([{ name: SourceDocument.name, schema: SourceDocumentSchema }]),
      ],
      providers: [
        DocumentStorageService,
        DocumentRepository,
        {
          provide: RocksDBService,
          useValue: mockRocksDBService,
        },
        {
          provide: SchemaVersionManagerService,
          useValue: mockSchemaVersionManager,
        },
      ],
    }).compile();

    service = module.get<DocumentStorageService>(DocumentStorageService);
  });

  afterAll(async () => {
    if (mongod) {
      await mongod.stop();
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('CRUD operations', () => {
    const indexName = 'test-index';
    const documentId = 'doc123';
    const documentContent = { title: 'Test Document', body: 'This is a test' };
    const metadata = { author: 'Test User', createdAt: new Date().toISOString() };

    it('should store a document', async () => {
      const result = await service.storeDocument(indexName, documentId, documentContent, metadata);

      expect(result).toBeDefined();
      expect(result.indexName).toBe(indexName);
      expect(result.documentId).toBe(documentId);
      expect(result.content).toEqual(documentContent);
      expect(result.metadata).toEqual(metadata);
    });

    it('should retrieve a stored document', async () => {
      const result = await service.getDocument(indexName, documentId);

      expect(result).toBeDefined();
      expect(result.indexName).toBe(indexName);
      expect(result.documentId).toBe(documentId);
      expect(result.content).toEqual(documentContent);
      expect(result.metadata).toEqual(metadata);
    });

    it('should update a document', async () => {
      const updatedContent = {
        ...documentContent,
        title: 'Updated Title',
      };

      const updatedMetadata = {
        ...metadata,
        updatedAt: new Date().toISOString(),
      };

      const result = await service.updateDocument(
        indexName,
        documentId,
        updatedContent,
        updatedMetadata,
      );

      expect(result).toBeDefined();
      expect(result.content).toEqual(updatedContent);
      expect(result.metadata).toEqual(updatedMetadata);

      // Verify the update by fetching the document
      const fetched = await service.getDocument(indexName, documentId);
      expect(fetched.content).toEqual(updatedContent);
      expect(fetched.metadata).toEqual(updatedMetadata);
    });

    it('should delete a document', async () => {
      const result = await service.deleteDocument(indexName, documentId);

      expect(result).toBe(true);

      // Verify the document is deleted
      const fetched = await service.getDocument(indexName, documentId);
      expect(fetched).toBeNull();
    });
  });

  describe('Bulk operations', () => {
    const indexName = 'bulk-test-index';
    const documents = [
      {
        id: 'bulk1',
        content: { title: 'Bulk 1', body: 'Bulk test 1' },
        metadata: { tag: 'test' },
      },
      {
        id: 'bulk2',
        content: { title: 'Bulk 2', body: 'Bulk test 2' },
        metadata: { tag: 'test' },
      },
      {
        id: 'bulk3',
        content: { title: 'Bulk 3', body: 'Bulk test 3' },
        metadata: { tag: 'test' },
      },
    ];

    beforeEach(async () => {
      // Clean up any existing documents
      await service.deleteAllDocumentsInIndex(indexName);
    });

    it('should bulk store documents', async () => {
      const result = await service.bulkStoreDocuments(indexName, documents);

      expect(result).toBe(documents.length);

      // Verify all documents are stored
      const fetched = await service.getDocuments(indexName);
      expect(fetched.total).toBe(documents.length);
      expect(fetched.documents.length).toBe(documents.length);
    });

    it('should retrieve multiple documents', async () => {
      // Store documents first
      await service.bulkStoreDocuments(indexName, documents);

      // Test pagination
      const page1 = await service.getDocuments(indexName, { limit: 2, offset: 0 });
      expect(page1.total).toBe(documents.length);
      expect(page1.documents.length).toBe(2);

      const page2 = await service.getDocuments(indexName, { limit: 2, offset: 2 });
      expect(page2.total).toBe(documents.length);
      expect(page2.documents.length).toBe(1);
    });

    it('should bulk delete documents', async () => {
      // Store documents first
      await service.bulkStoreDocuments(indexName, documents);

      // Delete the first two documents
      const docsToDelete = documents.slice(0, 2).map(d => d.id);
      const deleteResult = await service.bulkDeleteDocuments(indexName, docsToDelete);

      expect(deleteResult).toBe(2);

      // Verify the remaining document
      const remaining = await service.getDocuments(indexName);
      expect(remaining.total).toBe(1);
      expect(remaining.documents[0].documentId).toBe(documents[2].id);
    });

    it('should delete all documents in an index', async () => {
      // Store documents first
      await service.bulkStoreDocuments(indexName, documents);

      // Delete all documents
      const deleteResult = await service.deleteAllDocumentsInIndex(indexName);

      expect(deleteResult).toBe(documents.length);

      // Verify no documents remain
      const remaining = await service.getDocuments(indexName);
      expect(remaining.total).toBe(0);
      expect(remaining.documents.length).toBe(0);
    });
  });
});
