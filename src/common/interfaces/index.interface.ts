export interface IndexConfig {
  searchableAttributes: string[];
  filterableAttributes?: string[];
  defaultAnalyzer: string;
  fieldAnalyzers?: Record<string, string>;
}

export interface IndexMetadata {
  name: string;
  config: IndexConfig;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
}

export interface ProcessedField {
  original: any;
  terms: string[];
  termFrequencies: Record<string, number>;
  length: number;
}

export interface ProcessedDocument {
  id: string;
  fields: Record<string, ProcessedField>;
  source: Record<string, any>;
  fieldLengths: Record<string, number>;
}
