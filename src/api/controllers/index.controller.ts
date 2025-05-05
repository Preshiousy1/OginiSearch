import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  ValidationPipe,
} from '@nestjs/common';
import {
  CreateIndexDto,
  UpdateIndexSettingsDto,
  IndexResponseDto,
  IndexListResponseDto,
} from '../dtos/index.dto';
import { IndexService } from '../../index/index.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('indices')
@ApiBearerAuth('JWT-auth')
@Controller('api/indices')
export class IndexController {
  constructor(private readonly indexService: IndexService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new index' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Index created successfully',
    type: IndexResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid index configuration' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Index with this name already exists' })
  async createIndex(
    @Body(ValidationPipe) createIndexDto: CreateIndexDto,
  ): Promise<IndexResponseDto> {
    return this.indexService.createIndex(createIndexDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all indices' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns all indices',
    type: IndexListResponseDto,
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by index status' })
  async listIndices(@Query('status') status?: string): Promise<IndexListResponseDto> {
    const indices = await this.indexService.listIndices(status);
    return {
      indices,
      total: indices.length,
    };
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get index details' })
  @ApiParam({ name: 'name', description: 'Index name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns index details',
    type: IndexResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async getIndex(@Param('name') name: string): Promise<IndexResponseDto> {
    return this.indexService.getIndex(name);
  }

  @Put(':name/settings')
  @ApiOperation({ summary: 'Update index settings' })
  @ApiParam({ name: 'name', description: 'Index name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Index updated successfully',
    type: IndexResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async updateIndex(
    @Param('name') name: string,
    @Body(ValidationPipe) updateIndexSettingsDto: UpdateIndexSettingsDto,
  ): Promise<IndexResponseDto> {
    return this.indexService.updateIndexSettings(name, updateIndexSettingsDto.settings);
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete an index' })
  @ApiParam({ name: 'name', description: 'Index name' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Index deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Index not found' })
  async deleteIndex(@Param('name') name: string): Promise<void> {
    await this.indexService.deleteIndex(name);
  }
}
