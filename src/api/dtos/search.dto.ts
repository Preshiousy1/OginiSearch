import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
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
      string: 'smartphone',
    },
  })
  @IsObject()
  @IsNotEmpty()
  query:
    | {
        match?: MatchQueryDto;
        match_all?: MatchAllQueryDto;
        wildcard?: WildcardQueryDto | Record<string, { value: string; boost?: number }>;
        term?: Record<string, any>;
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
}

export class SearchResponseDto {
  @ApiProperty({
    name: 'data',
    example: {
      total: 10,
      maxScore: 1.0,
      hits: [{ id: '123', index: 'my-index', score: 1.0, source: { name: 'John Doe' } }],
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

export class SuggestResponseDto {
  @ApiProperty({
    name: 'suggestions',
    example: [{ text: 'John', score: 1.0, freq: 10 }],
    description: 'Suggestions',
  })
  suggestions: Array<{
    text: string;
    score: number;
    freq: number;
  }>;

  @ApiProperty({
    name: 'took',
    example: 100,
    description: 'Time taken to suggest in milliseconds',
  })
  took: number;
}
