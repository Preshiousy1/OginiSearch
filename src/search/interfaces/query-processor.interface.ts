/**
 * Base query interface
 */
export interface Query {
  type: string;
  operator?: 'and' | 'or' | 'not';
  clauses?: Query[] | PhraseQuery[];
  text?: string;
  fields?: string[];
}

/**
 * Simple term query
 */
export interface TermQuery extends Query {
  type: 'term';
  field: string;
  value: string;
}

/**
 * Phrase query (multiple consecutive terms)
 */
export interface PhraseQuery extends Query {
  type: 'phrase';
  field: string;
  terms: string[];
}

/**
 * Boolean query (combines multiple queries with operators)
 */
export interface BooleanQuery extends Query {
  type: 'boolean';
  operator: 'and' | 'or' | 'not';
  clauses: Query[];
}

/**
 * Wildcard query (supports * and ? patterns)
 */
export interface WildcardQuery extends Query {
  type: 'wildcard';
  field?: string;
  value: string;
}

/**
 * Match-all query (returns all documents)
 */
export interface MatchAllQuery extends Query {
  type: 'match_all';
  boost?: number;
}

/**
 * Raw input query from user
 */
export interface RawQuery {
  query:
    | string
    | {
        match?: {
          field?: string;
          value: string;
        };
        match_all?: {
          boost?: number;
        };
        wildcard?:
          | {
              [field: string]: {
                value: string;
                boost?: number;
              };
            }
          | {
              field?: string;
              value: string;
              boost?: number;
            };
        term?: Record<string, any>;
      };
  fields?: string[];
  // Additional query parameters
  offset?: number;
  limit?: number;
  filters?: Record<string, any>;
}

/**
 * Processed query ready for execution
 */
export interface ProcessedQuery {
  original: RawQuery;
  parsedQuery: Query;
  executionPlan?: QueryExecutionPlan;
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
  totalCost: number;
  estimatedResults: number;
}

/**
 * Base execution step
 */
export interface QueryExecutionStep {
  type: string;
  cost: number;
  estimatedResults: number;
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
  type: 'boolean' | 'phrase';
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
  steps: QueryExecutionStep[];
  positions?: number[]; // Relative positions of terms in the phrase
}

/**
 * Wildcard execution step
 */
export interface WildcardQueryStep extends QueryExecutionStep {
  type: 'wildcard';
  field?: string;
  pattern: string;
  compiledPattern?: RegExp;
}

/**
 * Match-all execution step
 */
export interface MatchAllQueryStep extends QueryExecutionStep {
  type: 'match_all';
  boost?: number;
}
