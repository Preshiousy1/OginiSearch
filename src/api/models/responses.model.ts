import { ApiProperty } from '@nestjs/swagger';

export class IndexSettingsModel {
  @ApiProperty({ example: 1 })
  numberOfShards: number;

  @ApiProperty({ example: '1s' })
  refreshInterval: string;
}

export class IndexMappingsModel {
  @ApiProperty({
    example: {
      title: { type: 'text', analyzer: 'standard' },
      description: { type: 'text' },
      price: { type: 'number' },
      categories: { type: 'keyword' },
    },
  })
  properties: Record<string, any>;
}

export class IndexResponseModel {
  @ApiProperty({ example: 'businesses' })
  name: string;

  @ApiProperty({ example: 'open' })
  status: string;

  @ApiProperty({ example: 157 })
  documentCount: number;

  @ApiProperty()
  settings: IndexSettingsModel;

  @ApiProperty()
  mappings: IndexMappingsModel;

  @ApiProperty({ example: '2023-06-15T10:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2023-06-15T15:30:00Z' })
  updatedAt: string;
}

export class SearchHitModel {
  @ApiProperty({ example: 'product-123' })
  id: string;

  @ApiProperty({ example: 0.9567 })
  score: number;

  @ApiProperty({
    example: {
      title: 'Smartphone X',
      description: 'Latest smartphone with advanced features',
      price: 999.99,
      categories: ['electronics', 'mobile'],
    },
  })
  source: Record<string, any>;
}

export class SearchHitsModel {
  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 0.9567 })
  maxScore: number;

  @ApiProperty({ type: [SearchHitModel] })
  hits: SearchHitModel[];
}

export class SearchResponseModel {
  @ApiProperty()
  hits: SearchHitsModel;

  @ApiProperty({
    example: {
      categories: {
        buckets: [
          { key: 'electronics', doc_count: 3 },
          { key: 'mobile', doc_count: 2 },
        ],
      },
    },
    required: false,
  })
  facets?: Record<string, any>;

  @ApiProperty({ example: 15 })
  took: number;
}

export class SuggestResponseModel {
  @ApiProperty({ example: ['phone', 'smartphone', 'headphone'] })
  suggestions: string[];

  @ApiProperty({ example: 5 })
  took: number;
}

export class DocumentResponseModel {
  @ApiProperty({ example: 'product-123' })
  id: string;

  @ApiProperty({ example: 'businesses' })
  index: string;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({ example: 'created' })
  result: string;
}

export class BulkResponseModel {
  @ApiProperty({ example: 125 })
  took: number;

  @ApiProperty({ example: false })
  errors: boolean;

  @ApiProperty({ type: [DocumentResponseModel] })
  items: DocumentResponseModel[];
}

export class DeleteByQueryResponseModel {
  @ApiProperty({ example: 75 })
  took: number;

  @ApiProperty({ example: 5 })
  deleted: number;

  @ApiProperty({ type: [Object], example: [] })
  failures: any[];
}
