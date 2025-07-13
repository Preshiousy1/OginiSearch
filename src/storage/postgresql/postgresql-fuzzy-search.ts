import { Injectable, Logger } from '@nestjs/common';
import { PostgreSQLService } from './postgresql.service';

@Injectable()
export class PostgreSQLFuzzySearch {
  private readonly logger = new Logger(PostgreSQLFuzzySearch.name);
  private readonly SIMILARITY_THRESHOLD = 0.3;

  constructor(private readonly postgresqlService: PostgreSQLService) {}

  /**
   * Initialize pg_trgm extension if not already installed
   */
  async initializeTrigram(): Promise<void> {
    try {
      await this.postgresqlService.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
      this.logger.log('pg_trgm extension initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize pg_trgm extension: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create trigram index for a specific column
   */
  async createTrigramIndex(tableName: string, columnName: string): Promise<void> {
    try {
      const indexName = `idx_trgm_${tableName}_${columnName}`;
      await this.postgresqlService.query(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} USING gin(${columnName} gin_trgm_ops);`,
      );
      this.logger.log(`Created trigram index ${indexName} on ${tableName}.${columnName}`);
    } catch (error) {
      this.logger.error(
        `Failed to create trigram index on ${tableName}.${columnName}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Perform fuzzy search using trigram similarity
   */
  async fuzzySearch(
    tableName: string,
    columnName: string,
    searchTerm: string,
    limit = 10,
  ): Promise<any[]> {
    try {
      const query = `
        SELECT *, similarity(${columnName}, $1) as similarity_score
        FROM ${tableName}
        WHERE similarity(${columnName}, $1) > $2
        ORDER BY similarity_score DESC
        LIMIT $3;
      `;
      const result = await this.postgresqlService.query(query, [
        searchTerm,
        this.SIMILARITY_THRESHOLD,
        limit,
      ]);
      return result.rows;
    } catch (error) {
      this.logger.error(`Failed to perform fuzzy search: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find similar terms within a specific column
   */
  async findSimilarTerms(
    tableName: string,
    columnName: string,
    term: string,
    limit = 5,
  ): Promise<Array<{ term: string; similarity: number }>> {
    try {
      const query = `
        SELECT DISTINCT ${columnName} as term, similarity(${columnName}, $1) as similarity
        FROM ${tableName}
        WHERE similarity(${columnName}, $1) > $2
        ORDER BY similarity DESC
        LIMIT $3;
      `;
      const result = await this.postgresqlService.query(query, [
        term,
        this.SIMILARITY_THRESHOLD,
        limit,
      ]);
      return result.rows;
    } catch (error) {
      this.logger.error(`Failed to find similar terms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get similarity score between two strings
   */
  async getSimilarityScore(str1: string, str2: string): Promise<number> {
    try {
      const result = await this.postgresqlService.query(
        'SELECT similarity($1, $2) as similarity;',
        [str1, str2],
      );
      return result.rows[0].similarity;
    } catch (error) {
      this.logger.error(`Failed to get similarity score: ${error.message}`);
      throw error;
    }
  }
}
