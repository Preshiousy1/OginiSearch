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
