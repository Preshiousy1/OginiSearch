import { Injectable, Logger } from '@nestjs/common';

export interface FieldWeights {
  [fieldName: string]: number;
}

export interface BM25Parameters {
  k1: number;
  b: number;
  postgresqlWeight: number;
  bm25Weight: number;
}

export interface IndexConfiguration {
  fieldWeights: FieldWeights;
  bm25Parameters: BM25Parameters;
  searchFields: string[];
}

/**
 * Lightweight Search Configuration Service
 * Provides dynamic configuration for field weights, BM25 parameters, and index settings
 * Optimized for minimal performance impact - uses static caching
 */
@Injectable()
export class SearchConfigurationService {
  private readonly logger = new Logger(SearchConfigurationService.name);

  // Static cache to avoid repeated environment reads (performance optimization)
  private readonly configCache = new Map<string, IndexConfiguration>();

  // Default configurations (fallbacks)
  private readonly defaultFieldWeights: FieldWeights = {
    name: 3.0,
    title: 3.0,
    headline: 3.0,
    subject: 3.0,
    category_name: 2.0,
    category: 2.0,
    type: 2.0,
    classification: 2.0,
    description: 1.5,
    summary: 1.5,
    content: 1.5,
    tags: 1.5,
    keywords: 1.5,
    labels: 1.5,
    location: 1.0,
    contact_info: 1.0,
  };

  private readonly defaultBM25Parameters: BM25Parameters = {
    k1: 1.2,
    b: 0.75,
    postgresqlWeight: 0.3,
    bm25Weight: 0.7,
  };

  private readonly defaultSearchFields: string[] = [
    'name',
    'title',
    'description',
    'content',
    'tags',
    'category_name',
  ];

  /**
   * Get field weights for a specific index (cached for performance)
   */
  getFieldWeights(indexName: string): FieldWeights {
    const config = this.getIndexConfiguration(indexName);
    return config.fieldWeights;
  }

  /**
   * Get BM25 parameters for a specific index (cached for performance)
   */
  getBM25Parameters(indexName: string): BM25Parameters {
    const config = this.getIndexConfiguration(indexName);
    return config.bm25Parameters;
  }

  /**
   * Get search fields for a specific index (cached for performance)
   */
  getSearchFields(indexName: string): string[] {
    const config = this.getIndexConfiguration(indexName);
    return config.searchFields;
  }

  /**
   * Get complete configuration for an index (with caching)
   */
  getIndexConfiguration(indexName: string): IndexConfiguration {
    // Check cache first (performance optimization)
    if (this.configCache.has(indexName)) {
      return this.configCache.get(indexName)!;
    }

    // Load from environment or use defaults
    const config: IndexConfiguration = {
      fieldWeights: this.loadFieldWeights(indexName),
      bm25Parameters: this.loadBM25Parameters(indexName),
      searchFields: this.loadSearchFields(indexName),
    };

    // Cache the result (static cache for performance)
    this.configCache.set(indexName, config);
    return config;
  }

  /**
   * Load field weights from environment or defaults
   */
  private loadFieldWeights(indexName: string): FieldWeights {
    try {
      // Try index-specific environment variable first
      const envKey = `SEARCH_FIELD_WEIGHTS_${indexName.toUpperCase()}`;
      const envValue = process.env[envKey];

      if (envValue) {
        const parsed = JSON.parse(envValue);
        this.logger.debug(`Loaded field weights for ${indexName} from ${envKey}`);
        return { ...this.defaultFieldWeights, ...parsed };
      }

      // Try generic field weights
      const genericEnvValue = process.env.SEARCH_FIELD_WEIGHTS;
      if (genericEnvValue) {
        const parsed = JSON.parse(genericEnvValue);
        return { ...this.defaultFieldWeights, ...parsed };
      }

      // Return defaults (most common case - no environment parsing overhead)
      return { ...this.defaultFieldWeights };
    } catch (error) {
      this.logger.warn(`Failed to parse field weights for ${indexName}: ${error.message}`);
      return { ...this.defaultFieldWeights };
    }
  }

  /**
   * Load BM25 parameters from environment or defaults
   */
  private loadBM25Parameters(indexName: string): BM25Parameters {
    try {
      // Try index-specific environment variable
      const envKey = `SEARCH_BM25_PARAMS_${indexName.toUpperCase()}`;
      const envValue = process.env[envKey];

      if (envValue) {
        const parsed = JSON.parse(envValue);
        this.logger.debug(`Loaded BM25 parameters for ${indexName} from ${envKey}`);
        return { ...this.defaultBM25Parameters, ...parsed };
      }

      // Try generic BM25 parameters
      const k1 = parseFloat(process.env.SEARCH_BM25_K1 || '1.2');
      const b = parseFloat(process.env.SEARCH_BM25_B || '0.75');
      const postgresqlWeight = parseFloat(process.env.SEARCH_POSTGRESQL_WEIGHT || '0.3');
      const bm25Weight = parseFloat(process.env.SEARCH_BM25_WEIGHT || '0.7');

      return { k1, b, postgresqlWeight, bm25Weight };
    } catch (error) {
      this.logger.warn(`Failed to parse BM25 parameters for ${indexName}: ${error.message}`);
      return { ...this.defaultBM25Parameters };
    }
  }

  /**
   * Load search fields from environment or defaults
   */
  private loadSearchFields(indexName: string): string[] {
    try {
      // Try index-specific search fields
      const envKey = `SEARCH_FIELDS_${indexName.toUpperCase()}`;
      const envValue = process.env[envKey];

      if (envValue) {
        const fields = envValue
          .split(',')
          .map(f => f.trim())
          .filter(f => f.length > 0);
        this.logger.debug(`Loaded search fields for ${indexName} from ${envKey}`);
        return fields;
      }

      // Try generic search fields
      const genericEnvValue = process.env.SEARCH_FIELDS;
      if (genericEnvValue) {
        return genericEnvValue
          .split(',')
          .map(f => f.trim())
          .filter(f => f.length > 0);
      }

      // Return defaults
      return [...this.defaultSearchFields];
    } catch (error) {
      this.logger.warn(`Failed to parse search fields for ${indexName}: ${error.message}`);
      return [...this.defaultSearchFields];
    }
  }

  /**
   * Clear configuration cache (useful for testing or config reloads)
   */
  clearCache(): void {
    this.configCache.clear();
    this.logger.debug('Configuration cache cleared');
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.configCache.size,
      entries: Array.from(this.configCache.keys()),
    };
  }
}
