import { Controller, Post, Body, Param, HttpStatus, ValidationPipe } from '@nestjs/common';
import {
  SearchQueryDto,
  SearchResponseDto,
  SuggestQueryDto,
  SuggestResponseDto,
} from '../dtos/search.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from '../../search/search.service';

@ApiTags('search')
@ApiBearerAuth('JWT-auth')
@Controller('api/indices/:index/_search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  @ApiOperation({ summary: 'Search documents in an index' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Search results', type: SearchResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid search query' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async search(
    @Param('index') index: string,
    @Body(ValidationPipe) searchQueryDto: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const startTime = Date.now();
    const results = await this.searchService.search(index, searchQueryDto);
    const took = Date.now() - startTime;

    return {
      data: results.data,
      facets: results.facets,
      took,
    };
  }

  @Post('_suggest')
  @ApiOperation({ summary: 'Get suggestions based on text' })
  @ApiParam({ name: 'index', description: 'Index name' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Suggestions', type: SuggestResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid suggest query' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async suggest(
    @Param('index') index: string,
    @Body(ValidationPipe) suggestQueryDto: SuggestQueryDto,
  ): Promise<SuggestResponseDto> {
    const startTime = Date.now();
    const suggestions = await this.searchService.suggest(index, suggestQueryDto);
    const took = Date.now() - startTime;

    return {
      suggestions,
      took,
    };
  }
}
