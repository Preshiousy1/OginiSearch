import {
  Controller,
  Post,
  Body,
  Param,
  HttpStatus,
  ValidationPipe,
  Query,
  BadRequestException,
  Delete,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  SearchQueryDto,
  SearchResponseDto,
  SuggestQueryDto,
  SuggestResponseDto,
} from '../dtos/search.dto';
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
import { SearchService } from '../../search/search.service';
import { Logger } from '@nestjs/common';

@ApiTags('Search')
@ApiExtraModels(SearchQueryDto, SuggestQueryDto)
@ApiBearerAuth('JWT-auth')
@Controller('api/indices/:index/_search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {}

  @Post()
  @ApiOperation({
    summary: 'Search documents',
    description:
      'Searches for documents in an index that match the specified query. Supports various query types, filters, and pagination.',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name to search in',
    example: 'businesses',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Number of results to return',
    example: 10,
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Starting offset for pagination',
    example: 0,
  })
  @ApiBody({
    type: SearchQueryDto,
    description: 'Search query parameters',
    examples: {
      match: {
        summary: 'Match query',
        value: {
          query: {
            match: {
              field: 'title',
              value: 'smartphone',
            },
          },
          size: 10,
          from: 0,
        },
      },
      match_all: {
        summary: 'Match all documents',
        value: {
          query: {
            match_all: {
              boost: 1.0,
            },
          },
          size: 10,
        },
      },
      match_all_string: {
        summary: 'Match all using string query',
        value: {
          query: '*',
          size: 10,
        },
      },
      match_all_empty: {
        summary: 'Match all using empty string (auto-detected)',
        value: {
          query: {
            match: {
              value: '',
            },
          },
          size: 10,
        },
      },
      wildcard: {
        summary: 'Wildcard query (object format)',
        value: {
          query: {
            wildcard: {
              field: 'title',
              value: 'smart*',
            },
          },
          size: 10,
        },
      },
      wildcard_string_prefix: {
        summary: 'Wildcard string query (prefix pattern)',
        value: {
          query: 'video*',
          size: 10,
        },
      },
      wildcard_string_contains: {
        summary: 'Wildcard string query (contains pattern)',
        value: {
          query: '*wireless*',
          size: 10,
        },
      },
      wildcard_string_suffix: {
        summary: 'Wildcard string query (suffix pattern)',
        value: {
          query: '*phone',
          size: 10,
        },
      },
      wildcard_auto_detect: {
        summary: 'Auto-detected wildcard in match query',
        value: {
          query: {
            match: {
              field: 'category',
              value: 'elect*',
            },
          },
          size: 10,
        },
      },
      wildcard_pattern: {
        summary: 'Complex wildcard pattern',
        value: {
          query: {
            wildcard: {
              title: {
                value: 'smart*phone?',
                boost: 1.5,
              },
            },
          },
          size: 10,
        },
      },
      wildcard_multi_pattern: {
        summary: 'Multiple wildcard characters',
        value: {
          query: {
            wildcard: {
              field: 'sku',
              value: 'PROD-??-*-2024',
            },
          },
          size: 10,
        },
      },
      wildcard_question_mark: {
        summary: 'Single character wildcard',
        value: {
          query: {
            wildcard: {
              field: 'status',
              value: 'activ?',
            },
          },
          size: 10,
        },
      },
      wildcard_field_specific: {
        summary: 'Field-specific wildcard object notation',
        value: {
          query: {
            wildcard: {
              email: {
                value: '*@company.com',
                boost: 2.0,
              },
            },
          },
          size: 10,
        },
      },
      term: {
        summary: 'Term query with filter',
        value: {
          query: {
            match: {
              field: 'description',
              value: 'high performance',
            },
          },
          filter: {
            term: {
              field: 'categories',
              value: 'electronics',
            },
          },
          size: 20,
        },
      },
      multiField: {
        summary: 'Search across multiple fields',
        value: {
          query: {
            match: {
              value: 'wireless headphones',
            },
          },
          fields: ['title', 'description'],
          size: 10,
        },
      },
      multiField_wildcard: {
        summary: 'Wildcard search across multiple fields',
        value: {
          query: {
            match: {
              value: 'smart*',
            },
          },
          fields: ['title', 'description', 'tags'],
          size: 10,
        },
      },
      complex_filter: {
        summary: 'Complex query with filter and sorting',
        value: {
          query: {
            wildcard: {
              field: 'title',
              value: '*phone*',
            },
          },
          filter: {
            range: {
              field: 'price',
              gte: 100,
              lte: 1000,
            },
          },
          sort: 'price:asc',
          size: 20,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Search results',
    schema: {
      type: 'object',
      properties: {
        hits: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 5 },
            maxScore: { type: 'number', example: 0.9567 },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'product-123' },
                  score: { type: 'number', example: 0.9567 },
                  source: {
                    type: 'object',
                    example: {
                      title: 'Wireless Bluetooth Headphones',
                      description: 'High quality audio with noise cancellation',
                      price: 159.99,
                      categories: ['electronics', 'audio'],
                    },
                  },
                },
              },
            },
          },
        },
        took: { type: 'number', example: 15 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query structure',
  })
  @ApiResponse({
    status: 404,
    description: 'Index not found',
  })
  async search(@Param('index') index: string, @Body() searchDto: SearchQueryDto) {
    if (!searchDto) {
      throw new BadRequestException('Search query is required');
    }

    console.log('search payload', searchDto, 'filter', searchDto.filter.bool.must);

    // Convert to appropriate SearchQueryDto format if necessary
    // This handles both string and object formats for backward compatibility
    if (typeof searchDto.query === 'string') {
      this.logger.log(`Processing string query: ${searchDto.query}`);
    } else {
      this.logger.log(`Processing object query: ${JSON.stringify(searchDto.query)}`);
    }

    try {
      const result = await this.searchService.search(index, searchDto);
      this.logger.log(
        `Search completed for index '${index}': Found ${result.data.total} results in ${result.took}ms`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Search error for index '${index}': ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('_suggest')
  @ApiOperation({
    summary: 'Get suggestions',
    description:
      'Returns search suggestions based on partial text input. Useful for implementing autocomplete functionality.',
  })
  @ApiParam({
    name: 'index',
    description: 'Index name',
    example: 'businesses',
  })
  @ApiBody({
    type: SuggestQueryDto,
    description: 'Suggestion query parameters',
    examples: {
      simple: {
        summary: 'Basic suggestion',
        value: {
          text: 'phon',
          field: 'title',
          size: 5,
        },
      },
      noField: {
        summary: 'Suggestion without specific field',
        value: {
          text: 'lapt',
          size: 3,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestions matching the input text',
    schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: ['phone', 'smartphone', 'headphone'],
        },
        took: { type: 'number', example: 5 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input',
  })
  @ApiResponse({
    status: 404,
    description: 'Index not found',
  })
  async suggest(@Param('index') index: string, @Body() suggestDto: SuggestQueryDto) {
    if (!suggestDto || !suggestDto.text) {
      throw new BadRequestException('Suggest query text is required');
    }

    try {
      const startTime = Date.now();
      const suggestions = await this.searchService.suggest(index, suggestDto);
      const took = Date.now() - startTime;

      return {
        suggestions,
        took,
      };
    } catch (error) {
      this.logger.error(`Error in suggest endpoint: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to get suggestions: ${error.message}`);
    }
  }
}
