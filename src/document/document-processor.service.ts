import { Injectable, Inject } from '@nestjs/common';
import {
  DocumentProcessor,
  DocumentMapping,
  RawDocument,
  ProcessedDocument,
  ProcessedField,
} from './interfaces/document-processor.interface';
import { AnalyzerRegistryService } from 'src/analysis/analyzer-registry.service';
@Injectable()
export class DocumentProcessorService implements DocumentProcessor {
  private mapping: DocumentMapping = { fields: {} };

  constructor(private readonly analyzerRegistryService: AnalyzerRegistryService) {}

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
    // Handle dot notation for nested fields
    const parts = fieldPath.split('.');

    // Start with the source object
    let value: any = source;

    // Traverse the path
    for (const part of parts) {
      // If we hit a null/undefined value or the property doesn't exist, return null
      if (value === null || value === undefined || !(part in value)) {
        return null;
      }

      // Move to the next level
      value = value[part];
    }

    return value;
  }

  /**
   * Normalize field content to string for analysis
   */
  private normalizeFieldContent(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map(item => this.normalizeFieldContent(item)).join(' ');
    }

    if (typeof value === 'object') {
      // For dates, convert to ISO string
      if (value instanceof Date) {
        return value.toISOString();
      }

      // For other objects, stringify
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
}
