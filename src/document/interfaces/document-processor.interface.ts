/**
 * Configuration for a field in a document
 */
export interface FieldConfig {
  /**
   * Name of the analyzer to use for this field
   */
  analyzer?: string;

  /**
   * Whether to index this field (default: true)
   */
  indexed?: boolean;

  /**
   * Whether to store original field value (default: true)
   */
  stored?: boolean;

  /**
   * Field weight for relevance scoring (default: 1.0)
   */
  weight?: number;
}

/**
 * Document mapping configuration
 */
export interface DocumentMapping {
  /**
   * Field configurations by field name
   */
  fields: Record<string, FieldConfig>;

  /**
   * Default analyzer to use for fields without a specific analyzer
   */
  defaultAnalyzer?: string;
}

/**
 * Raw input document structure
 */
export interface RawDocument {
  /**
   * Document identifier
   */
  id: string;

  /**
   * Document source data
   */
  source: Record<string, any>;
}

/**
 * Processed field with extracted terms
 */
export interface ProcessedField {
  /**
   * Original field value
   */
  original: any;

  /**
   * Extracted terms from field
   */
  terms: string[];

  /**
   * Term frequencies (term -> frequency map)
   */
  termFrequencies: Record<string, number>;

  /**
   * Field length (number of tokens)
   */
  length: number;

  /**
   * Term positions (term -> position array)
   */
  positions?: Record<string, number[]>;
}

/**
 * Document after processing
 */
export interface ProcessedDocument {
  /**
   * Document identifier
   */
  id: string;

  /**
   * Original document source
   */
  source: Record<string, any>;

  /**
   * Processed fields
   */
  fields: Record<string, ProcessedField>;

  /**
   * Field lengths (for BM25 calculation)
   */
  fieldLengths: Record<string, number>;
}

/**
 * Interface for document processors
 */
export interface DocumentProcessor {
  /**
   * Process a document for indexing
   */
  processDocument(document: RawDocument): ProcessedDocument;

  /**
   * Get mapping configuration
   */
  getMapping(): DocumentMapping;

  /**
   * Set mapping configuration
   */
  setMapping(mapping: DocumentMapping): void;
}
