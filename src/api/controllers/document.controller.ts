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
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  IndexDocumentDto,
  BulkIndexDocumentsDto,
  DocumentResponseDto,
  BulkResponseDto,
  DeleteByQueryResponseDto,
  DeleteByQueryDto,
  ListDocumentsResponseDto,
} from '../dtos/document.dto';
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
import { DocumentService } from '../../document/document.service';
import { BulkIndexingService } from '../../indexing/services/bulk-indexing.service';
import { v4 as uuidv4 } from 'uuid';

@ApiTags('Documents')
@ApiExtraModels(IndexDocumentDto, BulkIndexDocumentsDto, DeleteByQueryDto)
@ApiBearerAuth('JWT-auth')
@Controller('api/indices/:index/documents')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly bulkIndexingService: BulkIndexingService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Index a document',
    description:
      'Adds a document to the specified index. If a document with the same ID already exists, it will be replaced.',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name where the document will be stored',
    example: 'businesses',
  })
  @ApiBody({
    type: IndexDocumentDto,
    description: 'Document to be indexed',
    examples: {
      withId: {
        summary: 'Document with specified ID',
        value: {
          id: 'product-123',
          document: {
            title: 'Smartphone X',
            description: 'Latest smartphone with advanced features',
            price: 999.99,
            categories: ['electronics', 'mobile'],
          },
        },
      },
      withoutId: {
        summary: 'Document with auto-generated ID',
        value: {
          document: {
            title: 'Laptop Pro',
            description: 'Professional grade laptop for developers',
            price: 1499.99,
            categories: ['electronics', 'computers'],
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Document indexed successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'product-123' },
        index: { type: 'string', example: 'businesses' },
        version: { type: 'number', example: 1 },
        result: { type: 'string', example: 'created' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid document structure or fields',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Specified index does not exist',
  })
  async indexDocument(
    @Param('index') index: string,
    @Body(ValidationPipe) indexDocumentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documentService.indexDocument(index, indexDocumentDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a document by ID',
    description: 'Retrieves a specific document from the index by its ID',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiParam({
    name: 'id',
    description: 'Document ID',
    example: 'product-123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the requested document',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'product-123' },
        index: { type: 'string', example: 'businesses' },
        version: { type: 'number', example: 1 },
        source: {
          type: 'object',
          example: {
            title: 'Smartphone X',
            description: 'Latest smartphone with advanced features',
            price: 999.99,
            categories: ['electronics', 'mobile'],
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Document or index not found',
  })
  async getDocument(
    @Param('index') index: string,
    @Param('id') id: string,
  ): Promise<DocumentResponseDto> {
    return this.documentService.getDocument(index, id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a document',
    description: 'Updates an existing document in the index. The document must already exist.',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiParam({
    name: 'id',
    description: 'Document ID to update',
    example: 'product-123',
  })
  @ApiBody({
    type: IndexDocumentDto,
    examples: {
      update: {
        summary: 'Update document fields',
        value: {
          document: {
            title: 'Smartphone X Pro',
            price: 1099.99,
            inStock: false,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Document updated successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'product-123' },
        index: { type: 'string', example: 'businesses' },
        version: { type: 'number', example: 2 },
        result: { type: 'string', example: 'updated' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid document structure',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Document or index not found',
  })
  async updateDocument(
    @Param('index') index: string,
    @Param('id') id: string,
    @Body(ValidationPipe) indexDocumentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documentService.updateDocument(index, id, indexDocumentDto.document);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a document',
    description: 'Permanently removes a document from the index by ID',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiParam({
    name: 'id',
    description: 'Document ID to delete',
    example: 'product-123',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Document deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Document or index not found',
  })
  async deleteDocument(@Param('index') index: string, @Param('id') id: string): Promise<void> {
    await this.documentService.deleteDocument(index, id);
  }

  @Post('_bulk')
  @ApiOperation({
    summary: 'Bulk index documents',
    description: 'Indexes multiple documents in a single operation for better performance',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiBody({
    type: BulkIndexDocumentsDto,
    description: 'Array of documents to index',
    examples: {
      bulk: {
        summary: 'Index multiple documents',
        value: {
          documents: [
            {
              id: 'product-123',
              document: {
                title: 'Smartphone X',
                price: 999.99,
                categories: ['electronics'],
              },
            },
            {
              id: 'product-124',
              document: {
                title: 'Laptop Pro',
                price: 1499.99,
                categories: ['electronics', 'computers'],
              },
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Documents indexed successfully',
    schema: {
      type: 'object',
      properties: {
        took: { type: 'number', example: 35 },
        errors: { type: 'boolean', example: false },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'product-123' },
              index: { type: 'string', example: 'businesses' },
              version: { type: 'number', example: 1 },
              result: { type: 'string', example: 'created' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid document structure or fields',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Specified index does not exist',
  })
  async bulkIndexDocuments(
    @Param('index') index: string,
    @Body(ValidationPipe) bulkIndexDocumentsDto: BulkIndexDocumentsDto,
  ): Promise<BulkResponseDto> {
    const startTime = Date.now();

    // Map documents to ensure required id field
    const documents = bulkIndexDocumentsDto.documents.map(doc => ({
      id: doc.id || uuidv4(), // Use provided id or generate one
      document: doc.document,
    }));

    const { batchId, totalBatches, totalDocuments } =
      await this.bulkIndexingService.queueBulkIndexing(index, documents, {
        batchSize: 1000,
        skipDuplicates: true,
        enableProgress: true,
        priority: 5,
      });

    return {
      took: Date.now() - startTime,
      errors: false,
      items: documents.map(doc => ({
        id: doc.id,
        index,
        success: true,
        status: HttpStatus.ACCEPTED,
        batchId,
      })),
      successCount: totalDocuments,
    };
  }

  @Post('_delete_by_query')
  @ApiOperation({
    summary: 'Delete documents by query',
    description: 'Deletes all documents that match the specified query',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiBody({
    type: DeleteByQueryDto,
    description: 'Query to match documents for deletion',
    examples: {
      term: {
        summary: 'Delete by term match',
        value: {
          query: {
            term: {
              field: 'categories',
              value: 'discontinued',
            },
          },
        },
      },
      range: {
        summary: 'Delete by range condition',
        value: {
          query: {
            range: {
              field: 'price',
              lt: 10.0,
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Documents deleted successfully',
    schema: {
      type: 'object',
      properties: {
        took: { type: 'number', example: 75 },
        deleted: { type: 'number', example: 5 },
        failures: {
          type: 'array',
          items: { type: 'object' },
          example: [],
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query structure',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Specified index does not exist',
  })
  async deleteByQuery(
    @Param('index') index: string,
    @Body(ValidationPipe) deleteByQueryDto: DeleteByQueryDto,
  ): Promise<DeleteByQueryResponseDto> {
    return this.documentService.deleteByQuery(index, deleteByQueryDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List documents in an index',
    description: 'Retrieves a paginated list of documents from the specified index',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Number of documents to return',
    required: false,
    type: Number,
    example: 10,
  })
  @ApiQuery({
    name: 'offset',
    description: 'Number of documents to skip',
    required: false,
    type: Number,
    example: 0,
  })
  @ApiQuery({
    name: 'filter',
    description: 'Filter criteria',
    required: false,
    type: 'object',
    example: { category: 'electronics' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns a paginated list of documents',
    type: ListDocumentsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Index not found',
  })
  async listDocuments(
    @Param('index') index: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('filter') filter?: string,
  ): Promise<ListDocumentsResponseDto> {
    const options = {
      limit,
      offset,
      filter: filter ? JSON.parse(filter) : undefined,
    };

    return this.documentService.listDocuments(index, options);
  }
}
