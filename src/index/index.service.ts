import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateIndexDto, IndexResponseDto, UpdateIndexSettingsDto } from '../api/dtos/index.dto';
import { IndexStorageService } from '../storage/index-storage/index-storage.service';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);

  constructor(
    private readonly indexStorage: IndexStorageService,
    private readonly analyzerRegistry: AnalyzerRegistryService,
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

  async listIndices(): Promise<IndexResponseDto[]> {
    this.logger.log('Listing all indices');
    const indices = await this.indexStorage.listIndices();
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

    await this.indexStorage.deleteIndex(name);
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
