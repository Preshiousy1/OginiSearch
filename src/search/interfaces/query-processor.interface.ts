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
