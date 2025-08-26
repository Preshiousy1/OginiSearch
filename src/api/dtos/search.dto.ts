import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MatchQueryDto {
  @ApiProperty({
    description: 'Field to search in (optional if fields array is provided)',
    required: false,
    example: 'title',
  })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiProperty({
    description: 'Text to search for',
    example: 'smartphone',
  })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class MatchAllQueryDto {
  @ApiProperty({
    description: 'Boost factor for match-all query',
    required: false,
    example: 1.0,
  })
  @IsOptional()
  @IsNumber()
  boost?: number;
}

export class WildcardQueryDto {
  @ApiProperty({
    description: 'Field to search in (optional for wildcard across all fields)',
    required: false,
    example: 'title',
  })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiProperty({
    description: 'Wildcard pattern (* for multiple chars, ? for single char)',
    examples: {
      prefix: 'smart*',
      suffix: '*phone',
      contains: '*wireless*',
      single_char: 'activ?',
      complex: '*smart?phone*',
      sku_pattern: 'PROD-??-*-2024',
      email_domain: '*@company.com',
    },
    example: 'smart*',
  })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({
    description: 'Boost factor for wildcard query',
    required: false,
    example: 1.0,
  })
  @IsOptional()
  @IsNumber()
  boost?: number;
}

export class BoolQueryDto {
  @ApiProperty({
    description: 'Must match conditions (AND)',
    required: false,
    example: [{ match: { field: 'title', value: 'smartphone' } }],
  })
  @IsOptional()
  @IsArray()
  must?: Array<{ match?: MatchQueryDto; term?: Record<string, any> }>;

  @ApiProperty({
    description: 'Should match conditions (OR)',
    required: false,
    example: [{ match: { field: 'description', value: 'wireless' } }],
  })
  @IsOptional()
  @IsArray()
  should?: Array<{ match?: MatchQueryDto; term?: Record<string, any> }>;

  @ApiProperty({
    description: 'Must not match conditions (NOT)',
    required: false,
    example: [{ match: { field: 'status', value: 'discontinued' } }],
  })
  @IsOptional()
  @IsArray()
  must_not?: Array<{ match?: MatchQueryDto; term?: Record<string, any> }>;
}

export class RangeQueryDto {
  @ApiProperty({
    description: 'Field to apply range query on',
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
  @IsNumber()
  gt?: number;

  @ApiProperty({
    description: 'Greater than or equal to value',
    required: false,
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  gte?: number;

  @ApiProperty({
    description: 'Less than value',
    required: false,
    example: 1000,
  })
  @IsOptional()
  @IsNumber()
  lt?: number;

  @ApiProperty({
    description: 'Less than or equal to value',
    required: false,
    example: 1000,
  })
  @IsOptional()
  @IsNumber()
  lte?: number;
}

export class SearchQueryDto {
  @ApiProperty({
    description: 'Search query definition',
    examples: {
      match: {
        match: {
          field: 'title',
          value: 'smartphone',
        },
      },
      match_all: {
        match_all: {
          boost: 1.0,
        },
      },
      wildcard: {
        wildcard: {
          field: 'title',
          value: 'smart*',
        },
      },
      term: {
        term: {
          categories: 'electronics',
        },
      },
      bool: {
        bool: {
          must: [{ match: { field: 'title', value: 'smartphone' } }, { term: { inStock: true } }],
          should: [{ match: { field: 'description', value: 'wireless' } }],
        },
      },
      range: {
        range: {
          field: 'price',
          gte: 100,
          lte: 1000,
        },
      },
      string_simple: 'smartphone',
    },
  })
  @IsNotEmpty()
  query:
    | {
        match?: MatchQueryDto;
        match_all?: MatchAllQueryDto;
        wildcard?: WildcardQueryDto | Record<string, { value: string; boost?: number }>;
        term?: Record<string, any>;
        bool?: BoolQueryDto;
        range?: RangeQueryDto;
      }
    | string;

  @ApiProperty({
    description: 'Number of results to return',
    required: false,
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  size?: number;

  @ApiProperty({
    description: 'Starting offset for pagination',
    required: false,
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  from?: number;

  @ApiProperty({
    description: 'Fields to search in (for multi-field search)',
    required: false,
    example: ['title', 'description'],
  })
  @IsOptional()
  @IsArray()
  fields?: string[];

  @ApiProperty({
    description: 'Additional filter criteria',
    required: false,
    example: {
      term: {
        field: 'categories',
        value: 'electronics',
      },
    },
  })
  @IsOptional()
  @IsObject()
  filter?: Record<string, any>;

  @ApiProperty({
    name: 'sort',
    example: 'title:desc',
    description: 'Sorting criteria',
  })
  @IsString()
  @IsOptional()
  sort?: string;

  @ApiProperty({
    name: 'highlight',
    example: false,
    description: 'Whether to highlight the search query',
  })
  @IsBoolean()
  @IsOptional()
  highlight?: boolean = false;

  @ApiProperty({
    name: 'facets',
    example: ['title', 'content'],
    description: 'Facets to return',
  })
  @IsArray()
  @IsOptional()
  facets?: string[];

  @ApiProperty({
    name: 'userLocation',
    example: { lat: 6.5244, lng: 3.3792 },
    description: 'User location coordinates for geographic filtering',
    required: false,
  })
  @IsOptional()
  @IsObject()
  userLocation?: { lat: number; lng: number };
}

export class SearchResponseDto {
  @ApiProperty({
    name: 'data',
    example: {
      total: 10,
      maxScore: 1.0,
      hits: [{ id: '123', index: 'my-index', score: 1.0, source: { name: 'John Doe' } }],
      pagination: {
        currentPage: 1,
        totalPages: 5,
        pageSize: 10,
        hasNext: true,
        hasPrevious: false,
        totalResults: 50,
      },
    },
    description: 'Search results',
  })
  data: {
    total: number;
    maxScore: number;
    hits: Array<{
      id: string;
      index: string;
      score: number;
      source: Record<string, any>;
      highlight?: Record<string, string[]>;
    }>;
    pagination?: {
      currentPage: number;
      totalPages: number;
      pageSize: number;
      hasNext: boolean;
      hasPrevious: boolean;
      totalResults: number;
    };
  };

  @ApiProperty({
    name: 'facets',
    example: { title: { buckets: [{ key: 'John', count: 10 }] } },
    description: 'Facets',
  })
  facets?: Record<
    string,
    {
      buckets: Array<{
        key: string;
        count: number;
      }>;
    }
  >;

  @ApiProperty({
    name: 'took',
    example: 100,
    description: 'Time taken to search in milliseconds',
  })
  took: number;
}

export class SuggestQueryDto {
  @ApiProperty({
    description: 'Text to get suggestions for',
    example: 'phon',
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    description: 'Field to get suggestions from',
    required: false,
    example: 'title',
  })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiProperty({
    description: 'Maximum number of suggestions to return',
    required: false,
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  size?: number;
}

export class SuggestionResultDto {
  @ApiProperty({ description: 'Suggestion text', example: 'Director A mola B.A' })
  text: string;

  @ApiProperty({ description: 'Document ID', example: '123' })
  id: string;

  @ApiProperty({ description: 'Category', example: 'Business', required: false })
  category?: string;
}

export class SuggestResponseDto {
  @ApiProperty({
    name: 'suggestions',
    example: [
      { text: 'John', id: '123', category: 'Business' },
      { text: 'Jane', id: '456', category: 'Deals' },
    ],
    description: 'Suggestions',
    type: [SuggestionResultDto],
  })
  suggestions: SuggestionResultDto[];

  @ApiProperty({
    name: 'took',
    example: 100,
    description: 'Time taken to suggest in milliseconds',
  })
  took: number;
}
