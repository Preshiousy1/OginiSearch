import { SearchQuery } from './query-processor.interface';

export interface SearchRequest {
  type?: 'match' | 'term' | 'wildcard' | 'match_all';
  field?: string | string[];
  value?: string;
  query?:
    | string
    | {
        match?: {
          field?: string;
          value: string;
        };
        term?: {
          [field: string]: string;
        };
        wildcard?: {
          field?: string;
          value: string;
          boost?: number;
        };
        match_all?: {
          boost?: number;
        };
      };
  fields?: string[];
  boost?: number;
  from?: number;
  size?: number;
  sort?: string;
  filter?: Record<string, any>;
  highlight?: boolean;
  facets?: string[];
}

export interface SearchResponse {
  total: number;
  maxScore: number;
  hits: Array<{
    id: string;
    score: number;
    document: Record<string, any>;
    highlights?: Record<string, string[]>;
  }>;
  facets?: Record<string, any>;
  took?: number;
}
