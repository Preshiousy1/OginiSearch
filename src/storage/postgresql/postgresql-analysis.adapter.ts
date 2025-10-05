import { Injectable, Logger } from '@nestjs/common';
import { AnalyzerRegistryService } from '../../analysis/analyzer-registry.service';
import { IndexConfig } from '../../common/interfaces/index.interface';

export interface AnalyzedField {
  field: string;
  tokens: string[];
  weight?: 'A' | 'B' | 'C' | 'D';
  boost?: number;
}

export interface BusinessFieldWeights {
  name: number;
  category_name: number;
  description: number;
  tags: number;
  content?: number;
  [key: string]: number | undefined;
}

@Injectable()
export class PostgreSQLAnalysisAdapter {
  private readonly logger = new Logger(PostgreSQLAnalysisAdapter.name);

  // Business-optimized field weights for directory search
  private readonly defaultBusinessWeights: BusinessFieldWeights = {
    name: 10.0, // Highest priority - business name
    title: 10.0, // Alternative business name field
    category_name: 2.0, // Important for categorization
    sub_category_name: 2.0, // Subcategory classification
    description: 1.5, // Descriptive content
    tags: 1.0, // Tag-based filtering - lowest priority
    content: 1.0, // General content
    location: 1.0, // Location information
  };

  constructor(private readonly analyzerRegistry: AnalyzerRegistryService) {}

  /**
   * Generate PostgreSQL tsvector from analyzed fields with business-optimized weights
   */
  generateTsVector(
    document: Record<string, any>,
    indexConfig: IndexConfig,
    customWeights?: BusinessFieldWeights,
  ): string {
    try {
      const fieldWeights = { ...this.defaultBusinessWeights, ...customWeights };

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
   */
  private getAnalyzerForField(field: string, indexConfig?: IndexConfig): string {
    // Business-specific field mapping
    const fieldAnalyzerMap: Record<string, string> = {
      tags: 'keyword', // Preserve exact tags
      category_name: 'keyword', // Preserve exact categories
      sub_category_name: 'keyword', // Preserve exact subcategories
      name: 'standard', // Standard processing for business names
      title: 'standard', // Standard processing for titles
      description: 'standard', // Standard processing for descriptions
      content: 'standard', // Standard processing for content
    };

    return fieldAnalyzerMap[field] || 'standard';
  }

  /**
   * Build weighted tsvector string from analyzed fields
   */
  private buildWeightedTsVector(
    analyzedFields: AnalyzedField[],
    fieldWeights: BusinessFieldWeights,
  ): string {
    const weightedTerms: Array<{ term: string; weight: string }> = [];

    for (const field of analyzedFields) {
      const fieldWeight = fieldWeights[field.field] || 1.0;
      const postgresWeight = this.mapWeightToPostgreSQL(fieldWeight);

      for (const token of field.tokens) {
        // Clean token for PostgreSQL tsvector format
        const cleanToken = this.sanitizeTokenForTsVector(token);
        if (cleanToken) {
          weightedTerms.push({
            term: cleanToken,
            weight: postgresWeight,
          });
        }
      }
    }

    // Build tsvector string with proper PostgreSQL format
    return this.formatTsVectorString(weightedTerms);
  }

  /**
   * Map business field weights to PostgreSQL weight labels (A=highest, D=lowest)
   */
  private mapWeightToPostgreSQL(weight: number): string {
    if (weight >= 10.0) return 'A'; // Highest priority (business names)
    if (weight >= 5.0) return 'B'; // High priority (titles)
    if (weight >= 2.0) return 'C'; // Medium priority (categories)
    return 'D'; // Low priority (descriptions, tags, content)
  }

  /**
   * Sanitize token for PostgreSQL tsvector format
   */
  private sanitizeTokenForTsVector(token: string): string | null {
    if (!token || token.length === 0) {
      return null;
    }

    // Remove special characters that could break tsvector
    const sanitized = token
      .toLowerCase()
      .replace(/[^\w\-]/g, '') // Keep only word characters and hyphens
      .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
      .trim();

    // Filter out very short tokens and numbers-only tokens
    if (sanitized.length < 2 || /^\d+$/.test(sanitized)) {
      return null;
    }

    return sanitized;
  }

  /**
   * Format weighted terms into PostgreSQL tsvector string
   */
  private formatTsVectorString(weightedTerms: Array<{ term: string; weight: string }>): string {
    if (weightedTerms.length === 0) {
      return '';
    }

    // Group terms by weight for efficient tsvector format
    const termsByWeight: Record<string, Set<string>> = {
      A: new Set(),
      B: new Set(),
      C: new Set(),
      D: new Set(),
    };

    // Deduplicate terms and group by weight (highest weight wins for duplicates)
    const termWeights: Record<string, string> = {};
    for (const { term, weight } of weightedTerms) {
      if (!termWeights[term] || this.isHigherWeight(weight, termWeights[term])) {
        termWeights[term] = weight;
      }
    }

    // Group terms by their final weights
    for (const [term, weight] of Object.entries(termWeights)) {
      termsByWeight[weight].add(term);
    }

    // Build tsvector string parts
    const tsvectorParts: string[] = [];

    for (const weight of ['A', 'B', 'C', 'D']) {
      if (termsByWeight[weight].size > 0) {
        const terms = Array.from(termsByWeight[weight])
          .map(term => term.replace(/'/g, "''")) // Escape single quotes
          .join(' ');
        if (terms) {
          tsvectorParts.push(`setweight(to_tsvector('english', '${terms}'), '${weight}')`);
        }
      }
    }

    return tsvectorParts.join(' || ') || "''::tsvector"; // Return empty tsvector if no terms
  }

  /**
   * Check if weight1 is higher priority than weight2
   */
  private isHigherWeight(weight1: string, weight2: string): boolean {
    const priority = { A: 4, B: 3, C: 2, D: 1 };
    return priority[weight1] > priority[weight2];
  }

  /**
   * Calculate field lengths for BM25 scoring
   */
  calculateFieldLengths(document: Record<string, any>): Record<string, number> {
    const fieldLengths: Record<string, number> = {};

    for (const [field, value] of Object.entries(document)) {
      if (value != null) {
        const textValue = String(value);
        // Count words (split by whitespace and filter empty strings)
        fieldLengths[field] = textValue.split(/\s+/).filter(word => word.length > 0).length;
      }
    }

    this.logger.debug(`Calculated field lengths: ${JSON.stringify(fieldLengths)}`);
    return fieldLengths;
  }

  /**
   * Generate tsvector query for search
   */
  generateTsQuery(searchTerms: string[]): string {
    const sanitizedTerms = searchTerms
      .map(term => this.sanitizeTokenForTsVector(term))
      .filter(term => term !== null);

    if (sanitizedTerms.length === 0) {
      return '';
    }

    // Create phrase search for multiple terms, OR search for single terms
    if (sanitizedTerms.length === 1) {
      return `to_tsquery('english', '${sanitizedTerms[0]}')`;
    }

    // For multiple terms, create both phrase and individual term matches
    const phraseQuery = sanitizedTerms.join(' & ');
    const orQuery = sanitizedTerms.join(' | ');

    return `to_tsquery('english', '(${phraseQuery}) | (${orQuery})')`;
  }

  /**
   * Get default business field weights
   */
  getDefaultBusinessWeights(): BusinessFieldWeights {
    return { ...this.defaultBusinessWeights };
  }
}
