import { Injectable, Logger } from '@nestjs/common';
import { AnalyzerRegistryService } from '../../analysis/analyzer-registry.service';
import { IndexConfig } from '../../common/interfaces/index.interface';

export interface GenericFieldWeights {
  [field: string]: number;
}

export interface AnalyzedField {
  field: string;
  tokens: string[];
}

@Injectable()
export class GenericPostgreSQLAnalysisAdapter {
  private readonly logger = new Logger(GenericPostgreSQLAnalysisAdapter.name);

  // Generic field weights that work for ANY document type
  private readonly defaultGenericWeights: GenericFieldWeights = {
    // Common text fields with generic weights
    name: 3.0,
    title: 3.0,
    headline: 3.0,
    subject: 3.0,

    // Categorization fields
    category: 2.0,
    type: 2.0,
    classification: 2.0,

    // Descriptive fields
    description: 1.5,
    summary: 1.5,
    content: 1.5,

    // Tagging fields
    tags: 1.5,
    keywords: 1.5,
    labels: 1.5,

    // Location fields
    location: 1.0,
    address: 1.0,
    region: 1.0,

    // Generic content
    text: 1.0,
    body: 1.0,
    message: 1.0,
  };

  constructor(private readonly analyzerRegistry: AnalyzerRegistryService) {}

  /**
   * Generate PostgreSQL tsvector from analyzed fields with generic weights
   * Works for ANY document type, not just businesses
   */
  generateTsVector(
    document: Record<string, any>,
    indexConfig: IndexConfig,
    customWeights?: GenericFieldWeights,
  ): string {
    try {
      const fieldWeights = { ...this.defaultGenericWeights, ...customWeights };

      // Process document fields using existing analyzers
      const analyzedFields = this.processDocumentFields(document, indexConfig);

      this.logger.debug(
        `Processing document with ${analyzedFields.length} analyzed fields for tsvector generation`,
      );

      return this.buildWeightedTsVector(analyzedFields, fieldWeights);
    } catch (error) {
      this.logger.error(`Failed to generate tsvector: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process document fields using existing analyzer registry
   * Generic processing that works for any field structure
   */
  private processDocumentFields(
    document: Record<string, any>,
    indexConfig: IndexConfig,
  ): AnalyzedField[] {
    const analyzedFields: AnalyzedField[] = [];

    for (const [field, value] of Object.entries(document)) {
      if (value != null && typeof value === 'string') {
        // Determine analyzer based on field type or use default
        const analyzerName = this.getAnalyzerForField(field, indexConfig);
        const analyzer =
          this.analyzerRegistry.getAnalyzer(analyzerName) ||
          this.analyzerRegistry.getAnalyzer('standard');

        if (analyzer) {
          const tokens = analyzer.analyze(value);
          if (tokens.length > 0) {
            analyzedFields.push({
              field,
              tokens,
            });
          }
        }
      }
    }

    return analyzedFields;
  }

  /**
   * Determine appropriate analyzer for field
   * Generic field mapping that works for any document type
   */
  private getAnalyzerForField(field: string, indexConfig?: IndexConfig): string {
    // Generic field mapping that works for ANY document type
    const genericFieldAnalyzerMap: Record<string, string> = {
      // Preserve exact values for categorization
      tags: 'keyword',
      keywords: 'keyword',
      labels: 'keyword',
      category: 'keyword',
      type: 'keyword',
      classification: 'keyword',

      // Standard processing for names and titles
      name: 'standard',
      title: 'standard',
      headline: 'standard',
      subject: 'standard',

      // Standard processing for descriptions
      description: 'standard',
      summary: 'standard',
      content: 'standard',
      text: 'standard',
      body: 'standard',
      message: 'standard',

      // Location fields
      location: 'standard',
      address: 'standard',
      region: 'standard',
    };

    // Use custom field analyzer from index config if available
    if (indexConfig?.fieldAnalyzers?.[field]) {
      return indexConfig.fieldAnalyzers[field];
    }

    return genericFieldAnalyzerMap[field] || 'standard';
  }

  /**
   * Build weighted tsvector string from analyzed fields
   */
  private buildWeightedTsVector(
    analyzedFields: AnalyzedField[],
    fieldWeights: GenericFieldWeights,
  ): string {
    const tsvectorParts: string[] = [];

    for (const analyzedField of analyzedFields) {
      const { field, tokens } = analyzedField;
      const weight = fieldWeights[field] || 1.0;

      if (tokens.length > 0) {
        const weightLabel = this.mapWeightToLabel(weight);
        const tokenString = tokens.join(' ');
        tsvectorParts.push(`setweight(to_tsvector('english', '${tokenString}'), '${weightLabel}')`);
      }
    }

    if (tsvectorParts.length === 0) {
      return "to_tsvector('english', '')";
    }

    return tsvectorParts.join(' || ');
  }

  /**
   * Map generic field weights to PostgreSQL weight labels (A=highest, D=lowest)
   */
  private mapWeightToLabel(weight: number): string {
    if (weight >= 3.0) return 'A'; // High priority (names, titles)
    if (weight >= 2.0) return 'B'; // Medium priority (categories, types)
    if (weight >= 1.5) return 'C'; // Lower priority (descriptions, tags)
    return 'D'; // Lowest priority (general content)
  }

  /**
   * Get default generic field weights
   */
  getDefaultGenericWeights(): GenericFieldWeights {
    return { ...this.defaultGenericWeights };
  }

  /**
   * Create custom field weights for specific use cases
   */
  createCustomWeights(weights: GenericFieldWeights): GenericFieldWeights {
    return { ...this.defaultGenericWeights, ...weights };
  }

  /**
   * Analyze a single field with specified analyzer
   */
  analyzeField(field: string, value: string, analyzerName = 'standard'): string[] {
    const analyzer = this.analyzerRegistry.getAnalyzer(analyzerName);
    if (!analyzer) {
      this.logger.warn(`Analyzer '${analyzerName}' not found, using standard`);
      return this.analyzerRegistry.getAnalyzer('standard')?.analyze(value) || [];
    }
    return analyzer.analyze(value);
  }

  /**
   * Get available analyzers for field analysis
   */
  getAvailableAnalyzers(): string[] {
    return ['standard', 'keyword', 'lowercase', 'ngram', 'whitespace'];
  }

  /**
   * Validate field weights configuration
   */
  validateFieldWeights(weights: GenericFieldWeights): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, weight] of Object.entries(weights)) {
      if (typeof weight !== 'number' || weight < 0) {
        errors.push(`Invalid weight for field '${field}': must be a positive number`);
      }
      if (weight > 10) {
        errors.push(`Weight for field '${field}' is too high: ${weight} (max 10)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
