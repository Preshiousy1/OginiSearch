import { Test, TestingModule } from '@nestjs/testing';
import { SchemaVersionManagerService } from './schema-version-manager.service';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';
import { Schema } from './interfaces/schema.interface';

describe('SchemaVersionManagerService', () => {
  let service: SchemaVersionManagerService;
  let rocksDBServiceMock: Partial<RocksDBService>;

  const mockSchema: Omit<Schema, 'created' | 'version'> = {
    name: 'product',
    fields: [
      {
        name: 'name',
        type: 'string',
        required: true,
        searchable: true,
        boost: 2.0,
      },
      {
        name: 'price',
        type: 'number',
        required: true,
        filterable: true,
      },
      {
        name: 'description',
        type: 'string',
        required: false,
        searchable: true,
      },
    ],
  };

  beforeEach(async () => {
    // Create a mock for RocksDBService
    const schemaStore = new Map<string, any>();

    rocksDBServiceMock = {
      put: jest.fn((key: string, value: any) => {
        schemaStore.set(key, value);
        return Promise.resolve();
      }),
      get: jest.fn((key: string) => {
        return Promise.resolve(schemaStore.get(key) || null);
      }),
      getByPrefix: jest.fn((prefix: string) => {
        const results = [];
        for (const [key, value] of schemaStore.entries()) {
          if (key.startsWith(prefix)) {
            results.push({ key, value });
          }
        }
        return Promise.resolve(results);
      }),
      delete: jest.fn((key: string) => {
        schemaStore.delete(key);
        return Promise.resolve();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaVersionManagerService,
        {
          provide: RocksDBService,
          useValue: rocksDBServiceMock,
        },
      ],
    }).compile();

    service = module.get<SchemaVersionManagerService>(SchemaVersionManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerSchema', () => {
    it('should register a new schema with version 1 if no versions exist', async () => {
      const result = await service.registerSchema(mockSchema);

      expect(result.version).toBe(1);
      expect(result.name).toBe(mockSchema.name);
      expect(result.fields).toEqual(mockSchema.fields);
      expect(result.created).toBeInstanceOf(Date);
      expect(rocksDBServiceMock.put).toHaveBeenCalled();
    });

    it('should increment version when registering a schema with existing versions', async () => {
      // Register first version
      await service.registerSchema(mockSchema);

      // Register second version
      const updatedSchema = {
        ...mockSchema,
        fields: [
          ...mockSchema.fields,
          {
            name: 'inStock',
            type: 'boolean',
            required: true,
          },
        ],
      };

      const result = await service.registerSchema(
        updatedSchema as Omit<Schema, 'created' | 'version'>,
      );

      expect(result.version).toBe(2);
      expect(result.fields.length).toBe(4);
    });
  });

  describe('getSchema', () => {
    it('should return null if schema does not exist', async () => {
      const result = await service.getSchema('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the specified version if it exists', async () => {
      // Register schema
      const registered = await service.registerSchema(mockSchema);

      // Get the schema
      const result = await service.getSchema(mockSchema.name, registered.version);

      expect(result).not.toBeNull();
      expect(result.version).toBe(registered.version);
    });

    it('should return the latest version if no version is specified', async () => {
      // Register first version
      await service.registerSchema(mockSchema);

      // Register second version
      const updatedSchema = {
        ...mockSchema,
        fields: [...mockSchema.fields, { name: 'new', type: 'string', required: false }],
      };
      await service.registerSchema(updatedSchema as Omit<Schema, 'created' | 'version'>);

      // Get latest version
      const result = await service.getSchema(mockSchema.name);

      expect(result).not.toBeNull();
      expect(result.version).toBe(2);
      expect(result.fields.length).toBe(4);
    });
  });

  describe('validateDocument', () => {
    it('should validate a document against a schema', async () => {
      // Register schema
      await service.registerSchema(mockSchema);

      // Valid document
      const validDoc = {
        name: 'Test Product',
        price: 99.99,
        description: 'A great product',
      };

      const validResult = await service.validateDocument(mockSchema.name, validDoc);
      expect(validResult.valid).toBe(true);

      // Invalid document (missing required field)
      const invalidDoc = {
        name: 'Test Product',
        // price is missing
      };

      const invalidResult = await service.validateDocument(mockSchema.name, invalidDoc);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });
  });

  describe('updateSchema', () => {
    it('should create a new version when updating a schema', async () => {
      // Register initial schema
      await service.registerSchema(mockSchema);

      // Update schema
      const update = {
        fields: [
          ...mockSchema.fields,
          { name: 'category', type: 'string', required: false, facetable: true },
        ],
      };

      const result = await service.updateSchema(
        mockSchema.name,
        update as Partial<Omit<Schema, 'created' | 'version' | 'name'>>,
      );

      expect(result.version).toBe(2);
      expect(result.fields.length).toBe(4);
      expect(result.fields[3].name).toBe('category');
    });
  });

  describe('deleteSchema', () => {
    it('should delete a specific version of a schema', async () => {
      // Register two versions
      await service.registerSchema(mockSchema);
      await service.registerSchema({
        ...mockSchema,
        fields: [...mockSchema.fields, { name: 'new', type: 'string', required: false }],
      });

      // Delete version 1
      const result = await service.deleteSchema(mockSchema.name, 1);
      expect(result).toBe(true);

      // Version 1 should be gone, but version 2 should remain
      const v1 = await service.getSchema(mockSchema.name, 1);
      const v2 = await service.getSchema(mockSchema.name, 2);

      expect(v1).toBeNull();
      expect(v2).not.toBeNull();
    });

    it('should delete all versions when no version is specified', async () => {
      // Register two versions
      await service.registerSchema(mockSchema);
      await service.registerSchema({
        ...mockSchema,
        fields: [...mockSchema.fields, { name: 'new', type: 'string', required: false }],
      });

      // Delete all versions
      const result = await service.deleteSchema(mockSchema.name);
      expect(result).toBe(true);

      // No versions should remain
      const versions = await service.getSchemaVersions(mockSchema.name);
      expect(versions.length).toBe(0);
    });
  });
});
