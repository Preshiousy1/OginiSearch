import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class IndexDocumentDto {
  @ApiProperty({
    description: 'Document ID (will be auto-generated if not provided)',
    required: false,
    example: 'product-123',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: 'Document content to be indexed',
    example: {
      title: 'Smartphone X',
      description: 'Latest smartphone with advanced features',
      price: 999.99,
      categories: ['electronics', 'mobile'],
    },
  })
  @IsObject()
  @IsNotEmpty()
  document: Record<string, any>;
}

export class BulkIndexDocumentsDto {
  @ApiProperty({
    description: 'Array of documents to index in bulk',
    type: [IndexDocumentDto],
    example: [
      {
        id: 'product-123',
        document: {
          title: 'Smartphone X',
          price: 999.99,
        },
      },
      {
        id: 'product-124',
        document: {
          title: 'Laptop Pro',
          price: 1499.99,
        },
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndexDocumentDto)
  documents: IndexDocumentDto[];
}

export class DocumentResponseDto {
  @ApiProperty({
    name: 'id',
    example: 'de256456-4564-4564-4564-456456456456',
    description: 'Unique identifier for the document',
  })
  id: string;

  @ApiProperty({
    name: 'index',
    example: 'my-index',
    description: 'Index name',
  })
  index: string;

  @ApiProperty({
    name: 'version',
    example: 1,
    description: 'Document version',
  })
  version: number;

  @ApiProperty({
    name: 'error',
    example: 'Document not found',
    description: 'Error message',
  })
  error?: string;

  @ApiProperty({
    name: 'found',
    example: true,
    description: 'Whether the document was found',
  })
  found: boolean;

  @ApiProperty({
    name: 'source',
    example: { name: 'John Doe', age: 30 },
    description: 'Document source',
  })
  source: Record<string, any>;
}

export class BulkResponseDto {
  @ApiProperty({
    name: 'items',
    example: [{ id: '123', index: 'my-index', success: true, status: 200 }],
    description: 'Array of document responses',
  })
  items: {
    id: string;
    index: string;
    success: boolean;
    status: number;
    error?: string;
  }[];

  @ApiProperty({
    name: 'took',
    example: 100,
    description: 'Time taken to index the documents in milliseconds',
  })
  took: number;

  @ApiProperty({
    name: 'successCount',
    example: 1,
    description: 'Number of documents indexed successfully',
  })
  successCount: number;

  @ApiProperty({
    name: 'errors',
    example: false,
    description: 'Whether there were any errors during indexing',
  })
  errors: boolean;
}

export class TermQueryDto {
  @ApiProperty({
    description: 'Field to filter on',
    example: 'categories',
  })
  @IsString()
  @IsNotEmpty()
  field: string;

  @ApiProperty({
    description: 'Value to match',
    example: 'electronics',
  })
  @IsNotEmpty()
  value: string | number | boolean;
}

export class RangeQueryDto {
  @ApiProperty({
    description: 'Field to apply range filter',
    example: 'price',
  })
  @IsString()
  @IsNotEmpty()
  field: string;

  @ApiProperty({
    description: 'Greater than value',
    required: false,
    example: 100,
  })
  @IsOptional()
  gt?: number;

  @ApiProperty({
    description: 'Greater than or equal value',
    required: false,
    example: 100,
  })
  @IsOptional()
  gte?: number;

  @ApiProperty({
    description: 'Less than value',
    required: false,
    example: 500,
  })
  @IsOptional()
  lt?: number;

  @ApiProperty({
    description: 'Less than or equal value',
    required: false,
    example: 500,
  })
  @IsOptional()
  lte?: number;
}

export class DeleteByQueryDto {
  @ApiProperty({
    description: 'Query to match documents for deletion',
    example: {
      term: {
        field: 'categories',
        value: 'discontinued',
      },
    },
  })
  @IsObject()
  @IsNotEmpty()
  query: {
    term?: TermQueryDto;
    range?: RangeQueryDto;
  };
}

export class DeleteByQueryResponseDto {
  @ApiProperty({
    name: 'deleted',
    example: 10,
    description: 'Number of documents deleted',
  })
  deleted: number;

  @ApiProperty({
    name: 'took',
    example: 100,
    description: 'Time taken to delete the documents in milliseconds',
  })
  took: number;

  @ApiProperty({
    name: 'failures',
    example: [],
    description: 'Array of failures',
  })
  failures: any[];
}

export class ListDocumentsResponseDto {
  @ApiProperty({
    description: 'Total number of documents in the index',
    example: 100,
  })
  total: number;

  @ApiProperty({
    description: 'Documents returned in this page',
    type: [DocumentResponseDto],
  })
  documents: DocumentResponseDto[];

  @ApiProperty({
    description: 'Time taken to fetch documents in milliseconds',
    example: 50,
  })
  took: number;
}
