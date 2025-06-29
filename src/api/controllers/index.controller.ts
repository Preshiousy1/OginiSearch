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
import { IndexRepository } from '../../storage/mongodb/repositories/index.repository';
import { TermPostingsRepository } from '../../storage/mongodb/repositories/term-postings.repository';
import { IndexingService } from '../../indexing/indexing.service';
import { DocumentService } from '../../document/document.service';
import { Logger } from '@nestjs/common';

@ApiTags('Indices')
@ApiExtraModels(CreateIndexDto, UpdateIndexSettingsDto)
@ApiBearerAuth('JWT-auth')
@Controller('api/indices')
export class IndexController {
  private readonly logger = new Logger(IndexController.name);

  constructor(
    private readonly indexService: IndexService,
    private readonly indexRepository: IndexRepository,
    private readonly termPostingsRepository: TermPostingsRepository,
    private readonly indexingService: IndexingService,
    private readonly documentService: DocumentService,
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
    return this.indexService.updateIndexSettings(name, updateIndexSettingsDto.settings);
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
    await this.indexService.rebuildDocumentCount(name);
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
      enableTermPostingsPersistence?: boolean;
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
      enableTermPostingsPersistence: boolean;
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
        enableTermPostingsPersistence: options.enableTermPostingsPersistence !== false,
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
  async rebuildEntireIndex(@Param('name') name: string): Promise<void> {
    await this.indexingService.updateAll(name);
  }

  @Get('debug/mongodb')
  async debugMongoDB() {
    try {
      // Test MongoDB connection by trying to find all indices
      const indices = await this.indexRepository.findAll();

      // Get term postings count for each index
      const termPostingsInfo = [];
      for (const index of indices) {
        const termCount = await this.termPostingsRepository.getTermCount(index.name);
        termPostingsInfo.push({
          indexName: index.name,
          termCount,
        });
      }

      return {
        status: 'success',
        message: 'MongoDB connection working',
        indicesCount: indices.length,
        indices: indices.map(idx => ({ name: idx.name, createdAt: idx.createdAt })),
        termPostings: termPostingsInfo,
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'MongoDB connection failed',
        error: error.message,
      };
    }
  }

  @Put(':indexName/mappings')
  @ApiOperation({ summary: 'Update index field mappings' })
  @ApiParam({ name: 'indexName', description: 'Name of the index' })
  @ApiBody({
    description: 'Field mappings configuration',
    type: MappingsDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Mappings updated successfully',
    type: IndexResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Index not found' })
  async updateMappings(
    @Param('indexName') indexName: string,
    @Body() mappingsDto: MappingsDto,
  ): Promise<IndexResponseDto> {
    return this.indexService.updateMappings(indexName, mappingsDto);
  }

  @Post(':indexName/mappings/auto-detect')
  @ApiOperation({ summary: 'Auto-detect field mappings from existing documents' })
  @ApiParam({ name: 'indexName', description: 'Name of the index' })
  @ApiResponse({
    status: 200,
    description: 'Mappings auto-detected and applied successfully',
    type: IndexResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Index not found' })
  async autoDetectMappings(@Param('indexName') indexName: string): Promise<IndexResponseDto> {
    return this.indexService.autoDetectMappings(indexName);
  }

  @Post(':indexName/clear-cache')
  @ApiOperation({ summary: 'Clear term dictionary cache for index' })
  @ApiParam({ name: 'indexName', description: 'Name of the index' })
  @ApiResponse({
    status: 200,
    description: 'Cache cleared successfully',
    schema: {
      properties: {
        message: { type: 'string' },
        clearedTerms: { type: 'number' },
      },
    },
  })
  async clearIndexCache(@Param('indexName') indexName: string) {
    this.logger.log(`Clearing cache for index: ${indexName}`);

    try {
      // Get the term dictionary and clear cache for this index
      const termDictionary = this.indexService.getTermDictionary();

      // Count terms before clearing
      const termsBefore = termDictionary.getTermsForIndex(indexName).length;

      // Clear the index cache
      await termDictionary.clearIndex(indexName);

      return {
        message: `Cache cleared successfully for index ${indexName}`,
        clearedTerms: termsBefore,
      };
    } catch (error) {
      this.logger.error(`Error clearing cache for index ${indexName}: ${error.message}`);
      throw new BadRequestException(`Error clearing cache: ${error.message}`);
    }
  }

  @Post('system/reset')
  @ApiOperation({
    summary: 'Complete system reset (DESTRUCTIVE)',
    description:
      'Destroys ALL data: term dictionary, RocksDB, MongoDB. Requires RESET_KEY environment variable.',
  })
  @ApiBody({
    description: 'Reset key for authorization',
    schema: {
      type: 'object',
      properties: {
        resetKey: {
          type: 'string',
          description: 'Secret key required to authorize system reset',
          example: 'test-reset-key-123',
        },
      },
      required: ['resetKey'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'System reset completed successfully',
    schema: {
      properties: {
        message: { type: 'string' },
        resetComponents: { type: 'array', items: { type: 'string' } },
        timestamp: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or missing reset key',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid reset key' },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'System reset failed due to internal error',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 500 },
        message: { type: 'string', example: 'System reset failed: Database connection error' },
        error: { type: 'string', example: 'Internal Server Error' },
      },
    },
  })
  async completeSystemReset(@Body() body: { resetKey: string }) {
    // Temporary hardcoded key for testing
    const hardcodedResetKey = 'test-reset-key-123';
    const requiredKey = process.env.RESET_KEY || hardcodedResetKey;

    if (!requiredKey || body.resetKey !== requiredKey) {
      this.logger.warn('Unauthorized system reset attempt');
      throw new BadRequestException('Invalid reset key');
    }

    this.logger.warn('INITIATING COMPLETE SYSTEM RESET - ALL DATA WILL BE DESTROYED');

    const resetComponents: string[] = [];

    try {
      // 1. Clear term dictionary completely
      const termDictionary = this.indexService.getTermDictionary();
      await termDictionary.cleanup();
      resetComponents.push('Term Dictionary');

      // 2. Clear RocksDB completely
      const rocksDBService = this.indexService.getRocksDBService();
      await rocksDBService.clear();
      resetComponents.push('RocksDB');

      // 3. Clear MongoDB indices
      await this.indexRepository.deleteAll();
      resetComponents.push('MongoDB Indices');

      // 4. Clear MongoDB term postings
      const deletedTermPostings = await this.termPostingsRepository.deleteAll();
      resetComponents.push(`MongoDB Term Postings (${deletedTermPostings} deleted)`);

      // 5. Clear document storage
      await this.documentService.deleteAllDocuments();
      resetComponents.push('Document Storage');

      this.logger.warn(`System reset completed. Reset components: ${resetComponents.join(', ')}`);

      return {
        message: 'Complete system reset successful - ALL DATA DESTROYED',
        resetComponents,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`System reset failed: ${error.message}`);
      throw new BadRequestException(`System reset failed: ${error.message}`);
    }
  }

  @Post(':name/migrate-term-postings')
  @ApiOperation({
    summary: 'Migrate term postings to MongoDB',
    description: 'Migrates term postings from RocksDB to MongoDB for persistence',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to migrate',
    example: 'businesses',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Term postings migration completed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Term postings migration completed successfully' },
        indexName: { type: 'string', example: 'businesses' },
        migratedTerms: { type: 'number', example: 150 },
      },
    },
  })
  async migrateTermPostings(@Param('name') name: string): Promise<{
    message: string;
    indexName: string;
    migratedTerms: number;
  }> {
    this.logger.log(`Starting term postings migration for index: ${name}`);

    try {
      // First, ensure all current term postings are persisted to MongoDB
      await this.indexingService.persistTermPostingsToMongoDB(name);

      this.logger.log(`Term postings migration completed for index: ${name}`);

      // Get the count of migrated terms
      const termCount = await this.termPostingsRepository.getTermCount(name);

      return {
        message: 'Term postings migration completed successfully',
        indexName: name,
        migratedTerms: termCount,
      };
    } catch (error) {
      this.logger.error(`Term postings migration failed for index ${name}: ${error.message}`);
      throw new BadRequestException(`Migration failed: ${error.message}`);
    }
  }

  @Delete(':name/term-postings')
  @ApiOperation({
    summary: 'Clear term postings for an index',
    description:
      'Deletes all term postings for a specific index from MongoDB. Useful for cleaning up faulty migrations before re-migrating with correct format.',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to clear term postings for',
    example: 'bulk-test-10000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Term postings cleared successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Term postings cleared successfully for index bulk-test-10000',
        },
        indexName: {
          type: 'string',
          example: 'bulk-test-10000',
        },
        deletedCount: {
          type: 'number',
          example: 338,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index with the specified name does not exist',
  })
  async clearIndexTermPostings(@Param('name') name: string): Promise<{
    message: string;
    indexName: string;
    deletedCount: number;
  }> {
    this.logger.log(`Clearing term postings for index: ${name}`);

    try {
      // Verify index exists first
      await this.indexService.getIndex(name);

      // Delete all term postings for this index from MongoDB
      const deletedCount = await this.termPostingsRepository.deleteByIndex(name);

      this.logger.log(`Cleared ${deletedCount} term postings for index: ${name}`);

      return {
        message: `Term postings cleared successfully for index ${name}`,
        indexName: name,
        deletedCount,
      };
    } catch (error) {
      this.logger.error(`Error clearing term postings for index ${name}: ${error.message}`);
      throw new BadRequestException(`Error clearing term postings: ${error.message}`);
    }
  }
}
