export interface SearchParams {
  query: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, any>;
}

export interface SearchResults {
  hits: SearchHit[];
  totalHits: number;
  processingTimeMs: number;
  query: string;
}

export interface SearchHit {
  id: string;
  score: number;
  document: any;
}
