import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface FieldWeightConfig {
  weight: number;
  description: string;
}

@Injectable()
export class FieldWeightsService {
  private readonly logger = new Logger(FieldWeightsService.name);

  // Define known field patterns and their weights
  private readonly knownFieldPatterns: Record<string, FieldWeightConfig> = {
    // High priority fields (weight = 10.0)
    name: { weight: 10.0, description: 'Primary name field - highest priority' },
    title: { weight: 10.0, description: 'Title field - highest priority' },

    // Medium priority fields (weight = 2.0)
    category_name: { weight: 2.0, description: 'Category field - medium priority' },
    sub_category_name: { weight: 2.0, description: 'Subcategory field - medium priority' },
    category: { weight: 2.0, description: 'Category field - medium priority' },
    subcategory: { weight: 2.0, description: 'Subcategory field - medium priority' },

    // Lower priority fields (weight = 1.5)
    description: { weight: 1.5, description: 'Description field - lower priority' },
    summary: { weight: 1.5, description: 'Summary field - lower priority' },
    overview: { weight: 1.5, description: 'Overview field - lower priority' },

    // Lowest priority fields (weight = 1.0)
    tags: { weight: 1.0, description: 'Tags field - lowest priority' },
    content: { weight: 1.0, description: 'General content field - lowest priority' },
    text: { weight: 1.0, description: 'Text content field - lowest priority' },
  };

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Analyze document fields and create field weights entries
   */
  async analyzeAndCreateFieldWeights(indexName: string, fields: string[]): Promise<void> {
    try {
      // Start a transaction
      await this.dataSource.transaction(async transactionalEntityManager => {
        for (const field of fields) {
          // Check if field matches any known pattern
          const matchingPattern = this.findMatchingPattern(field);
          if (matchingPattern) {
            const { pattern, config } = matchingPattern;

            // Check if weight already exists
            const existing = await transactionalEntityManager.query(
              'SELECT 1 FROM field_weights WHERE index_name = $1 AND field_name = $2',
              [indexName, field],
            );

            if (existing.length === 0) {
              // Create new field weight entry
              await transactionalEntityManager.query(
                `INSERT INTO field_weights (index_name, field_name, weight, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (index_name, field_name) DO NOTHING`,
                [indexName, field, config.weight, config.description],
              );

              this.logger.log(
                `Created field weight for ${indexName}.${field} (weight: ${config.weight}) based on pattern: ${pattern}`,
              );
            }
          }
        }
      });
    } catch (error) {
      this.logger.error(`Failed to analyze and create field weights: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find matching pattern for a field name
   */
  private findMatchingPattern(
    fieldName: string,
  ): { pattern: string; config: FieldWeightConfig } | null {
    // Normalize field name for matching
    const normalizedField = fieldName.toLowerCase();

    // Check exact matches first
    if (normalizedField in this.knownFieldPatterns) {
      return {
        pattern: normalizedField,
        config: this.knownFieldPatterns[normalizedField],
      };
    }

    // Check pattern matches
    for (const [pattern, config] of Object.entries(this.knownFieldPatterns)) {
      if (
        normalizedField.includes(pattern) ||
        normalizedField.replace(/[_-]/g, '') === pattern.replace(/[_-]/g, '')
      ) {
        return { pattern, config };
      }
    }

    return null;
  }

  /**
   * Get field weights for an index
   */
  async getFieldWeights(indexName: string): Promise<Record<string, number>> {
    const weights = await this.dataSource.query(
      'SELECT field_name, weight FROM field_weights WHERE index_name = $1',
      [indexName],
    );

    return weights.reduce((acc: Record<string, number>, row: any) => {
      acc[row.field_name] = row.weight;
      return acc;
    }, {});
  }

  /**
   * Update field weights for an index
   */
  async updateFieldWeights(indexName: string, weights: Record<string, number>): Promise<void> {
    await this.dataSource.transaction(async transactionalEntityManager => {
      for (const [field, weight] of Object.entries(weights)) {
        await transactionalEntityManager.query(
          `UPDATE field_weights 
           SET weight = $3 
           WHERE index_name = $1 AND field_name = $2`,
          [indexName, field, weight],
        );
      }
    });
  }
}
