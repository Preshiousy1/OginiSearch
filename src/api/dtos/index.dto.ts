import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { IndexMappings, IndexSettings } from '../../index/interfaces/index.interface';
import { ApiProperty } from '@nestjs/swagger';

export class CreateIndexDto {
  @ApiProperty({ name: 'name', example: 'my-index', description: 'Name of the index' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    name: 'settings',
    example: { numberOfShards: 1, refreshInterval: '1s' },
    description: 'Index settings',
  })
  @IsOptional()
  @IsObject()
  settings?: IndexSettings;

  @ApiProperty({
    name: 'mappings',
    example: {
      properties: {
        title: { type: 'text', analyzer: 'standard' },
        content: { type: 'text', analyzer: 'standard' },
        tags: { type: 'keyword' },
      },
    },
    description: 'Index mappings',
  })
  @IsOptional()
  @IsObject()
  mappings?: IndexMappings;
}

export class UpdateIndexSettingsDto {
  @ApiProperty({
    name: 'settings',
    example: { numberOfShards: 1, refreshInterval: '1s' },
    description: 'Index settings',
  })
  @IsObject()
  @IsNotEmpty()
  settings: {
    numberOfShards?: number;
    refreshInterval?: string;
  };
}

export class IndexResponseDto {
  @ApiProperty({ name: 'name', example: 'my-index', description: 'Name of the index' })
  name: string;

  @ApiProperty({
    name: 'createdAt',
    example: '2021-01-01T00:00:00.000Z',
    description: 'Creation date',
  })
  createdAt: Date;

  @ApiProperty({
    name: 'documentCount',
    example: 100,
    description: 'Number of documents in the index',
  })
  documentCount: number;

  @ApiProperty({
    name: 'settings',
    example: { numberOfShards: 1, refreshInterval: '1s' },
    description: 'Index settings',
  })
  settings: any;

  @ApiProperty({
    name: 'mappings',
    example: { mappings: {} },
    description: 'Index mappings',
  })
  mappings: any;

  @ApiProperty({
    name: 'status',
    example: 'open',
    description: 'Status of the index',
  })
  status: 'open' | 'closed' | 'creating' | 'deleting';
}

export class IndexListResponseDto {
  @ApiProperty({
    name: 'indices',
    example: [
      {
        name: 'my-index',
        createdAt: '2021-01-01T00:00:00.000Z',
        documentCount: 100,
        settings: { numberOfShards: 1, refreshInterval: '1s' },
        mappings: { mappings: {} },
        status: 'open',
      },
    ],
    description: 'List of indices',
  })
  indices: IndexResponseDto[];

  @ApiProperty({
    name: 'total',
    example: 1,
    description: 'Total number of indices',
  })
  total: number;
}
