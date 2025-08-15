import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Dynamic Index Manager - Automatically manages trigram indexes for all search indices
 * This service ensures optimal ILIKE fallback performance without hardcoded index names
 */
@Injectable()
export class DynamicIndexManagerService {
  private readonly logger = new Logger(DynamicIndexManagerService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Automatically detect and create optimal indexes for all existing search indices
   */
  async initializeOptimalIndexes(): Promise<void> {
    try {
      this.logger.log('Starting dynamic index optimization...');

      // Get all existing search indices
      const indices = await this.getExistingIndices();
      this.logger.log(`Found ${indices.length} search indices to optimize`);

      // Analyze and create indexes for each index
      for (const indexName of indices) {
        await this.optimizeIndexFields(indexName);
      }

      this.logger.log('Dynamic index optimization completed successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize optimal indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all existing search indices from the system
   */
  private async getExistingIndices(): Promise<string[]> {
    const query = `
      SELECT DISTINCT index_name 
      FROM documents 
      WHERE index_name IS NOT NULL
      ORDER BY index_name
    `;

    const result = await this.dataSource.query(query);
    return result.map((row: any) => row.index_name);
  }

  /**
   * Analyze and create optimal indexes for a specific search index
   */
  private async optimizeIndexFields(indexName: string): Promise<void> {
    try {
      this.logger.log(`Optimizing indexes for '${indexName}' index...`);

      // Analyze the most commonly searched fields for this index
      const searchableFields = await this.analyzeSearchableFields(indexName);

      // Create trigram indexes for the most important fields
      await this.createTrigramIndexes(indexName, searchableFields);

      // Create composite indexes for common filter combinations
      await this.createFilterIndexes(indexName);

      this.logger.log(`Index optimization completed for '${indexName}'`);
    } catch (error) {
      this.logger.warn(`Failed to optimize indexes for '${indexName}': ${error.message}`);
    }
  }

  /**
   * Analyze which fields are most commonly used for text search in an index
   */
  private async analyzeSearchableFields(indexName: string): Promise<string[]> {
    // Get sample documents to understand the schema
    const sampleQuery = `
      SELECT content 
      FROM documents 
      WHERE index_name = $1 
      LIMIT 100
    `;

    const samples = await this.dataSource.query(sampleQuery, [indexName]);

    if (samples.length === 0) {
      return ['name', 'title', 'description']; // Default fallback
    }

    // Analyze field frequency and content types
    const fieldStats = new Map<string, { count: number; hasText: boolean; avgLength: number }>();

    samples.forEach((sample: any) => {
      const content = sample.content;
      if (content && typeof content === 'object') {
        Object.keys(content).forEach(field => {
          const value = content[field];
          if (value !== null && value !== undefined) {
            const stats = fieldStats.get(field) || { count: 0, hasText: false, avgLength: 0 };
            stats.count++;

            if (typeof value === 'string' && value.length > 0) {
              stats.hasText = true;
              stats.avgLength = (stats.avgLength + value.length) / 2;
            }

            fieldStats.set(field, stats);
          }
        });
      }
    });

    // Prioritize fields that are text-based and commonly present
    const searchableFields = Array.from(fieldStats.entries())
      .filter(([_, stats]) => stats.hasText && stats.count >= samples.length * 0.1) // Present in at least 10% of docs
      .sort((a, b) => {
        // Prioritize by presence frequency and text length
        const scoreA = a[1].count * Math.min(a[1].avgLength, 100); // Cap at 100 chars for scoring
        const scoreB = b[1].count * Math.min(b[1].avgLength, 100);
        return scoreB - scoreA;
      })
      .slice(0, 3) // Top 3 most important fields
      .map(([field]) => field);

    this.logger.debug(
      `Identified searchable fields for '${indexName}': ${searchableFields.join(', ')}`,
    );
    return searchableFields.length > 0 ? searchableFields : ['name', 'title', 'description'];
  }

  /**
   * Create trigram indexes for important text fields
   */
  private async createTrigramIndexes(indexName: string, fields: string[]): Promise<void> {
    for (const field of fields) {
      const indexNameSafe = indexName.replace(/[^a-zA-Z0-9_]/g, '_'); // Sanitize index name
      const fieldSafe = field.replace(/[^a-zA-Z0-9_]/g, '_'); // Sanitize field name
      const trigramIndexName = `idx_${indexNameSafe}_${fieldSafe}_trgm`;

      // Check if index already exists
      const existsQuery = `
        SELECT 1 FROM pg_indexes 
        WHERE indexname = $1
      `;
      const exists = await this.dataSource.query(existsQuery, [trigramIndexName]);

      if (exists.length === 0) {
        try {
          const createIndexQuery = `
            CREATE INDEX ${trigramIndexName}
            ON documents USING gin ((lower(content->>'${field}')) gin_trgm_ops)
            WHERE index_name = '${indexName}'
          `;

          await this.dataSource.query(createIndexQuery);
          this.logger.log(`Created trigram index: ${trigramIndexName}`);
        } catch (error) {
          this.logger.warn(`Failed to create trigram index ${trigramIndexName}: ${error.message}`);
        }
      } else {
        this.logger.debug(`Trigram index ${trigramIndexName} already exists`);
      }
    }
  }

  /**
   * Create composite indexes for common filter combinations
   */
  private async createFilterIndexes(indexName: string): Promise<void> {
    // Analyze common boolean/filter fields
    const filterFields = await this.analyzeFilterFields(indexName);

    if (filterFields.length >= 2) {
      const indexNameSafe = indexName.replace(/[^a-zA-Z0-9_]/g, '_');
      const filterIndexName = `idx_${indexNameSafe}_filters`;

      // Check if composite filter index exists
      const existsQuery = `
        SELECT 1 FROM pg_indexes 
        WHERE indexname = $1
      `;
      const exists = await this.dataSource.query(existsQuery, [filterIndexName]);

      if (exists.length === 0) {
        try {
          const fieldExprs = filterFields.map(field => `(content->>'${field}')`).join(', ');
          const createIndexQuery = `
            CREATE INDEX ${filterIndexName}
            ON documents USING btree (index_name, ${fieldExprs})
            WHERE index_name = '${indexName}'
          `;

          await this.dataSource.query(createIndexQuery);
          this.logger.log(`Created composite filter index: ${filterIndexName}`);
        } catch (error) {
          this.logger.warn(`Failed to create filter index ${filterIndexName}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Analyze common boolean/filter fields used in queries
   */
  private async analyzeFilterFields(indexName: string): Promise<string[]> {
    const sampleQuery = `
      SELECT content 
      FROM documents 
      WHERE index_name = $1 
      LIMIT 50
    `;

    const samples = await this.dataSource.query(sampleQuery, [indexName]);

    if (samples.length === 0) {
      return [];
    }

    // Find boolean/filterable fields
    const booleanFields = new Set<string>();

    samples.forEach((sample: any) => {
      const content = sample.content;
      if (content && typeof content === 'object') {
        Object.keys(content).forEach(field => {
          const value = content[field];
          if (
            typeof value === 'boolean' ||
            (typeof value === 'string' &&
              ['true', 'false', 'active', 'inactive', 'verified', 'unverified'].includes(
                value.toLowerCase(),
              ))
          ) {
            booleanFields.add(field);
          }
        });
      }
    });

    return Array.from(booleanFields).slice(0, 4); // Max 4 filter fields
  }

  /**
   * Get index statistics and recommendations
   */
  async getIndexOptimizationReport(): Promise<any> {
    const indices = await this.getExistingIndices();
    const report = {
      totalIndices: indices.length,
      optimizedIndices: 0,
      recommendations: [],
    };

    for (const indexName of indices) {
      const indexNameSafe = indexName.replace(/[^a-zA-Z0-9_]/g, '_');

      // Check for existing trigram indexes
      const trigramQuery = `
        SELECT indexname 
        FROM pg_indexes 
        WHERE indexname LIKE 'idx_${indexNameSafe}_%_trgm'
      `;

      const trigramIndexes = await this.dataSource.query(trigramQuery);

      if (trigramIndexes.length > 0) {
        report.optimizedIndices++;
      } else {
        report.recommendations.push(`Consider creating trigram indexes for '${indexName}' index`);
      }
    }

    return report;
  }
}
