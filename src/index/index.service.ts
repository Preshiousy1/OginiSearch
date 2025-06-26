import { Injectable, Logger, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { CreateIndexDto, IndexResponseDto, UpdateIndexSettingsDto } from '../api/dtos/index.dto';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexStatsService } from '../index/index-stats.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { Index, IndexSettings } from './interfaces/index.interface';
import { PersistentTermDictionaryService } from '../storage/index-storage/persistent-term-dictionary.service';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
    private readonly rocksDBService: RocksDBService,
  ) {}

  async createIndex(createIndexDto: CreateIndexDto): Promise<IndexResponseDto> {
    this.logger.log(`Creating index: ${createIndexDto.name}`);

    // Check if index already exists
    const existingIndex = await this.indexStorage.getIndex(createIndexDto.name);
    if (existingIndex) {
      throw new ConflictException(`Index with name ${createIndexDto.name} already exists`);
    }

    // Create index with settings and mappings
    const index = await this.indexStorage.createIndex({
      name: createIndexDto.name,
      settings: createIndexDto.settings || {},
      mappings: createIndexDto.mappings || { properties: {} },
    });

    // Register field analyzers if specified in mappings
    if (createIndexDto.mappings?.properties) {
      for (const [field, config] of Object.entries(createIndexDto.mappings.properties)) {
        if (config.analyzer) {
          this.analyzerRegistry.getAnalyzer(config.analyzer);
        }
      }
    }

    return this.mapToIndexResponse(index);
  }

  async listIndices(status?: string): Promise<IndexResponseDto[]> {
    this.logger.log('Listing all indices');
    const indices = await this.indexStorage.listIndices(status);
    return indices.map(index => this.mapToIndexResponse(index));
  }

  async getIndex(name: string): Promise<IndexResponseDto> {
    this.logger.log(`Getting index: ${name}`);
    const index = await this.indexStorage.getIndex(name);

    if (!index) {
      throw new NotFoundException(`Index with name ${name} not found`);
    }

    return this.mapToIndexResponse(index);
  }

  async updateIndexSettings(name: string, settings: any): Promise<IndexResponseDto> {
    this.logger.log(`Updating index settings: ${name}`);
    const index = await this.indexStorage.getIndex(name);

    if (!index) {
      throw new NotFoundException(`Index with name ${name} not found`);
    }

    const updatedIndex = await this.indexStorage.updateIndex(name, { settings });
    return this.mapToIndexResponse(updatedIndex);
  }

  async deleteIndex(name: string): Promise<void> {
    this.logger.log(`Deleting index: ${name}`);
    const index = await this.indexStorage.getIndex(name);

    if (!index) {
      throw new NotFoundException(`Index with name ${name} not found`);
    }

    try {
      // 1. Delete all documents from MongoDB storage
      await this.documentStorage.deleteAllDocumentsInIndex(name);

      // 2. Delete all index data from RocksDB
      await this.indexStorage.deleteIndex(name);

      // 3. Reset index statistics
      this.indexStats.reset();

      // 4. Clear term dictionary entries for this index
      // Get all terms for this index and remove them
      const terms = this.termDictionary.getTerms().filter(term => term.startsWith(`${name}:`));
      for (const term of terms) {
        this.termDictionary.removeTerm(term);
      }

      // 5. Delete term postings from MongoDB
      await this.persistentTermDictionary.deleteIndexTermPostings(name);

      this.logger.log(`Index ${name} deleted successfully`);
    } catch (error) {
      this.logger.error(`Error deleting index ${name}: ${error.message}`);
      throw error;
    }
  }

  async rebuildDocumentCount(indexName: string): Promise<void> {
    this.logger.log(`Rebuilding document count for index ${indexName}`);

    const index = await this.indexStorage.getIndex(indexName);
    if (!index) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }

    // Get total document count from storage
    const { total } = await this.documentStorage.getDocuments(indexName, { limit: 0 });

    // Update index metadata
    index.documentCount = total;
    await this.indexStorage.updateIndex(indexName, index);

    this.logger.log(`Document count rebuilt for index ${indexName}: ${total} documents`);
  }

  async updateMappings(indexName: string, mappings: any): Promise<IndexResponseDto> {
    this.logger.log(`Updating mappings for index: ${indexName}`);

    // Check if index exists
    const existingIndex = await this.indexStorage.getIndex(indexName);
    if (!existingIndex) {
      throw new NotFoundException(`Index with name ${indexName} not found`);
    }

    // Update index with new mappings
    const updatedIndex = await this.indexStorage.updateIndex(indexName, {
      ...existingIndex,
      mappings: mappings,
      updatedAt: new Date().toISOString(),
    });

    return this.mapToIndexResponse(updatedIndex);
  }

  async autoDetectMappings(indexName: string): Promise<IndexResponseDto> {
    this.logger.log(`Auto-detecting mappings for index: ${indexName}`);

    // Check if index exists
    const existingIndex = await this.indexStorage.getIndex(indexName);
    if (!existingIndex) {
      throw new NotFoundException(`Index with name ${indexName} not found`);
    }

    // Get sample documents to analyze
    const result = await this.documentStorage.getDocuments(indexName, { limit: 10 });
    if (result.documents.length === 0) {
      throw new NotFoundException(`No documents found in index ${indexName} to analyze`);
    }

    // Analyze first few documents to detect field types
    const sampleSize = Math.min(10, result.documents.length);
    const fieldTypes = new Map<string, string>();
    const fieldExamples = new Map<string, Set<any>>();

    for (let i = 0; i < sampleSize; i++) {
      const doc = result.documents[i];
      this.analyzeDocumentFields(doc.content, '', fieldTypes, fieldExamples);
    }

    // Create mappings based on detected field types
    const detectedMappings = {
      dynamic: true,
      properties: {} as Record<string, any>,
    };

    for (const [fieldPath, fieldType] of fieldTypes.entries()) {
      detectedMappings.properties[fieldPath] = this.createFieldMapping(
        fieldType,
        fieldExamples.get(fieldPath),
      );
    }

    // Update index with detected mappings
    const updatedIndex = await this.indexStorage.updateIndex(indexName, {
      ...existingIndex,
      mappings: detectedMappings,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`Auto-detected ${fieldTypes.size} fields for index ${indexName}`);

    return this.mapToIndexResponse(updatedIndex);
  }

  /**
   * Recursively analyze document fields to detect types
   */
  private analyzeDocumentFields(
    obj: any,
    prefix: string,
    fieldTypes: Map<string, string>,
    fieldExamples: Map<string, Set<any>>,
  ): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        continue;
      }

      // Initialize examples set if not exists
      if (!fieldExamples.has(fieldPath)) {
        fieldExamples.set(fieldPath, new Set());
      }
      fieldExamples.get(fieldPath)!.add(value);

      if (typeof value === 'string') {
        // Determine if it's a long text (use 'text') or short keyword (use 'keyword')
        const currentType = fieldTypes.get(fieldPath);
        if (!currentType) {
          fieldTypes.set(fieldPath, value.length > 50 || value.includes(' ') ? 'text' : 'keyword');
        } else if (currentType === 'keyword' && (value.length > 50 || value.includes(' '))) {
          fieldTypes.set(fieldPath, 'text'); // Upgrade to text if we find long strings
        }
      } else if (typeof value === 'number') {
        fieldTypes.set(fieldPath, Number.isInteger(value) ? 'integer' : 'float');
      } else if (typeof value === 'boolean') {
        fieldTypes.set(fieldPath, 'boolean');
      } else if (
        value instanceof Date ||
        (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
      ) {
        fieldTypes.set(fieldPath, 'date');
      } else if (Array.isArray(value)) {
        // Analyze array elements
        if (value.length > 0) {
          const firstElement = value[0];
          if (typeof firstElement === 'string') {
            fieldTypes.set(fieldPath, 'keyword'); // Array of strings as keywords
          } else if (typeof firstElement === 'object') {
            fieldTypes.set(fieldPath, 'nested');
            // Also analyze nested objects in array
            value.forEach((item, index) => {
              if (typeof item === 'object') {
                this.analyzeDocumentFields(item, fieldPath, fieldTypes, fieldExamples);
              }
            });
          }
        }
      } else if (typeof value === 'object') {
        // Recursively analyze nested objects
        fieldTypes.set(fieldPath, 'object');
        this.analyzeDocumentFields(value, fieldPath, fieldTypes, fieldExamples);
      }
    }
  }

  /**
   * Create field mapping configuration based on detected type
   */
  private createFieldMapping(fieldType: string, examples?: Set<any>): any {
    const baseMapping = {
      type: fieldType,
      store: true,
      index: true,
    };

    switch (fieldType) {
      case 'text':
        return {
          ...baseMapping,
          analyzer: 'standard',
          fields: {
            keyword: {
              type: 'keyword',
              ignore_above: 256,
            },
          },
        };
      case 'keyword':
        return {
          ...baseMapping,
          ignore_above: 256,
        };
      case 'integer':
      case 'float':
        return baseMapping;
      case 'boolean':
        return baseMapping;
      case 'date':
        return {
          ...baseMapping,
          format: 'strict_date_optional_time||epoch_millis',
        };
      case 'object':
        return {
          type: 'object',
        };
      case 'nested':
        return {
          type: 'nested',
        };
      default:
        return {
          type: 'text',
          analyzer: 'standard',
        };
    }
  }

  private mapToIndexResponse(index: any): IndexResponseDto {
    return {
      name: index.name,
      createdAt: index.createdAt,
      documentCount: index.documentCount || 0,
      settings: index.settings,
      mappings: index.mappings,
      status: index.status || 'open',
    };
  }

  /**
   * Get the term dictionary instance
   */
  getTermDictionary(): InMemoryTermDictionary {
    return this.termDictionary;
  }

  /**
   * Get the RocksDB service instance
   */
  getRocksDBService() {
    return this.rocksDBService;
  }

  /**
   * Update indexing to use index-aware term dictionary
   */
  async addTermForIndex(indexName: string, fieldTerm: string, posting: any): Promise<void> {
    await this.termDictionary.addPostingForIndex(indexName, fieldTerm, posting);
  }

  /**
   * Get terms for a specific index
   */
  getTermsForIndex(indexName: string): string[] {
    return this.termDictionary.getTermsForIndex(indexName);
  }

  /**
   * Clear terms for a specific index
   */
  async clearIndexTerms(indexName: string): Promise<void> {
    await this.termDictionary.clearIndex(indexName);
  }
}
