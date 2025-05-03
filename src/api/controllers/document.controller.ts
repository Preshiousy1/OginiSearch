import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  ValidationPipe,
} from '@nestjs/common';
import {
  IndexDocumentDto,
  BulkIndexDocumentsDto,
  DocumentResponseDto,
  BulkResponseDto,
  DeleteByQueryResponseDto,
} from '../dtos/document.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { DocumentService } from '../../document/document.service';
import { SearchQueryDto } from '../dtos/search.dto';

@ApiTags('documents')
@ApiBearerAuth('JWT-auth')
@Controller('api/indices/:index/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({ summary: 'Index a document' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Document indexed successfully',
    type: DocumentResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid document' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async indexDocument(
    @Param('index') index: string,
    @Body(ValidationPipe) indexDocumentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documentService.indexDocument(index, indexDocumentDto);
  }

  @Post('_bulk')
  @ApiOperation({ summary: 'Bulk index documents' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Documents indexed successfully',
    type: BulkResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid documents' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async bulkIndexDocuments(
    @Param('index') index: string,
    @Body(ValidationPipe) bulkIndexDocumentsDto: BulkIndexDocumentsDto,
  ): Promise<BulkResponseDto> {
    return this.documentService.bulkIndexDocuments(index, bulkIndexDocumentsDto.documents);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a document by ID' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Document found', type: DocumentResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Document or index not found' })
  async getDocument(
    @Param('index') index: string,
    @Param('id') id: string,
  ): Promise<DocumentResponseDto> {
    return this.documentService.getDocument(index, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a document' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Document updated successfully',
    type: DocumentResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid document' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Document or index not found' })
  async updateDocument(
    @Param('index') index: string,
    @Param('id') id: string,
    @Body(ValidationPipe) updateDocumentDto: IndexDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documentService.updateDocument(index, id, updateDocumentDto.document);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiParam({ name: 'id', description: 'Document ID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Document deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Document or index not found' })
  async deleteDocument(@Param('index') index: string, @Param('id') id: string): Promise<void> {
    await this.documentService.deleteDocument(index, id);
  }

  @Post('_delete_by_query')
  @ApiOperation({ summary: 'Delete documents by query' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Documents deleted successfully',
    type: DeleteByQueryResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid query' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async deleteByQuery(
    @Param('index') index: string,
    @Body(ValidationPipe) deleteByQueryDto: SearchQueryDto,
  ): Promise<DeleteByQueryResponseDto> {
    return this.documentService.deleteByQuery(index, deleteByQueryDto);
  }
}
