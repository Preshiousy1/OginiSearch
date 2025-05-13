export type IndexStatus = 'creating' | 'open' | 'closed' | 'deleting';

export interface IndexSettings {
  // Indexing settings
  analysis?: {
    analyzer?: Record<string, Analyzer>;
    tokenizer?: Record<string, Tokenizer>;
    filter?: Record<string, TokenFilter>;
  };

  // Search settings
  similarity?: string; // e.g., 'bm25', 'tfidf', 'boolean'
  searchableFields?: string[];

  // Storage settings
  numberOfShards?: number;
  numberOfReplicas?: number;
  refreshInterval?: string; // e.g., '1s', '5s'

  // Caching settings
  cacheEnabled?: boolean;
  cacheTtl?: number; // in seconds
}

export interface FieldMapping {
  type: 'text' | 'keyword' | 'integer' | 'float' | 'date' | 'boolean' | 'object' | 'nested';
  analyzer?: string;
  searchAnalyzer?: string;
  store?: boolean;
  index?: boolean;
  boost?: number;
  fields?: Record<string, FieldMapping>; // For multi-fields
}

export interface IndexMappings {
  dynamic?: boolean | 'strict' | 'runtime';
  properties: Record<string, FieldMapping>;
}

export interface IndexStats {
  documentCount: number;
  averageDocumentSize: number;
  totalTerms: number;
  vocabularySize: number;
  lastUpdated: Date;
}

export interface Index {
  // Basic metadata
  name: string;
  createdAt: string;
  updatedAt?: string;

  // Configuration
  settings: IndexSettings;
  mappings: IndexMappings;

  // Status information
  status: IndexStatus;
  health?: 'green' | 'yellow' | 'red';

  // Statistics
  documentCount: number;
  storageSize?: number;
  stats?: IndexStats;
}

// Supporting interfaces
export interface Analyzer {
  type: string;
  tokenizer?: string;
  filter?: string[];
  charFilter?: string[];
}

export interface Tokenizer {
  type: string;
  pattern?: string;
  flags?: string;
  // Other tokenizer-specific options
}

export interface TokenFilter {
  type: string;
  // Filter-specific options
}
