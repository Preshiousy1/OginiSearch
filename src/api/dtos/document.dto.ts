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
    name: 'id',
    example: '123',
    description: 'Unique identifier for the document',
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({
    name: 'document',
    example: { name: 'John Doe', age: 30 },
    description: 'Document content',
  })
  @IsObject()
  @IsNotEmpty()
  document: Record<string, any>;
}

export class BulkIndexDocumentsDto {
  @ApiProperty({
    name: 'documents',
    example: [{ id: '123', document: { name: 'John Doe', age: 30 } }],
    description: 'Array of documents to index',
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
    name: 'errors',
    example: false,
    description: 'Whether there were any errors during indexing',
  })
  errors: boolean;
}

export class DeleteByQueryDto {
  @ApiProperty({
    name: 'query',
    example: '{ "match": { "name": "John" } }',
    description: 'Query to delete documents',
  })
  @IsString()
  @IsNotEmpty()
  query: string;
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
