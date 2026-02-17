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
import { InMemoryTermDictionary } from '../../index/term-dictionary';
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
    private readonly indexRepository: IndexRepository,
    private readonly termPostingsRepository: TermPostingsRepository,
    private readonly indexingService: IndexingService,
    private readonly documentService: DocumentService,
    @Inject('TERM_DICTIONARY')
    private readonly termDictionary: InMemoryTermDictionary,
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
    // Driver (OginiClient) expects { data: [...] } for listIndices (see performDetailedHealthChecks)
    return {
      data: indices,
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
    const result = await this.indexService.updateMappings(indexName, mappingsDto);
    // Invalidate field boost cache so next search uses new mapping boost values
    this.searchService.clearFieldBoostCache(indexName);
    return result;
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
      // First, ensure all current term postings are persisted to MongoDB (full sync)
      await this.indexingService.persistAllTermPostingsToMongoDB(name);

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

  @Post('migrate/index-aware-terms')
  @ApiOperation({
    summary: 'Migrate term postings to index-aware format',
    description:
      'Converts existing field:term format to index:field:term format in MongoDB and updates in-memory term dictionary. Optimized for 500k+ records.',
  })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    type: 'boolean',
    description: 'Run analysis without making changes',
  })
  @ApiResponse({
    status: 200,
    description: 'Migration completed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            totalRecords: { type: 'number' },
            migratedRecords: { type: 'number' },
            alreadyMigrated: { type: 'number' },
            errors: { type: 'number' },
            durationMs: { type: 'number' },
          },
        },
      },
    },
  })
  async migrateToIndexAwareTerms(@Query('dryRun') dryRun?: boolean): Promise<any> {
    const startTime = Date.now();
    this.logger.log(
      `🚀 Starting ${dryRun ? 'DRY RUN' : 'MIGRATION'} to index-aware term format...`,
    );

    try {
      if (dryRun) {
        const analysis = await this.analyzeTermFormats();
        return {
          success: true,
          message: 'Analysis completed',
          analysis,
          recommendations: this.generateRecommendations(analysis),
        };
      }

      // Phase 1: MongoDB Migration
      this.logger.log('📊 Phase 1: Migrating MongoDB term postings...');
      const mongoResult = await this.migrateMongoDBAwareTerms();

      // Phase 2: Update in-memory term dictionary
      this.logger.log('💾 Phase 2: Updating in-memory term dictionary...');
      const memoryResult = await this.updateInMemoryTermDictionary();

      const durationMs = Date.now() - startTime;
      const result: MigrationResult = {
        success: true,
        totalRecords: mongoResult.totalRecords,
        migratedRecords: mongoResult.migratedRecords,
        alreadyMigrated: mongoResult.alreadyMigrated,
        errors: mongoResult.errors + memoryResult.errors,
        durationMs,
        phases: {
          mongoMigration: mongoResult.progress,
          termDictionaryUpdate: memoryResult.progress,
        },
      };

      this.logger.log('🎉 Migration completed successfully!');
      this.logger.log(
        `📈 Results: ${result.migratedRecords} migrated, ${result.errors} errors, ${(
          durationMs / 1000
        ).toFixed(2)}s duration`,
      );

      return {
        success: true,
        message: 'Migration completed successfully',
        result,
      };
    } catch (error) {
      this.logger.error(`❌ Migration failed: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: `Migration failed: ${error.message}`,
          error: error.stack,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('migration/status')
  @ApiOperation({
    summary: 'Check term format migration status',
    description: 'Analyze current term format distribution without making changes',
  })
  async getMigrationStatus(): Promise<any> {
    try {
      const analysis = await this.analyzeTermFormats();
      return {
        success: true,
        analysis,
        recommendations: this.generateRecommendations(analysis),
      };
    } catch (error) {
      throw new HttpException(
        `Failed to analyze migration status: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Analyze current term format distribution
   */
  private async analyzeTermFormats(): Promise<any> {
    this.logger.log('🔍 Analyzing current term format distribution...');

    const [legacyCount, indexAwareCount, totalCount, sampleTerms] = await Promise.all([
      this.termPostingsRepository['termPostingsModel']
        .countDocuments({ term: { $not: /^[^:]+:[^:]+:.+/ } })
        .exec(),
      this.termPostingsRepository['termPostingsModel']
        .countDocuments({ term: /^[^:]+:[^:]+:.+/ })
        .exec(),
      this.termPostingsRepository['termPostingsModel'].countDocuments().exec(),
      this.termPostingsRepository['termPostingsModel']
        .find({ term: { $not: /^[^:]+:[^:]+:.+/ } })
        .limit(10)
        .select('indexName term')
        .exec(),
    ]);

    const legacyPercentage = totalCount > 0 ? (legacyCount / totalCount) * 100 : 0;
    const indexAwarePercentage = totalCount > 0 ? (indexAwareCount / totalCount) * 100 : 0;

    return {
      totalRecords: totalCount,
      legacyFormat: {
        count: legacyCount,
        percentage: legacyPercentage,
        format: 'field:term',
      },
      indexAwareFormat: {
        count: indexAwareCount,
        percentage: indexAwarePercentage,
        format: 'index:field:term',
      },
      sampleLegacyTerms: sampleTerms.map(t => ({
        current: `${t.indexName} | ${t.term}`,
        willBecome: `${t.indexName} | ${t.indexName}:${t.term}`,
      })),
      migrationNeeded: legacyCount > 0,
    };
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(analysis: any): string[] {
    const recommendations = [];

    if (analysis.legacyFormat.count === 0) {
      recommendations.push('✅ All terms already in index-aware format - no migration needed');
    } else if (analysis.legacyFormat.count < 1000) {
      recommendations.push('🟡 Small migration - can run immediately');
    } else if (analysis.legacyFormat.count < 100000) {
      recommendations.push('🟠 Medium migration - estimated 1-5 minutes');
    } else {
      recommendations.push(
        '🔴 Large migration - estimated 10+ minutes, consider maintenance window',
      );
      recommendations.push('💾 Ensure database backup before proceeding');
    }

    if (analysis.legacyFormat.percentage > 90) {
      recommendations.push(
        '📊 Most data needs migration - expect significant performance improvement after completion',
      );
    }

    return recommendations;
  }

  /**
   * Migrate MongoDB terms using optimized bulk operations
   */
  private async migrateMongoDBAwareTerms(): Promise<{
    totalRecords: number;
    migratedRecords: number;
    alreadyMigrated: number;
    errors: number;
    progress: MigrationProgress;
  }> {
    // Use the optimized migration method from the repository
    const result = await this.termPostingsRepository.migrateLegacyTermsToIndexAware();

    return {
      totalRecords: result.totalProcessed,
      migratedRecords: result.migratedCount,
      alreadyMigrated: result.alreadyMigrated,
      errors: result.errorCount,
      progress: {
        phase: 'MongoDB Migration',
        processed: result.totalProcessed,
        total: result.totalProcessed,
        percentage: 100,
        errors: result.errorCount,
      },
    };
  }

  /**
   * Update in-memory term dictionary to use index-aware terms
   */
  private async updateInMemoryTermDictionary(): Promise<{
    errors: number;
    progress: MigrationProgress;
  }> {
    try {
      this.logger.log('💾 Clearing and rebuilding in-memory term dictionary...');

      // Clear existing term dictionary
      await this.termDictionary.clear();
      this.logger.log('🗑️ Cleared existing in-memory term dictionary');

      // Note: The term dictionary will be automatically repopulated as searches are performed
      // or we can trigger a full reload from MongoDB if needed

      this.logger.log('✅ In-memory term dictionary updated for index-aware format');

      return {
        errors: 0,
        progress: {
          phase: 'Term Dictionary Update',
          processed: 1,
          total: 1,
          percentage: 100,
          errors: 0,
        },
      };
    } catch (error) {
      this.logger.error(`Term dictionary update error: ${error.message}`);
      return {
        errors: 1,
        progress: {
          phase: 'Term Dictionary Update',
          processed: 0,
          total: 1,
          percentage: 0,
          errors: 1,
        },
      };
    }
  }

  @Get(':name/debug/term-postings')
  @ApiOperation({
    summary: 'Debug term postings format',
    description: 'Shows sample term postings from MongoDB to verify format after migration',
  })
  @ApiParam({
    name: 'name',
    description: 'Index name to debug',
    example: 'bulk-test-10000',
  })
  async debugTermPostings(@Param('name') name: string): Promise<any> {
    try {
      const sampleTerms = await this.termPostingsRepository['termPostingsModel']
        .find({ indexName: name })
        .limit(10)
        .select('indexName term postings documentCount lastUpdated')
        .exec();

      return {
        success: true,
        indexName: name,
        totalTerms: await this.termPostingsRepository.getTermCount(name),
        sampleTerms: sampleTerms.map(term => ({
          indexName: term.indexName,
          term: term.term,
          documentCount: term.documentCount,
          lastUpdated: term.lastUpdated,
          samplePostings: Object.keys(term.postings)
            .slice(0, 3)
            .map(docId => ({
              docId,
              frequency: term.postings[docId].frequency,
              positionsCount: term.postings[docId].positions?.length || 0,
            })),
        })),
      };
    } catch (error) {
      this.logger.error(`Error getting debug term postings for ${name}: ${error.message}`);
      throw new BadRequestException(`Debug failed: ${error.message}`);
    }
  }

  /**
   * Debug: Test direct MongoDB repository lookup
   */
  @Get(':name/debug/mongo-lookup/:term')
  @ApiOperation({
    summary: 'Debug MongoDB repository lookup',
    description: 'Directly test the MongoDB repository lookup for a specific term',
  })
  async debugMongoLookup(@Param('name') indexName: string, @Param('term') term: string) {
    try {
      const result = await this.termPostingsRepository.findByIndexAwareTerm(term);

      return {
        success: true,
        indexName,
        term,
        found: !!result,
        documentCount: result ? Object.keys(result.postings).length : 0,
        samplePostings: result
          ? Object.entries(result.postings)
              .slice(0, 3)
              .map(([docId, posting]) => ({
                docId,
                frequency: posting.frequency,
                positionsCount: posting.positions?.length || 0,
              }))
          : [],
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
      // Access the private method through reflection for debugging
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

  /**
   * Debug: Test in-memory term dictionary lookup
   */
  @Get(':name/debug/memory-lookup/:term')
  @ApiOperation({
    summary: 'Debug in-memory term dictionary lookup',
    description: 'Test the in-memory term dictionary lookup for a specific term',
  })
  async debugMemoryLookup(@Param('name') indexName: string, @Param('term') term: string) {
    try {
      const postingList = await this.termDictionary.getPostingListForIndex(indexName, term);

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

  /**
   * Debug: Test posting list size method
   */
  @Get(':name/debug/memory-size/:term')
  @ApiOperation({
    summary: 'Debug posting list size method',
    description: 'Test the exact size() value returned by in-memory posting list',
  })
  async debugMemorySize(@Param('name') indexName: string, @Param('term') term: string) {
    try {
      const postingList = await this.termDictionary.getPostingListForIndex(indexName, term);

      return {
        success: true,
        indexName,
        term,
        found: !!postingList,
        size: postingList ? postingList.size() : null,
        sizeType: postingList ? typeof postingList.size() : 'null',
        sizeGreaterThanZero: postingList ? postingList.size() > 0 : false,
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

  /**
   * Debug: Trace complete search execution
   */
  @Post(':name/debug/search-trace')
  @ApiOperation({
    summary: 'Debug complete search execution',
    description: 'Trace the complete search execution path with detailed logging',
  })
  async debugSearchTrace(@Param('name') indexName: string, @Body() searchQuery: any) {
    try {
      // Enable debug mode for this search
      const originalLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'debug';

      const result = await this.searchService.search(indexName, searchQuery);

      // Restore original log level
      process.env.LOG_LEVEL = originalLogLevel;

      return {
        success: true,
        indexName,
        query: searchQuery,
        result: result.data,
        took: result.took,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        indexName,
        query: searchQuery,
      };
    }
  }
}
