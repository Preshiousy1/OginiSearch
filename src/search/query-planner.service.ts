import { Injectable, Inject } from '@nestjs/common';
import {
  Query,
  TermQuery,
  PhraseQuery,
  BooleanQuery,
  QueryExecutionPlan,
  QueryExecutionStep,
  TermQueryStep,
  BooleanQueryStep,
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
      totalCost: step.cost,
      estimatedResults: step.estimatedResults,
    };
  }

  /**
   * Create an execution step for a query
   */
  private createExecutionStep(query: Query): QueryExecutionStep {
    switch (query.type) {
      case 'term':
        return this.createTermStep(query as TermQuery);
      case 'phrase':
        return this.createPhraseStep(query as PhraseQuery);
      case 'boolean':
        return this.createBooleanStep(query as BooleanQuery);
      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  /**
   * Create an execution step for a term query
   */
  private createTermStep(query: TermQuery): TermQueryStep {
    const fieldTerm = `${query.field}:${query.value}`;
    const documentFrequency = this.indexStats.getDocumentFrequency(fieldTerm);

    // Calculate cost based on document frequency (selectivity)
    // Lower frequency = higher selectivity = lower cost
    const cost = documentFrequency > 0 ? documentFrequency : 1000; // High cost for non-existent terms

    return {
      type: 'term',
      field: query.field,
      term: fieldTerm,
      cost,
      estimatedResults: documentFrequency,
    };
  }

  /**
   * Create an execution step for a phrase query
   * Phrases are more complex and costly than term queries
   */
  private createPhraseStep(query: PhraseQuery): QueryExecutionStep {
    // For phrase queries, we convert to a boolean AND of terms
    // with position checking during actual execution

    // Create a boolean step with all terms in the phrase
    const clauses: TermQuery[] = query.terms.map(term => ({
      type: 'term',
      field: query.field,
      value: term,
    }));

    const boolStep: BooleanQuery = {
      type: 'boolean',
      operator: 'and',
      clauses,
    };

    // Create a boolean execution step but mark as a phrase
    const step = this.createBooleanStep(boolStep);
    step.type = 'phrase'; // Override the type

    // Phrase matching is more expensive than boolean AND
    step.cost = step.cost * 1.5;

    // Phrase matches will be fewer than just the terms overlapping
    step.estimatedResults = Math.max(1, Math.floor(step.estimatedResults * 0.3));

    return step;
  }

  /**
   * Create an execution step for a boolean query
   * Optimize by ordering clauses by selectivity
   */
  private createBooleanStep(query: BooleanQuery): BooleanQueryStep {
    // Create steps for all clauses
    const steps = query.clauses.map(clause => this.createExecutionStep(clause));

    // Order steps by cost for efficient execution
    // Lowest cost (most selective) first for early termination
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
          steps.length > 0 ? Math.min(...steps.map(step => step.estimatedResults)) : 0;
        break;

      case 'or':
        // For OR, cost is sum, results is sum
        totalCost = steps.reduce((sum, step) => sum + step.cost, 0);
        estimatedResults = steps.reduce((sum, step) => sum + step.estimatedResults, 0);
        break;

      case 'not':
        // For NOT, cost is higher, results are harder to estimate
        totalCost = steps.reduce((sum, step) => sum + step.cost * 1.5, 0);
        // Estimate as 50% of total documents minus excluded results
        const totalDocs = this.indexStats.totalDocuments;
        estimatedResults = Math.max(
          0,
          totalDocs - steps.reduce((sum, step) => sum + step.estimatedResults, 0),
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
}
