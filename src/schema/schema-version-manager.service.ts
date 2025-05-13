import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RocksDBService } from '../storage/rocksdb/rocksdb.service';
import { Schema, ValidationResult } from './interfaces/schema.interface';
import { SchemaValidator } from './utils/schema-validator';

@Injectable()
export class SchemaVersionManagerService {
  private readonly logger = new Logger(SchemaVersionManagerService.name);
  private readonly schemaKeyPrefix = 'schema:';

  constructor(private readonly rocksDBService: RocksDBService) {}

  async registerSchema(schema: Omit<Schema, 'created' | 'version'>): Promise<Schema> {
    const existingVersions = await this.getSchemaVersions(schema.name);
    const newVersion =
      existingVersions.length > 0 ? Math.max(...existingVersions.map(s => s.version)) + 1 : 1;

    const newSchema: Schema = {
      ...schema,
      version: newVersion,
      created: new Date(),
    };

    const key = this.formatSchemaKey(schema.name, newVersion);
    await this.rocksDBService.put(key, newSchema);

    this.logger.log(`Registered schema '${schema.name}' version ${newVersion}`);
    return newSchema;
  }

  async getSchema(name: string, version?: number): Promise<Schema | null> {
    if (version) {
      const key = this.formatSchemaKey(name, version);
      return this.rocksDBService.get(key) as Promise<Schema>;
    }

    // If no version specified, get the latest
    const versions = await this.getSchemaVersions(name);
    if (versions.length === 0) {
      return null;
    }

    // Return the schema with the highest version
    return versions.reduce((latest, current) =>
      current.version > latest.version ? current : latest,
    );
  }

  async getSchemaVersions(name: string): Promise<Schema[]> {
    const prefix = `${this.schemaKeyPrefix}${name}:`;
    const schemas = await this.rocksDBService.getByPrefix(prefix);
    return schemas.map(item => item.value).sort((a, b) => b.version - a.version);
  }

  async validateDocument(
    schemaName: string,
    document: any,
    version?: number,
  ): Promise<ValidationResult> {
    const schema = await this.getSchema(schemaName, version);
    if (!schema) {
      return { valid: false, errors: [`Schema ${schemaName} not found`] };
    }

    return SchemaValidator.validateDocument(schema, document);
  }

  async updateSchema(
    name: string,
    update: Partial<Omit<Schema, 'name' | 'version' | 'created'>>,
  ): Promise<Schema> {
    const currentSchema = await this.getSchema(name);
    if (!currentSchema) {
      throw new NotFoundException(`Schema '${name}' not found`);
    }

    return this.registerSchema({
      name,
      fields: update.fields || currentSchema.fields,
    });
  }

  async deleteSchema(name: string, version?: number): Promise<boolean> {
    if (version) {
      const key = this.formatSchemaKey(name, version);
      await this.rocksDBService.delete(key);
      this.logger.log(`Deleted schema '${name}' version ${version}`);
      return true;
    }

    // Delete all versions
    const versions = await this.getSchemaVersions(name);
    if (versions.length === 0) {
      return false;
    }

    for (const schema of versions) {
      const key = this.formatSchemaKey(name, schema.version);
      await this.rocksDBService.delete(key);
    }

    this.logger.log(`Deleted all versions of schema '${name}'`);
    return true;
  }

  private formatSchemaKey(name: string, version: number): string {
    return `${this.schemaKeyPrefix}${name}:${version}`;
  }

  async getAllSchemas(): Promise<Schema[]> {
    const allSchemas = [];
    const results = await this.rocksDBService.getByPrefix(this.schemaKeyPrefix);

    // Get the latest version of each schema
    const schemasByName = new Map<string, Schema>();
    for (const { value } of results) {
      const schema = value as Schema;
      const existing = schemasByName.get(schema.name);

      if (!existing || existing.version < schema.version) {
        schemasByName.set(schema.name, schema);
      }
    }

    return Array.from(schemasByName.values());
  }
}
