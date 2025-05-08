import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
  IsIn,
  IsBooleanString,
} from 'class-validator';
import { FieldMapping, IndexMappings, IndexSettings } from '../../index/interfaces/index.interface';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class IndexSettingsDto {
  @ApiProperty({
    description: 'Number of primary shards',
    required: false,
    example: 1,
  })
  @IsOptional()
  numberOfShards?: number;

  @ApiProperty({
    description: 'Index refresh interval',
    required: false,
    example: '1s',
  })
  @IsOptional()
  refreshInterval?: string;
}

export class FieldMappingDto implements FieldMapping {
  @ApiProperty({
    description: 'Field type (text, keyword, number, etc.)',
    example: 'text',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['text', 'keyword', 'integer', 'float', 'date', 'boolean', 'object', 'nested'])
  type: FieldMapping['type'];

  @ApiProperty({
    description: 'Text analyzer to use for this field',
    required: false,
    example: 'standard',
  })
  @IsOptional()
  @IsString()
  analyzer?: string;

  @ApiProperty({
    description: 'Relevance boost factor for this field',
    required: false,
    example: 2.0,
  })
  @IsOptional()
  boost?: number;

  searchAnalyzer?: string;
  store?: boolean;
  index?: boolean;
  fields?: Record<string, FieldMapping>; // For multi-fields
}

export class MappingsDto implements IndexMappings {
  @ApiProperty()
  @IsOptional()
  @IsString()
  dynamic?: boolean | 'strict' | 'runtime';

  @ApiProperty({
    description: 'Document field definitions',
    example: {
      title: { type: 'text', analyzer: 'standard' },
      description: { type: 'text' },
      price: { type: 'number' },
      categories: { type: 'keyword' },
    },
  })
  @IsObject()
  properties: Record<string, FieldMappingDto>;
}

export class CreateIndexDto {
  @ApiProperty({
    description: 'Unique name for the index',
    example: 'products',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Index configuration settings',
    required: false,
    type: IndexSettingsDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IndexSettingsDto)
  settings?: IndexSettingsDto;

  @ApiProperty({
    description: 'Field mappings configuration',
    required: false,
    type: MappingsDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MappingsDto)
  mappings?: MappingsDto;
}

export class UpdateIndexDto {
  @ApiProperty({
    description: 'Updated index settings',
    required: false,
    type: IndexSettingsDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IndexSettingsDto)
  settings?: Partial<IndexSettingsDto>;

  @ApiProperty({
    description: 'Updated field mappings',
    required: false,
    type: MappingsDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MappingsDto)
  mappings?: Partial<MappingsDto>;
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
