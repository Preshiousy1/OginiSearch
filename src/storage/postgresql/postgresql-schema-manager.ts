import { Injectable, Logger } from '@nestjs/common';
import { PostgreSQLService } from './postgresql.service';
import { SchemaVersionManagerService } from '../../schema/schema-version-manager.service';
import { QueryRunner } from 'typeorm';

interface SchemaField {
  type: string;
  required?: boolean;
  defaultValue?: any;
}

interface Schema {
  fields: Record<string, SchemaField>;
}

@Injectable()
export class PostgreSQLSchemaManager {
  private readonly logger = new Logger(PostgreSQLSchemaManager.name);

  constructor(
    private readonly postgresqlService: PostgreSQLService,
    private readonly schemaVersionManager: SchemaVersionManagerService,
  ) {}

  /**
   * Initialize schema version tracking table
   */
  async initializeSchemaVersioning(): Promise<void> {
    try {
      await this.postgresqlService.query(`
        CREATE TABLE IF NOT EXISTS schema_versions (
          index_name VARCHAR(255) PRIMARY KEY,
          version INTEGER NOT NULL,
          schema JSONB NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.logger.log('Schema versioning table initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize schema versioning: ${error.message}`);
      throw error;
    }
  }

  /**
   * Apply schema changes to PostgreSQL tables
   */
  async applySchemaChanges(indexName: string, schema: Schema): Promise<void> {
    const client = await this.postgresqlService.getClient();
    try {
      await client.query('BEGIN');

      // Get current version
      const currentVersion = await this.getCurrentVersion(indexName);
      const newVersion = currentVersion + 1;

      // Create or alter table based on schema
      await this.createOrUpdateTable(client, indexName, schema);

      // Update schema version
      await this.updateSchemaVersion(client, indexName, newVersion, schema);

      await client.query('COMMIT');
      this.logger.log(`Schema changes applied successfully for index ${indexName}`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Failed to apply schema changes: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get current schema version for an index
   */
  private async getCurrentVersion(indexName: string): Promise<number> {
    const result = await this.postgresqlService.query(
      'SELECT version FROM schema_versions WHERE index_name = $1',
      [indexName],
    );
    return result.rows.length > 0 ? result.rows[0].version : 0;
  }

  /**
   * Create or update table based on schema
   */
  private async createOrUpdateTable(
    client: QueryRunner,
    indexName: string,
    schema: Schema,
  ): Promise<void> {
    const tableName = `${indexName}_documents`;
    const existingColumns = await this.getExistingColumns(tableName);

    if (existingColumns.length === 0) {
      // Create new table
      await this.createTable(client, tableName, schema);
    } else {
      // Alter existing table
      await this.alterTable(client, tableName, schema, existingColumns);
    }
  }

  /**
   * Create a new table based on schema
   */
  private async createTable(client: QueryRunner, tableName: string, schema: Schema): Promise<void> {
    const columns = this.generateColumnDefinitions(schema);
    await client.query(`
      CREATE TABLE ${tableName} (
        id SERIAL PRIMARY KEY,
        document_id VARCHAR(255) UNIQUE NOT NULL,
        content JSONB NOT NULL,
        ${columns.join(',\n        ')},
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Alter existing table based on schema changes
   */
  private async alterTable(
    client: QueryRunner,
    tableName: string,
    schema: Schema,
    existingColumns: string[],
  ): Promise<void> {
    const newColumns = this.generateColumnDefinitions(schema);

    for (const column of newColumns) {
      const columnName = column.split(' ')[0];
      if (!existingColumns.includes(columnName)) {
        await client.query(`ALTER TABLE ${tableName} ADD COLUMN ${column};`);
      }
    }
  }

  /**
   * Get existing columns for a table
   */
  private async getExistingColumns(tableName: string): Promise<string[]> {
    const result = await this.postgresqlService.query(
      `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1;
    `,
      [tableName],
    );
    return result.rows.map(row => row.column_name);
  }

  /**
   * Generate column definitions from schema
   */
  private generateColumnDefinitions(schema: Schema): string[] {
    const columns: string[] = [];

    for (const [field, config] of Object.entries(schema.fields)) {
      const sqlType = this.getSqlType(config.type);
      if (sqlType) {
        columns.push(`${field} ${sqlType}`);
      }
    }

    return columns;
  }

  /**
   * Map schema types to SQL types
   */
  private getSqlType(schemaType: string): string | null {
    const typeMap: Record<string, string> = {
      string: 'VARCHAR(255)',
      text: 'TEXT',
      number: 'NUMERIC',
      integer: 'INTEGER',
      boolean: 'BOOLEAN',
      date: 'TIMESTAMP',
      object: 'JSONB',
      array: 'JSONB',
    };
    return typeMap[schemaType] || null;
  }

  /**
   * Update schema version in version tracking table
   */
  private async updateSchemaVersion(
    client: QueryRunner,
    indexName: string,
    version: number,
    schema: Schema,
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO schema_versions (index_name, version, schema, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (index_name) 
      DO UPDATE SET 
        version = $2,
        schema = $3,
        updated_at = CURRENT_TIMESTAMP;
    `,
      [indexName, version, schema],
    );
  }
}
