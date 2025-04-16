import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Put,
  Delete,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SchemaVersionManagerService } from './schema-version-manager.service';
import { Schema, ValidationResult } from './interfaces/schema.interface';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';

@ApiTags('schemas')
@Controller('schemas')
export class SchemaController {
  constructor(private readonly schemaService: SchemaVersionManagerService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new schema' })
  @ApiResponse({ status: 201, description: 'Schema created successfully' })
  async createSchema(@Body() schema: Omit<Schema, 'created' | 'version'>): Promise<Schema> {
    return this.schemaService.registerSchema(schema);
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get a schema by name and optional version' })
  @ApiParam({ name: 'name', description: 'Schema name' })
  @ApiQuery({ name: 'version', description: 'Schema version', required: false })
  @ApiResponse({ status: 200, description: 'Schema found' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async getSchema(
    @Param('name') name: string,
    @Query('version') version?: number,
  ): Promise<Schema> {
    const schema = await this.schemaService.getSchema(name, version);
    if (!schema) {
      throw new NotFoundException(`Schema '${name}' not found`);
    }
    return schema;
  }

  @Get(':name/versions')
  @ApiOperation({ summary: 'Get all versions of a schema' })
  @ApiParam({ name: 'name', description: 'Schema name' })
  @ApiResponse({ status: 200, description: 'List of schema versions' })
  async getSchemaVersions(@Param('name') name: string): Promise<Schema[]> {
    return this.schemaService.getSchemaVersions(name);
  }

  @Put(':name')
  @ApiOperation({ summary: 'Update a schema (creates a new version)' })
  @ApiParam({ name: 'name', description: 'Schema name' })
  @ApiResponse({ status: 200, description: 'Schema updated' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async updateSchema(
    @Param('name') name: string,
    @Body() update: Partial<Omit<Schema, 'name' | 'version' | 'created'>>,
  ): Promise<Schema> {
    return this.schemaService.updateSchema(name, update);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a schema or a specific version' })
  @ApiParam({ name: 'name', description: 'Schema name' })
  @ApiQuery({ name: 'version', description: 'Schema version (optional)', required: false })
  @ApiResponse({ status: 204, description: 'Schema deleted' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async deleteSchema(
    @Param('name') name: string,
    @Query('version') version?: number,
  ): Promise<void> {
    const deleted = await this.schemaService.deleteSchema(name, version);
    if (!deleted) {
      throw new NotFoundException(`Schema '${name}' not found`);
    }
  }

  @Post(':name/validate')
  @ApiOperation({ summary: 'Validate a document against a schema' })
  @ApiParam({ name: 'name', description: 'Schema name' })
  @ApiQuery({ name: 'version', description: 'Schema version (optional)', required: false })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateDocument(
    @Param('name') name: string,
    @Body() document: any,
    @Query('version') version?: number,
  ): Promise<ValidationResult> {
    return this.schemaService.validateDocument(name, document, version);
  }

  @Get()
  @ApiOperation({ summary: 'List all schemas' })
  @ApiResponse({ status: 200, description: 'List of schemas' })
  async getAllSchemas(): Promise<Schema[]> {
    const schemas = await this.schemaService.getAllSchemas();
    return schemas;
  }
}
