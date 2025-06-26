import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import {
  DocumentProcessor,
  DocumentMapping,
  RawDocument,
  ProcessedDocument,
  ProcessedField,
} from './interfaces/document-processor.interface';
import { AnalyzerRegistryService } from '../analysis/analyzer-registry.service';

@Injectable()
export class DocumentProcessorService implements DocumentProcessor, OnModuleInit {
  private mapping: DocumentMapping = { fields: {} };

  constructor(private readonly analyzerRegistryService: AnalyzerRegistryService) {}

  async onModuleInit() {
    this.initializeDefaultMapping();
  }

  /**
   * Process a document for indexing
   */
  processDocument(document: RawDocument): ProcessedDocument {
    // Initialize processed document structure
    const processedDoc: ProcessedDocument = {
      id: document.id,
      source: { ...document.source },
      fields: {},
      fieldLengths: {},
    };

    // Process each field according to mapping
    for (const [fieldName, fieldConfig] of Object.entries(this.mapping.fields)) {
      // Skip non-indexed fields
      if (fieldConfig.indexed === false) {
        continue;
      }

      // Extract field value
      const fieldValue = this.extractFieldValue(document.source, fieldName);

      // Skip if field doesn't exist or is null/undefined
      if (fieldValue === null || fieldValue === undefined) {
        continue;
      }

      // Determine which analyzer to use
      const analyzerName = fieldConfig.analyzer || this.mapping.defaultAnalyzer || 'standard';

      // Get the analyzer
      const analyzer = this.analyzerRegistryService.getAnalyzer(analyzerName);
      if (!analyzer) {
        throw new Error(`Analyzer "${analyzerName}" not found for field "${fieldName}"`);
      }

      // Process the field content
      const fieldContent = this.normalizeFieldContent(fieldValue);
      const terms = analyzer.analyze(fieldContent);

      // Calculate term frequencies
      const termFrequencies: Record<string, number> = {};
      for (const term of terms) {
        termFrequencies[term] = (termFrequencies[term] || 0) + 1;
      }

      // Create processed field
      const processedField: ProcessedField = {
        original: fieldValue,
        terms,
        termFrequencies,
        length: terms.length,
      };

      // Store processed field
      processedDoc.fields[fieldName] = processedField;

      // Store field length for BM25 calculation
      processedDoc.fieldLengths[fieldName] = terms.length;
    }

    return processedDoc;
  }

  /**
   * Extract field value from document source using dot notation for nested fields
   */
  private extractFieldValue(source: Record<string, any>, fieldPath: string): any {
    const parts = fieldPath.split('.');
    let current = source;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  /**
   * Normalize field content to string for analysis
   */
  private normalizeFieldContent(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || ''; // Return empty string for whitespace-only strings
    } else if (Array.isArray(value)) {
      const normalized = value
        .map(v => this.normalizeFieldContent(v))
        .filter(v => v.length > 0) // Filter out empty strings before joining
        .join(' ');
      return normalized || '';
    } else if (typeof value === 'number') {
      return value.toString();
    } else if (typeof value === 'boolean') {
      return value.toString();
    } else if (value instanceof Date) {
      return value.toISOString();
    } else if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return '';
  }

  /**
   * Get current mapping configuration
   */
  getMapping(): DocumentMapping {
    return { ...this.mapping };
  }

  /**
   * Set mapping configuration
   */
  setMapping(mapping: DocumentMapping): void {
    this.mapping = { ...mapping };

    // Validate analyzers in the mapping
    for (const [fieldName, fieldConfig] of Object.entries(this.mapping.fields)) {
      if (fieldConfig.analyzer) {
        const analyzer = this.analyzerRegistryService.getAnalyzer(fieldConfig.analyzer);
        if (!analyzer) {
          throw new Error(`Analyzer "${fieldConfig.analyzer}" not found for field "${fieldName}"`);
        }
      }
    }

    // Ensure default analyzer exists if specified
    if (this.mapping.defaultAnalyzer) {
      const defaultAnalyzer = this.analyzerRegistryService.getAnalyzer(
        this.mapping.defaultAnalyzer,
      );
      if (!defaultAnalyzer) {
        throw new Error(`Default analyzer "${this.mapping.defaultAnalyzer}" not found`);
      }
    }
  }

  /**
   * Initialize default mapping for common field types
   */
  initializeDefaultMapping(): void {
    this.mapping = {
      defaultAnalyzer: 'standard',
      fields: {
        title: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 2.0,
        },
        description: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 1.5,
        },
        content: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 1.0,
        },
        categories: {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 1.0,
        },
        price: {
          analyzer: 'standard',
          indexed: true,
          stored: true,
          weight: 1.0,
        },
        tags: {
          analyzer: 'keyword',
          indexed: true,
          stored: true,
          weight: 1.0,
        },
      },
    };
  }
}
