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
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SearchQueryDto {
  @ApiProperty({
    name: 'query',
    example: 'John Doe',
    description: 'Search query',
  })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiProperty({
    name: 'fields',
    example: ['title', 'content'],
    description: 'Fields to search in',
  })
  @IsArray()
  @IsOptional()
  fields?: string[];

  @ApiProperty({
    name: 'from',
    example: 0,
    description: 'Starting index',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  from?: number = 0;

  @ApiProperty({
    name: 'size',
    example: 10,
    description: 'Number of results to return',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  size?: number = 10;

  @ApiProperty({
    name: 'sort',
    example: 'title:desc',
    description: 'Sorting criteria',
  })
  @IsString()
  @IsOptional()
  sort?: string;

  @ApiProperty({
    name: 'filter',
    example: { title: 'John' },
    description: 'Filter criteria',
  })
  @IsObject()
  @IsOptional()
  filter?: Record<string, any>;

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
    name: 'text',
    example: 'John Doe',
    description: 'Text to suggest',
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    name: 'field',
    example: 'title',
    description: 'Field to suggest',
  })
  @IsString()
  @IsOptional()
  field?: string = 'title';

  @ApiProperty({
    name: 'size',
    example: 5,
    description: 'Number of suggestions to return',
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  size?: number = 5;
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
