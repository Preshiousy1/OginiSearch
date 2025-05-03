import { Test, TestingModule } from '@nestjs/testing';
import { IndexService } from './index.service';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { CreateIndexDto } from '../api/dtos/index.dto';

describe('IndexService', () => {
  let service: IndexService;
  let indexStorageService: Partial<IndexStorageService>;
  let analyzerRegistryService: Partial<AnalyzerRegistryService>;

  beforeEach(async () => {
    // Create mock for IndexStorageService
    indexStorageService = {
      createIndex: jest.fn().mockImplementation(index => ({
        ...index,
        createdAt: new Date(),
        documentCount: 0,
        status: 'open',
      })),
      getIndex: jest.fn().mockImplementation(name => {
        if (name === 'existing-index') {
          return {
            name,
            createdAt: new Date(),
            documentCount: 5,
            settings: {},
            mappings: { properties: {} },
            status: 'open',
          };
        }
        return null;
      }),
      listIndices: jest.fn().mockResolvedValue([
        {
          name: 'index-1',
          createdAt: new Date(),
          documentCount: 10,
          settings: {},
          mappings: { properties: {} },
          status: 'open',
        },
        {
          name: 'index-2',
          createdAt: new Date(),
          documentCount: 5,
          settings: {},
          mappings: { properties: {} },
          status: 'open',
        },
      ]),
      updateIndex: jest.fn().mockImplementation((name, update) => ({
        name,
        createdAt: new Date(),
        documentCount: 5,
        settings: update.settings || {},
        mappings: { properties: {} },
        status: 'open',
      })),
      deleteIndex: jest.fn().mockResolvedValue(true),
    };

    // Create mock for AnalyzerRegistryService
    analyzerRegistryService = {
      getAnalyzer: jest.fn().mockReturnValue({
        analyze: jest.fn(),
        getName: jest.fn().mockReturnValue('standard'),
        getTokenizer: jest.fn(),
        getFilters: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexService,
        {
          provide: IndexStorageService,
          useValue: indexStorageService,
        },
        {
          provide: AnalyzerRegistryService,
          useValue: analyzerRegistryService,
        },
      ],
    }).compile();

    service = module.get<IndexService>(IndexService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createIndex', () => {
    it('should create a new index', async () => {
      const createIndexDto: CreateIndexDto = {
        name: 'test-index',
        settings: { numberOfShards: 1 },
        mappings: {
          properties: {
            title: { type: 'text', analyzer: 'standard' },
          },
        },
      };

      const result = await service.createIndex(createIndexDto);

      expect(result).toBeDefined();
      expect(result.name).toBe('test-index');
      expect(result.status).toBe('open');
      expect(indexStorageService.createIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          name: createIndexDto.name,
          settings: createIndexDto.settings,
          mappings: createIndexDto.mappings,
        }),
      );
      expect(analyzerRegistryService.getAnalyzer).toHaveBeenCalledWith('standard');
    });

    it('should throw ConflictException if index already exists', async () => {
      const createIndexDto: CreateIndexDto = {
        name: 'existing-index',
      };

      await expect(service.createIndex(createIndexDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('listIndices', () => {
    it('should return a list of indices', async () => {
      const result = await service.listIndices();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('index-1');
      expect(result[1].name).toBe('index-2');
      expect(indexStorageService.listIndices).toHaveBeenCalled();
    });
  });

  describe('getIndex', () => {
    it('should return an index by name', async () => {
      const result = await service.getIndex('existing-index');

      expect(result).toBeDefined();
      expect(result.name).toBe('existing-index');
      expect(indexStorageService.getIndex).toHaveBeenCalledWith('existing-index');
    });

    it('should throw NotFoundException if index not found', async () => {
      await expect(service.getIndex('non-existent-index')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateIndexSettings', () => {
    it('should update index settings', async () => {
      const settings = { refreshInterval: '5s' };
      const result = await service.updateIndexSettings('existing-index', settings);

      expect(result).toBeDefined();
      expect(result.name).toBe('existing-index');
      expect(indexStorageService.updateIndex).toHaveBeenCalledWith('existing-index', { settings });
    });

    it('should throw NotFoundException if index not found', async () => {
      await expect(service.updateIndexSettings('non-existent-index', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteIndex', () => {
    it('should delete an index', async () => {
      await service.deleteIndex('existing-index');
      expect(indexStorageService.deleteIndex).toHaveBeenCalledWith('existing-index');
    });

    it('should throw NotFoundException if index not found', async () => {
      await expect(service.deleteIndex('non-existent-index')).rejects.toThrow(NotFoundException);
    });
  });
});
