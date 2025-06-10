/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from './document.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexService } from '../index/index.service';
import { IndexingService } from '../indexing/indexing.service';
import { SearchService } from '../search/search.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { IndexDocumentDto } from '../api/dtos/document.dto';
import { InMemoryTermDictionary } from '../index/term-dictionary';

describe('DocumentService', () => {
  let service: DocumentService;
  let documentStorageService: Partial<DocumentStorageService>;
  let indexService: Partial<IndexService>;
  let indexingService: Partial<IndexingService>;
  let searchService: Partial<SearchService>;

  beforeEach(async () => {
    // Mock for IndexService
    indexService = {
      getIndex: jest.fn().mockImplementation((name: string) => {
        if (name === 'test-index') {
          return {
            name,
            createdAt: new Date(),
            documentCount: 10,
            settings: {},
            mappings: { properties: {} },
            status: 'open',
          };
        }
        throw new NotFoundException(`Index ${name} not found`);
      }),
      updateMappings: jest.fn().mockResolvedValue(true),
    };

    // Mock for DocumentStorageService
    documentStorageService = {
      storeDocument: jest.fn().mockImplementation((indexName: string, doc: any) => ({
        ...doc,
        version: 1,
      })),
      getDocument: jest.fn().mockImplementation((indexName: string, id: string) => {
        if (id === 'existing-doc') {
          return {
            id,
            content: { title: 'Test Document' },
            metadata: {},
          };
        }
        return null;
      }),
      deleteDocument: jest.fn().mockImplementation((indexName: string, id: string) => {
        return id === 'existing-doc';
      }),
      bulkStoreDocuments: jest.fn().mockResolvedValue(3),
      bulkDeleteDocuments: jest.fn().mockResolvedValue(2),
      getDocuments: jest.fn().mockImplementation((indexName: string, options: any) => {
        if (options.filter && options.filter.title === 'Test Document') {
          return {
            documents: [
              { documentId: 'doc1', content: { title: 'Test Document' } },
              { documentId: 'doc2', content: { title: 'Test Document' } },
            ],
          };
        }
        return { documents: [] };
      }),
    };

    // Mock for IndexingService
    indexingService = {
      indexDocument: jest.fn().mockResolvedValue(true),
      removeDocument: jest.fn().mockResolvedValue(true),
    };

    // Mock for SearchService
    searchService = {
      search: jest.fn().mockResolvedValue({
        data: {
          total: 2,
          maxScore: 1.0,
          hits: [
            { id: 'doc1', score: 1.0 },
            { id: 'doc2', score: 0.5 },
          ],
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        {
          provide: DocumentStorageService,
          useValue: documentStorageService,
        },
        {
          provide: IndexService,
          useValue: indexService,
        },
        {
          provide: IndexingService,
          useValue: indexingService,
        },
        {
          provide: SearchService,
          useValue: searchService,
        },
        {
          provide: 'TERM_DICTIONARY',
          useValue: new InMemoryTermDictionary(),
        },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('indexDocument', () => {
    it('should index a document', async () => {
      const documentDto: IndexDocumentDto = {
        id: 'test-doc',
        document: { title: 'Test Document' },
      };

      const result = await service.indexDocument('test-index', documentDto);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-doc');
      expect(result.index).toBe('test-index');
      expect(result.found).toBe(true);
      expect(documentStorageService.storeDocument).toHaveBeenCalled();
      expect(indexingService.indexDocument).toHaveBeenCalled();
    });

    it('should generate an ID if not provided', async () => {
      const documentDto: IndexDocumentDto = {
        document: { title: 'Test Document' },
      };

      const result = await service.indexDocument('test-index', documentDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.index).toBe('test-index');
    });

    it('should throw if index does not exist', async () => {
      const documentDto: IndexDocumentDto = {
        document: { title: 'Test Document' },
      };

      await expect(service.indexDocument('non-existent-index', documentDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDocument', () => {
    it('should retrieve a document', async () => {
      const result = await service.getDocument('test-index', 'existing-doc');

      expect(result).toBeDefined();
      expect(result.id).toBe('existing-doc');
      expect(result.index).toBe('test-index');
      expect(result.found).toBe(true);
    });

    it('should throw if document does not exist', async () => {
      await expect(service.getDocument('test-index', 'non-existent-doc')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkIndexDocuments', () => {
    it('should bulk index documents', async () => {
      const documents: IndexDocumentDto[] = [
        { id: 'doc1', document: { title: 'Doc 1' } },
        { id: 'doc2', document: { title: 'Doc 2' } },
        { id: 'doc3', document: { title: 'Doc 3' } },
      ];

      const result = await service.bulkIndexDocuments('test-index', documents);

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(3);
      expect(result.errors).toBe(false);
      expect(documentStorageService.storeDocument).toHaveBeenCalledTimes(3);
      expect(indexingService.indexDocument).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteByQuery', () => {
    it('should delete documents matching a query', async () => {
      const result = await service.deleteByQuery('test-index', {
        query: { term: { field: 'title', value: 'Test Document' } },
      });

      expect(result).toBeDefined();
      expect(result.deleted).toBe(2);
      expect(documentStorageService.getDocuments).toHaveBeenCalledWith('test-index', {
        filter: { title: 'Test Document' },
      });
      expect(documentStorageService.bulkDeleteDocuments).toHaveBeenCalledWith('test-index', [
        'doc1',
        'doc2',
      ]);
    });
  });
});
