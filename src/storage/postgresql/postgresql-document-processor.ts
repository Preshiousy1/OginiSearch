import { Injectable, Logger } from '@nestjs/common';
import { DocumentProcessorService } from '../../document/document-processor.service';
import { PostgreSQLAnalysisAdapter, BusinessFieldWeights } from './postgresql-analysis.adapter';
import {
  RawDocument,
  ProcessedDocument,
  DocumentMapping,
} from '../../document/interfaces/document-processor.interface';
import { IndexConfig } from '../../common/interfaces/index.interface';

export interface PostgreSQLProcessedDocument extends ProcessedDocument {
  searchVector: string;
  fieldLengths: Record<string, number>;
  boostFactor: number;
}

export interface PostgreSQLDocumentOptions {
  indexName: string;
  indexConfig?: IndexConfig;
  boostFactor?: number;
  customFieldWeights?: BusinessFieldWeights;
}

@Injectable()
export class PostgreSQLDocumentProcessor extends DocumentProcessorService {
  private readonly logger = new Logger(PostgreSQLDocumentProcessor.name);

  constructor(private readonly postgresAnalysisAdapter: PostgreSQLAnalysisAdapter) {
    super(postgresAnalysisAdapter['analyzerRegistry']); // Access the analyzer registry from adapter
    this.initializeBusinessMapping();
  }

  /**
   * Process document for PostgreSQL storage with tsvector and enhanced field lengths
   */
  async processForPostgreSQL(
    document: RawDocument,
    options: PostgreSQLDocumentOptions,
  ): Promise<PostgreSQLProcessedDocument> {
    try {
      this.logger.debug(`Processing document ${document.id} for PostgreSQL storage`);

      // Use parent class to get standard processed document
      const standardProcessed = this.processDocument(document);

      // Create IndexConfig from options or use default
      const indexConfig = options.indexConfig || this.createDefaultIndexConfig();

      // Generate PostgreSQL tsvector using our analysis adapter
      const searchVector = this.postgresAnalysisAdapter.generateTsVector(
        document.source,
        indexConfig,
        options.customFieldWeights,
      );

      // Calculate enhanced field lengths for BM25
      const enhancedFieldLengths = this.postgresAnalysisAdapter.calculateFieldLengths(
        document.source,
      );

      // Combine standard processing with PostgreSQL enhancements
      const postgresProcessed: PostgreSQLProcessedDocument = {
        ...standardProcessed,
        searchVector,
        fieldLengths: enhancedFieldLengths,
        boostFactor: options.boostFactor || 1.0,
      };

      this.logger.debug(
        `Generated tsvector length: ${searchVector.length}, field count: ${
          Object.keys(enhancedFieldLengths).length
        }`,
      );

      return postgresProcessed;
    } catch (error) {
      this.logger.error(
        `Failed to process document ${document.id} for PostgreSQL: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Batch process multiple documents for PostgreSQL
   */
  async batchProcessForPostgreSQL(
    documents: RawDocument[],
    options: PostgreSQLDocumentOptions,
  ): Promise<PostgreSQLProcessedDocument[]> {
    const results: PostgreSQLProcessedDocument[] = [];
    const batchSize = 50; // Process in smaller batches for memory efficiency

    this.logger.log(`Batch processing ${documents.length} documents for PostgreSQL`);

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(doc => this.processForPostgreSQL(doc, options)),
      );

      results.push(...batchResults);

      if (documents.length > 100 && (i + batchSize) % 500 === 0) {
        this.logger.debug(`Processed ${i + batchSize} / ${documents.length} documents`);
      }
    }

    this.logger.log(`Completed batch processing of ${results.length} documents`);
    return results;
  }

  /**
   * Create SearchDocument entity format for database storage
   */
  createSearchDocumentEntity(
    processed: PostgreSQLProcessedDocument,
    options: PostgreSQLDocumentOptions,
  ): {
    indexName: string;
    docId: string;
    content: Record<string, any>;
    searchVector: string;
    fieldLengths: Record<string, number>;
    boostFactor: number;
  } {
    return {
      indexName: options.indexName,
      docId: processed.id,
      content: processed.source,
      searchVector: processed.searchVector,
      fieldLengths: processed.fieldLengths,
      boostFactor: processed.boostFactor,
    };
  }

  /**
   * Initialize business-optimized field mapping
   */
  private initializeBusinessMapping(): void {
    const businessMapping: DocumentMapping = {
      defaultAnalyzer: 'standard',
      fields: {
        // High priority business fields
        name: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 3.0,
        },
        title: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 3.0,
        },
        // Category fields
        category_name: {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 2.0,
        },
        // Content fields
        description: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 1.5,
        },
        // Tag fields
        tags: {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 1.5,
        },
      },
    };

    this.setMapping(businessMapping);
    this.logger.debug('Initialized business-optimized field mapping for PostgreSQL');
  }

  /**
   * Create default IndexConfig for business documents
   */
  private createDefaultIndexConfig(): IndexConfig {
    return {
      searchableAttributes: ['name', 'title', 'category_name', 'description', 'tags'],
      defaultAnalyzer: 'standard',
      fieldAnalyzers: {
        tags: 'keyword',
        category_name: 'keyword',
      },
    };
  }

  /**
   * Validate document for PostgreSQL processing
   */
  validateDocumentForPostgreSQL(document: RawDocument): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!document.id || typeof document.id !== 'string') {
      errors.push('Document must have a valid string ID');
    }

    if (!document.source || typeof document.source !== 'object') {
      errors.push('Document must have a valid source object');
    }

    // Check for required business fields
    if (document.source) {
      if (!document.source.name && !document.source.title) {
        errors.push('Document must have either "name" or "title" field for business search');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get PostgreSQL-specific processing statistics
   */
  getProcessingStats(): {
    supportedFieldTypes: string[];
    businessFieldWeights: Record<string, number>;
    defaultAnalyzers: Record<string, string>;
  } {
    const mapping = this.getMapping();
    const businessWeights = this.postgresAnalysisAdapter.getDefaultBusinessWeights();

    return {
      supportedFieldTypes: ['text', 'keyword', 'number', 'date', 'boolean', 'array'],
      businessFieldWeights: businessWeights,
      defaultAnalyzers: Object.fromEntries(
        Object.entries(mapping.fields).map(([field, config]) => [
          field,
          config.analyzer || mapping.defaultAnalyzer || 'standard',
        ]),
      ),
    };
  }
}
