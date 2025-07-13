import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  ValidationPipe,
  BadRequestException,
  HttpException,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateIndexDto,
  UpdateIndexSettingsDto,
  IndexResponseDto,
  IndexListResponseDto,
  MappingsDto,
} from '../dtos/index.dto';
import { IndexService } from '../../index/index.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
} from '@nestjs/swagger';
import { IndexingService } from '../../indexing/indexing.service';
import { DocumentService } from '../../document/document.service';
import { Logger } from '@nestjs/common';
import { TermDictionary } from '../../index/term-dictionary';
import { SearchService } from '../../search/search.service';

interface MigrationProgress {
  phase: string;
  processed: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining?: number;
  errors: number;
}

interface MigrationResult {
  success: boolean;
  totalRecords: number;
  migratedRecords: number;
  alreadyMigrated: number;
  errors: number;
  durationMs: number;
  phases: {
    mongoMigration: MigrationProgress;
    termDictionaryUpdate: MigrationProgress;
  };
}

@ApiTags('Indices')
@ApiExtraModels(CreateIndexDto, UpdateIndexSettingsDto)
@ApiBearerAuth('JWT-auth')
@Controller('api/indices')
export class IndexController {
  private readonly logger = new Logger(IndexController.name);

  constructor(
    private readonly indexService: IndexService,
    private readonly indexingService: IndexingService,
    private readonly documentService: DocumentService,
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: TermDictionary,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new index',
    description:
      'Creates a new search index with the specified name, settings, and mappings. The index name must be unique.',
  })
  @ApiBody({
    type: CreateIndexDto,
    description: 'Index creation parameters including name, settings, and field mappings',
    examples: {
      simple: {
        summary: 'Simple index with default settings',
        value: {
          name: 'businesses',
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
              description: { type: 'text', analyzer: 'standard' },
              price: { type: 'number' },
              categories: { type: 'keyword' },
            },
          },
        },
      },
      advanced: {
        summary: 'Advanced index with custom settings',
        value: {
          name: 'articles',
          settings: {
            numberOfShards: 2,
            refreshInterval: '5s',
          },
          mappings: {
            properties: {
              title: { type: 'text', analyzer: 'standard', boost: 2.0 },
              content: { type: 'text', analyzer: 'standard' },
              author: { type: 'keyword' },
              tags: { type: 'keyword' },
              publishDate: { type: 'date' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Index created successfully. Returns the created index configuration.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'businesses' },
        status: { type: 'string', example: 'open' },
        createdAt: { type: 'string', format: 'date-time', example: '2023-06-15T10:00:00Z' },
        documentCount: { type: 'number', example: 0 },
        settings: {
          type: 'object',
          example: { numberOfShards: 1, refreshInterval: '1s' },
        },
        mappings: {
          type: 'object',
          example: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input. The request body may be malformed or contain invalid fields.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'An index with the provided name already exists.',
  })
  async createIndex(
    @Body(ValidationPipe) createIndexDto: CreateIndexDto,
  ): Promise<IndexResponseDto> {
    return this.indexService.createIndex(createIndexDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all indices',
    description: 'Returns a list of all indices in the system. Can be filtered by status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter indices by status (open, closed, etc.)',
    example: 'open',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns a list of all indices',
    schema: {
      type: 'object',
      properties: {
        indices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'businesses' },
              status: { type: 'string', example: 'open' },
              documentCount: { type: 'number', example: 150 },
              createdAt: { type: 'string', format: 'date-time', example: '2023-06-15T10:00:00Z' },
            },
          },
        },
        total: { type: 'number', example: 2 },
      },
    },
  })
  async listIndices(@Query('status') status?: string): Promise<IndexListResponseDto> {
    const indices = await this.indexService.listIndices(status);
    return {
      indices,
      total: indices.length,
    };
  }

  @Get(':name')
  @ApiOperation({
    summary: 'Get index details',
    description:
      'Retrieves detailed information about a specific index including settings, mappings, and status.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to retrieve',
    example: 'businesses',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns detailed information about the index',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'businesses' },
        status: { type: 'string', example: 'open' },
        documentCount: { type: 'number', example: 150 },
        createdAt: { type: 'string', format: 'date-time', example: '2023-06-15T10:00:00Z' },
        settings: {
          type: 'object',
          example: { numberOfShards: 1, refreshInterval: '1s' },
        },
        mappings: {
          type: 'object',
          example: {
            properties: {
              title: { type: 'text', analyzer: 'standard' },
              description: { type: 'text', analyzer: 'standard' },
              price: { type: 'number' },
              categories: { type: 'keyword' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async getIndex(@Param('name') name: string): Promise<IndexResponseDto> {
    return this.indexService.getIndex(name);
  }

  @Put(':name/settings')
  @ApiOperation({
    summary: 'Update index settings',
    description:
      'Updates settings and mappings for an existing index. Only certain settings can be updated after creation.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to update',
    example: 'businesses',
  })
  @ApiBody({
    type: UpdateIndexSettingsDto,
    description: 'Index update parameters',
    examples: {
      settings: {
        summary: 'Update index settings',
        value: {
          settings: {
            refreshInterval: '2s',
          },
        },
      },
      mappings: {
        summary: 'Add new fields to mappings',
        value: {
          mappings: {
            properties: {
              inStock: { type: 'boolean' },
              rating: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Index updated successfully. Returns the updated index configuration.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'businesses' },
        status: { type: 'string', example: 'open' },
        documentCount: { type: 'number', example: 150 },
        settings: {
          type: 'object',
          example: { refreshInterval: '2s' },
        },
        mappings: {
          type: 'object',
          example: {
            properties: {
              title: { type: 'text' },
              inStock: { type: 'boolean' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input or attempt to modify immutable settings',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async updateIndex(
    @Param('name') name: string,
    @Body(ValidationPipe) updateIndexSettingsDto: UpdateIndexSettingsDto,
  ): Promise<IndexResponseDto> {
    return this.indexService.updateIndex(name, updateIndexSettingsDto.settings);
  }

  @Delete(':name')
  @ApiOperation({
    summary: 'Delete an index',
    description:
      'Permanently deletes an index and all its documents. This action cannot be undone.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to delete',
    example: 'businesses',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Index deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async deleteIndex(@Param('name') name: string): Promise<void> {
    await this.indexService.deleteIndex(name);
  }

  @Post(':name/_rebuild_count')
  @ApiOperation({
    summary: 'Rebuild document count',
    description: 'Rebuilds the document count for an index by scanning all documents.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to rebuild count for',
    example: 'businesses',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Document count rebuilt successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async rebuildDocumentCount(@Param('name') name: string): Promise<void> {
    try {
      // First verify the index exists
      const index = await this.indexService.getIndex(name);
      if (!index) {
        throw new NotFoundException(`Index ${name} not found`);
      }

      // Rebuild the document count
      await this.indexService.rebuildDocumentCount(name);
    } catch (error) {
      this.logger.error(`Error rebuilding document count for index ${name}: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Error rebuilding document count: ${error.message}`);
    }
  }

  @Post(':name/_rebuild_index')
  @ApiOperation({
    summary: 'Concurrent rebuild search index',
    description:
      'Rebuilds the search index using concurrent job processing for maximum performance. Processes documents in batches using multiple workers and automatically persists term postings to MongoDB.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to rebuild',
    example: 'businesses',
  })
  @ApiBody({
    required: false,
    description: 'Optional rebuild configuration',
    schema: {
      type: 'object',
      properties: {
        batchSize: {
          type: 'number',
          example: 1000,
          description: 'Number of documents per batch (default: 1000)',
        },
        concurrency: {
          type: 'number',
          example: 8,
          description: 'Number of concurrent batches (default: 8)',
        },
        enableTermPostingsPersistence: {
          type: 'boolean',
          example: true,
          description: 'Whether to persist term postings to MongoDB (default: true)',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Index rebuild started successfully with job details',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Concurrent rebuild started for businesses' },
        batchId: { type: 'string', example: 'rebuild:businesses:1640995200000:abc123' },
        totalBatches: { type: 'number', example: 120 },
        totalDocuments: { type: 'number', example: 120000 },
        status: { type: 'string', example: 'processing' },
        configuration: {
          type: 'object',
          properties: {
            batchSize: { type: 'number', example: 1000 },
            concurrency: { type: 'number', example: 8 },
            enableTermPostingsPersistence: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async manualRebuildIndex(
    @Param('name') name: string,
    @Body()
    options: {
      batchSize?: number;
      concurrency?: number;
    } = {},
  ): Promise<{
    message: string;
    batchId: string;
    totalBatches: number;
    totalDocuments: number;
    status: string;
    configuration: {
      batchSize: number;
      concurrency: number;
    };
  }> {
    this.logger.log(`Concurrent rebuild requested for index: ${name}`);
    this.logger.log(`Options: ${JSON.stringify(options)}`);

    try {
      // Verify index exists first
      await this.indexService.getIndex(name);

      // Set defaults
      const config = {
        batchSize: options.batchSize || 1000,
        concurrency: options.concurrency || 8,
      };

      // Start concurrent rebuild
      const result = await this.documentService.rebuildSpecificIndexConcurrent(name, config);

      this.logger.log(
        `✅ Concurrent rebuild queued for index: ${name} - ${result.totalBatches} batches, ${result.totalDocuments} documents`,
      );

      return {
        message: `Concurrent rebuild started for ${name}`,
        batchId: result.batchId,
        totalBatches: result.totalBatches,
        totalDocuments: result.totalDocuments,
        status: result.status,
        configuration: config,
      };
    } catch (error) {
      this.logger.error(`Error starting concurrent rebuild for index ${name}: ${error.message}`);
      throw new BadRequestException(`Error starting rebuild: ${error.message}`);
    }
  }

  @Post(':name/_rebuild_all')
  @ApiOperation({
    summary: 'Rebuild entire index',
    description:
      'Completely rebuilds the index including all terms and posting lists. This operation re-indexes all documents to ensure proper term dictionary population and wildcard search functionality. Use this when wildcard searches return unexpected results or after bulk document operations.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to rebuild',
    example: 'businesses',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Index rebuilt successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Index rebuilt successfully' },
        indexName: { type: 'string', example: 'businesses' },
        documentsProcessed: { type: 'number', example: 100 },
        termsIndexed: { type: 'number', example: 1500 },
        took: { type: 'number', example: 2500 },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error during index rebuild process',
  })
  async rebuildEntireIndex(@Param('name') name: string): Promise<{
    message: string;
    indexName: string;
    documentsProcessed: number;
    termsIndexed: number;
    took: number;
  }> {
    try {
      // First verify the index exists
      const index = await this.indexService.getIndex(name);
      if (!index) {
        throw new NotFoundException(`Index ${name} not found`);
      }

      const startTime = Date.now();

      // Get initial document count
      const initialIndex = await this.indexService.getIndex(name);
      const initialCount = initialIndex?.documentCount || 0;

      // Rebuild the index
      await this.indexingService.updateAll(name);

      // Get final document count
      const finalIndex = await this.indexService.getIndex(name);
      const finalCount = finalIndex?.documentCount || 0;

      // Get term count from index stats
      const termCount = this.termDictionary.size();

      const took = Date.now() - startTime;

      return {
        message: 'Index rebuilt successfully',
        indexName: name,
        documentsProcessed: finalCount,
        termsIndexed: termCount,
        took,
      };
    } catch (error) {
      this.logger.error(`Error rebuilding index ${name}: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Error rebuilding index: ${error.message}`);
    }
  }

  @Post(':name/rebuild')
  @ApiOperation({ summary: 'Rebuild an index' })
  @ApiResponse({ status: 200, description: 'Index rebuilt successfully' })
  @ApiResponse({ status: 404, description: 'Index not found' })
  async rebuildIndex(@Param('name') name: string): Promise<void> {
    this.logger.log(`Rebuilding index: ${name}`);
    // Check if index exists
    const index = await this.indexService.getIndex(name);
    if (!index) {
      throw new NotFoundException(`Index ${name} not found`);
    }
    // Clear the index and its cache
    await this.indexService.clearCache(name);
    await this.indexService['clearIndex'](name);
    // Rebuild using concurrent processing
    await this.documentService.rebuildSpecificIndexConcurrent(name);
  }

  @Put(':name/mappings')
  @ApiOperation({ summary: 'Update index mappings' })
  @ApiResponse({ status: 200, description: 'Mappings updated successfully' })
  @ApiResponse({ status: 404, description: 'Index not found' })
  async updateMappings(
    @Param('name') indexName: string,
    @Body() mappingsDto: MappingsDto,
  ): Promise<IndexResponseDto> {
    this.logger.log(`Updating mappings for index: ${indexName}`);
    const index = await this.indexService.getIndex(indexName);
    if (!index) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }
    const updatedSettings = {
      ...index.settings,
      mappings: mappingsDto,
    };
    return this.indexService.updateIndex(indexName, updatedSettings);
  }

  @Get(':name/mappings/detect')
  @ApiOperation({ summary: 'Auto-detect index mappings' })
  @ApiResponse({ status: 200, description: 'Mappings detected successfully' })
  @ApiResponse({ status: 404, description: 'Index not found' })
  async autoDetectMappings(@Param('name') indexName: string): Promise<MappingsDto> {
    this.logger.log(`Auto-detecting mappings for index: ${indexName}`);
    const index = await this.indexService.getIndex(indexName);
    if (!index) {
      throw new NotFoundException(`Index ${indexName} not found`);
    }

    // Get sample documents to use for field detection
    const sampleDocs = await this.documentService.listDocuments(indexName, { limit: 100 });
    if (sampleDocs.total === 0) {
      return { properties: {} };
    }

    // Use the same ensureFieldMappings logic as the document service
    await this.documentService['ensureFieldMappings'](
      indexName,
      sampleDocs.documents.map(doc => doc.source),
    );

    // Get the updated index with new mappings
    const updatedIndex = await this.indexService.getIndex(indexName);
    return updatedIndex.mappings;
  }

  /**
   * Debug: Test search executor posting list lookup
   */
  @Get(':name/debug/search-executor/:term')
  @ApiOperation({
    summary: 'Debug search executor posting list lookup',
    description: 'Test the search executor getPostingListByIndexAwareTerm method directly',
  })
  async debugSearchExecutor(@Param('name') indexName: string, @Param('term') term: string) {
    try {
      const searchExecutor = this.searchService['searchExecutor'];
      const postingList = await searchExecutor['getPostingListByIndexAwareTerm'](term);
      return {
        success: true,
        indexName,
        term,
        found: !!postingList,
        documentCount: postingList ? postingList.size() : 0,
        postingListType: postingList ? postingList.constructor.name : 'null',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        indexName,
        term,
      };
    }
  }
}
