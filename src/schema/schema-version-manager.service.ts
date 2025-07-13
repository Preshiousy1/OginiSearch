import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';
import { Schema, ValidationResult } from './interfaces/schema.interface';
import { SchemaValidator } from './utils/schema-validator';

@Injectable()
export class SchemaVersionManagerService {
  private readonly logger = new Logger(SchemaVersionManagerService.name);

  constructor(private readonly postgresqlService: PostgreSQLService) {
    this.initializeSchemaTable();
  }

  private async initializeSchemaTable(): Promise<void> {
    try {
      await this.postgresqlService.query(`
        CREATE TABLE IF NOT EXISTS schema_versions (
          name VARCHAR(255) NOT NULL,
          version INTEGER NOT NULL,
          schema JSONB NOT NULL,
          created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (name, version)
        );
      `);
    } catch (error) {
      this.logger.error(`Failed to initialize schema table: ${error.message}`);
      throw error;
    }
  }

  async registerSchema(schema: Omit<Schema, 'created' | 'version'>): Promise<Schema> {
    const existingVersions = await this.getSchemaVersions(schema.name);
    const newVersion =
      existingVersions.length > 0 ? Math.max(...existingVersions.map(s => s.version)) + 1 : 1;

    const newSchema: Schema = {
      ...schema,
      version: newVersion,
      created: new Date(),
    };

    await this.postgresqlService.query(
      `
      INSERT INTO schema_versions (name, version, schema, created)
      VALUES ($1, $2, $3, $4)
    `,
      [schema.name, newVersion, newSchema, newSchema.created],
    );

    this.logger.log(`Registered schema '${schema.name}' version ${newVersion}`);
    return newSchema;
  }

  async getSchema(name: string, version?: number): Promise<Schema | null> {
    if (version) {
      const result = await this.postgresqlService.query(
        'SELECT schema FROM schema_versions WHERE name = $1 AND version = $2',
        [name, version],
      );
      return result.rows[0]?.schema || null;
    }

    // If no version specified, get the latest
    const result = await this.postgresqlService.query(
      'SELECT schema FROM schema_versions WHERE name = $1 ORDER BY version DESC LIMIT 1',
      [name],
    );
    return result.rows[0]?.schema || null;
  }

  async getSchemaVersions(name: string): Promise<Schema[]> {
    const result = await this.postgresqlService.query(
      'SELECT schema FROM schema_versions WHERE name = $1 ORDER BY version DESC',
      [name],
    );
    return result.rows.map(row => row.schema);
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
      const result = await this.postgresqlService.query(
        'DELETE FROM schema_versions WHERE name = $1 AND version = $2',
        [name, version],
      );
      this.logger.log(`Deleted schema '${name}' version ${version}`);
      return result.rowCount > 0;
    }

    // Delete all versions
    const result = await this.postgresqlService.query(
      'DELETE FROM schema_versions WHERE name = $1',
      [name],
    );
    this.logger.log(`Deleted all versions of schema '${name}'`);
    return result.rowCount > 0;
  }

  async getAllSchemas(): Promise<Schema[]> {
    const result = await this.postgresqlService.query(`
      SELECT DISTINCT ON (name) name, schema
      FROM schema_versions
      ORDER BY name, version DESC
    `);
    return result.rows.map(row => row.schema);
  }
}
