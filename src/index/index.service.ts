import { Injectable, Logger, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { CreateIndexDto, IndexResponseDto, UpdateIndexSettingsDto } from '../api/dtos/index.dto';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { IndexStatsService } from '../index/index-stats.service';
import { InMemoryTermDictionary } from '../index/term-dictionary';
import { Index, IndexSettings } from './interfaces/index.interface';

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
    private readonly documentStorage: DocumentStorageService,
    private readonly indexStats: IndexStatsService,
    @Inject('TERM_DICTIONARY') private readonly termDictionary: InMemoryTermDictionary,
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

      this.logger.log(`Successfully deleted index ${name} and all its data`);
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
}
