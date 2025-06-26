import { Injectable, Inject } from '@nestjs/common';
import {
  Query,
  TermQuery,
  PhraseQuery,
  BooleanQuery,
  WildcardQuery,
  MatchAllQuery,
  QueryExecutionPlan,
  QueryExecutionStep,
  TermQueryStep,
  BooleanQueryStep,
  WildcardQueryStep,
  MatchAllQueryStep,
  PhraseQueryStep,
} from './interfaces/query-processor.interface';
import { IndexStatsService } from '../index/index-stats.service';

@Injectable()
export class QueryPlannerService {
  constructor(private readonly indexStats: IndexStatsService) {}

  /**
   * Create an execution plan for a query
   */
  createPlan(query: Query): QueryExecutionPlan {
    // Create execution steps for the query
    const step = this.createExecutionStep(query);

    return {
      steps: [step],
      cost: step.cost,
      estimatedResults: step.estimatedResults,
    };
  }

  /**
   * Create an execution step for a query
   */
  private createExecutionStep(query: Query): QueryExecutionStep {
    const queryType = query.type as 'term' | 'phrase' | 'boolean' | 'wildcard' | 'match_all';
    switch (queryType) {
      case 'term':
        return this.createTermStep(query as TermQuery);
      case 'phrase':
        return this.createPhraseStep(query as PhraseQuery);
      case 'boolean':
        return this.createBooleanStep(query as BooleanQuery);
      case 'wildcard':
        return this.createWildcardStep(query as WildcardQuery);
      case 'match_all':
        return this.createMatchAllStep(query as MatchAllQuery);
      default:
        throw new Error(`Unsupported query type: ${queryType}`);
    }
  }

  /**
   * Create an execution step for a term query
   */
  private createTermStep(query: TermQuery): TermQueryStep {
    // Get document frequency for cost calculation
    const fieldTerm = `${query.field}:${query.value}`;
    const documentFrequency = this.indexStats.getDocumentFrequency(fieldTerm);

    // Calculate cost based on document frequency (selectivity)
    // Lower frequency = higher selectivity = lower cost
    const cost = documentFrequency > 0 ? documentFrequency : 1000; // High cost for non-existent terms

    return {
      type: 'term',
      field: query.field,
      term: query.value,
      cost,
      estimatedResults: documentFrequency,
    };
  }

  /**
   * Create an execution step for a wildcard query
   */
  private createWildcardStep(query: WildcardQuery): WildcardQueryStep {
    // Check if pattern exists
    if (!query.pattern) {
      throw new Error(`Wildcard query missing pattern property. Query: ${JSON.stringify(query)}`);
    }

    // Calculate cost based on wildcard complexity
    const wildcardCount =
      (query.pattern.match(/\*/g) || []).length + (query.pattern.match(/\?/g) || []).length;

    // Higher cost for leading wildcards
    const hasLeadingWildcard = query.pattern.startsWith('*') || query.pattern.startsWith('?');
    const leadingWildcardPenalty = hasLeadingWildcard ? 1000 : 0;

    // Cost also increases with non-wildcard length
    const nonWildcardLength = query.pattern.replace(/[*?]/g, '').length;
    const lengthCost = Math.max(1, nonWildcardLength);

    // Total cost combines all factors
    const cost = wildcardCount * 2 + leadingWildcardPenalty + lengthCost;

    // Compile wildcard pattern to regex
    const regexPattern = this.compileWildcardPattern(query.pattern);

    return {
      type: 'wildcard',
      field: query.field,
      pattern: query.pattern,
      compiledPattern: regexPattern,
      cost,
      estimatedResults: Math.ceil(this.indexStats.totalDocuments * 0.1), // Rough estimate: 10% of total docs
    };
  }

  /**
   * Create an execution step for a match-all query
   */
  private createMatchAllStep(query: MatchAllQuery): MatchAllQueryStep {
    const totalDocs = this.indexStats.totalDocuments;

    return {
      type: 'match_all',
      boost: query.boost || 1.0,
      cost: totalDocs,
      estimatedResults: totalDocs,
    };
  }

  /**
   * Compile wildcard pattern to regex
   */
  private compileWildcardPattern(pattern: string): RegExp {
    // Escape regex special characters except * and ?
    let regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Convert wildcard characters to regex equivalents
    regexPattern = regexPattern.replace(/\*/g, '.*').replace(/\?/g, '.');

    // Make case-insensitive and match from start to end
    return new RegExp(`^${regexPattern}$`, 'i');
  }

  /**
   * Create an execution step for a phrase query
   */
  private createPhraseStep(query: PhraseQuery): PhraseQueryStep {
    // Create a phrase step
    const step: PhraseQueryStep = {
      type: 'phrase',
      field: query.field,
      terms: query.terms,
      cost: query.terms.length * 2, // Base cost on number of terms
      estimatedResults: Math.ceil(this.indexStats.totalDocuments * 0.01), // Rough estimate: 1% of total docs
    };

    return step;
  }

  /**
   * Create an execution step for a boolean query
   */
  private createBooleanStep(query: BooleanQuery): BooleanQueryStep {
    // Create steps for all clauses
    const steps = query.clauses.map(clause => this.createExecutionStep(clause));

    // Order steps by cost for efficient execution
    steps.sort((a, b) => a.cost - b.cost);

    // Calculate total cost and estimated results
    let totalCost = 0;
    let estimatedResults = 0;

    // Calculate based on operator type
    switch (query.operator) {
      case 'and':
        // For AND, cost is sum of all steps, results is minimum
        totalCost = steps.reduce((sum, step) => sum + step.cost, 0);
        estimatedResults =
          steps.length > 0 ? Math.min(...steps.map(step => step.estimatedResults || 0)) : 0;
        break;

      case 'or':
        // For OR, cost is sum, results is sum
        totalCost = steps.reduce((sum, step) => sum + step.cost, 0);
        estimatedResults = steps.reduce((sum, step) => sum + (step.estimatedResults || 0), 0);
        break;

      case 'not':
        // For NOT, cost is higher, results are harder to estimate
        totalCost = steps.reduce((sum, step) => sum + step.cost * 1.5, 0);
        // Estimate as 50% of total documents minus excluded results
        const totalDocs = this.indexStats.totalDocuments;
        estimatedResults = Math.max(
          0,
          totalDocs - steps.reduce((sum, step) => sum + (step.estimatedResults || 0), 0),
        );
        break;
    }

    return {
      type: 'boolean',
      operator: query.operator,
      steps,
      cost: totalCost,
      estimatedResults,
    };
  }

  private isTermQuery(query: Query): query is TermQuery {
    return query.type === 'term';
  }

  private isPhraseQuery(query: Query): query is PhraseQuery {
    return query.type === 'phrase';
  }

  private isBooleanQuery(query: Query): query is BooleanQuery {
    return query.type === 'boolean';
  }

  private isWildcardQuery(query: Query): query is WildcardQuery {
    return query.type === 'wildcard';
  }

  private isMatchAllQuery(query: Query): query is MatchAllQuery {
    return query.type === 'match_all';
  }
}
