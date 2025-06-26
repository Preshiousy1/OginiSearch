/**
 * Base query types
 */
export type Query = TermQuery | PhraseQuery | BooleanQuery | WildcardQuery | MatchAllQuery;

/**
 * Simple term query
 */
export interface TermQuery {
  type: 'term';
  field: string;
  value: string;
}

/**
 * Phrase query (multiple consecutive terms)
 */
export interface PhraseQuery {
  type: 'phrase';
  field: string;
  terms: string[];
  text?: string;
  fields?: string[];
}

/**
 * Boolean query (combines multiple queries with operators)
 */
export interface BooleanQuery {
  type: 'boolean';
  operator: 'and' | 'or' | 'not';
  clauses: Query[];
  text?: string;
  fields?: string[];
}

/**
 * Wildcard query (supports * and ? patterns)
 */
export interface WildcardQuery {
  type: 'wildcard';
  field: string;
  pattern: string;
  value: string;
  boost?: number;
  text?: string;
  fields?: string[];
}

/**
 * Match-all query (returns all documents)
 */
export interface MatchAllQuery {
  type: 'match_all';
  boost?: number;
  text?: string;
  fields?: string[];
}

/**
 * Raw input query from user
 */
export interface RawQuery {
  type?: string;
  query?:
    | string
    | {
        match?: {
          field?: string;
          value: string;
        };
        term?: Record<string, any>;
        wildcard?:
          | string
          | {
              field?: string;
              value: string;
              boost?: number;
            };
        match_all?: {
          boost?: number;
        };
      };
  fields?: string[];
  value?: string;
  boost?: number;
}

/**
 * Processed query ready for execution
 */
export interface ProcessedQuery {
  original: RawQuery;
  parsedQuery: Query;
  executionPlan: QueryExecutionPlan;
}

/**
 * Query processor interface
 */
export interface QueryProcessor {
  processQuery(rawQuery: RawQuery): ProcessedQuery;
}

/**
 * Query execution plan
 */
export interface QueryExecutionPlan {
  steps: QueryExecutionStep[];
  cost: number;
  estimatedResults?: number;
}

/**
 * Base execution step
 */
export interface QueryExecutionStep {
  type: string;
  cost: number;
  estimatedResults?: number;
}

/**
 * Term execution step
 */
export interface TermQueryStep extends QueryExecutionStep {
  type: 'term';
  field: string;
  term: string;
}

/**
 * Boolean execution step
 */
export interface BooleanQueryStep extends QueryExecutionStep {
  type: 'boolean';
  operator: 'and' | 'or' | 'not';
  steps: QueryExecutionStep[];
}

/**
 * Phrase execution step
 */
export interface PhraseQueryStep extends QueryExecutionStep {
  type: 'phrase';
  field: string;
  terms: string[];
  positions?: number[];
}

/**
 * Wildcard execution step
 */
export interface WildcardQueryStep extends QueryExecutionStep {
  type: 'wildcard';
  field: string;
  pattern: string;
  compiledPattern: RegExp;
}

/**
 * Match-all execution step
 */
export interface MatchAllQueryStep extends QueryExecutionStep {
  type: 'match_all';
  boost: number;
}

export type SearchQuery = Query & {
  type: 'term' | 'phrase' | 'boolean' | 'wildcard' | 'match_all';
  field?: string;
  value?: string;
  pattern?: string;
  boost?: number;
  operator?: 'and' | 'or' | 'not';
  clauses?: Query[];
  terms?: string[];
};
