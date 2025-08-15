import { Injectable, Logger } from '@nestjs/common';

export interface FilterResult {
  sql: string;
  nextParamIndex: number;
}

@Injectable()
export class FilterBuilderService {
  private readonly logger = new Logger(FilterBuilderService.name);

  /**
   * Build filter conditions from filter object
   */
  buildConditions(filter: any, params: any[], startIndex: number): FilterResult {
    if (!filter) {
      return { sql: '', nextParamIndex: startIndex };
    }

    if (filter.bool) {
      return this.buildBoolFilter(filter.bool, params, startIndex);
    }

    if (filter.term) {
      return this.buildTermFilter(filter.term, params, startIndex);
    }

    if (filter.range) {
      return this.buildRangeFilter(filter.range, params, startIndex);
    }

    throw new Error(`Unsupported filter type: ${Object.keys(filter).join(', ')}`);
  }

  /**
   * Build boolean filter with must/should/must_not clauses
   */
  private buildBoolFilter(boolFilter: any, params: any[], startIndex: number): FilterResult {
    const boolClauses: string[] = [];
    let paramIndex = startIndex;

    // Process MUST clauses (AND conditions)
    if (boolFilter.must && Array.isArray(boolFilter.must)) {
      for (const mustClause of boolFilter.must) {
        const clauseResult = this.buildSingleFilterClause(mustClause, params, paramIndex);
        if (clauseResult.sql) {
          boolClauses.push(clauseResult.sql);
          paramIndex = clauseResult.nextParamIndex;
        }
      }
    }

    // Process SHOULD clauses (OR conditions)
    if (boolFilter.should && Array.isArray(boolFilter.should)) {
      const shouldClauses: string[] = [];
      for (const shouldClause of boolFilter.should) {
        const clauseResult = this.buildSingleFilterClause(shouldClause, params, paramIndex);
        if (clauseResult.sql) {
          shouldClauses.push(clauseResult.sql);
          paramIndex = clauseResult.nextParamIndex;
        }
      }
      if (shouldClauses.length > 0) {
        boolClauses.push(`(${shouldClauses.join(' OR ')})`);
      }
    }

    // Process MUST_NOT clauses (NOT conditions)
    if (boolFilter.must_not && Array.isArray(boolFilter.must_not)) {
      for (const mustNotClause of boolFilter.must_not) {
        const clauseResult = this.buildSingleFilterClause(mustNotClause, params, paramIndex);
        if (clauseResult.sql) {
          boolClauses.push(`NOT (${clauseResult.sql})`);
          paramIndex = clauseResult.nextParamIndex;
        }
      }
    }

    // Combine all bool clauses with AND
    const sql = boolClauses.length > 0 ? ` AND (${boolClauses.join(' AND ')})` : '';

    return { sql, nextParamIndex: paramIndex };
  }

  /**
   * Build single filter clause
   */
  private buildSingleFilterClause(clause: any, params: any[], paramIndex: number): FilterResult {
    if (clause.term) {
      return this.buildTermFilter(clause.term, params, paramIndex);
    }

    if (clause.range) {
      return this.buildRangeFilter(clause.range, params, paramIndex);
    }

    if (clause.bool) {
      return this.buildBoolFilter(clause.bool, params, paramIndex);
    }

    this.logger.warn(`Unsupported filter clause type: ${Object.keys(clause).join(', ')}`);
    return { sql: '', nextParamIndex: paramIndex };
  }

  /**
   * Build term filter for exact matches
   */
  private buildTermFilter(termFilter: any, params: any[], paramIndex: number): FilterResult {
    let field: string;
    let value: any;

    // Handle both formats:
    // Standard: { field_name: value }
    // Extended: { field: 'field_name', value: value }
    if (termFilter.field && termFilter.value !== undefined) {
      // Extended format: { field: 'is_active', value: true }
      field = termFilter.field;
      value = termFilter.value;
    } else {
      // Standard format: { is_active: true }
      const [f, v] = Object.entries(termFilter)[0];
      field = f;
      value = v;
    }

    params.push(value);
    const fieldRef = this.getFieldReference(field);
    const sql = `${fieldRef} = $${paramIndex}::text`;

    return { sql, nextParamIndex: paramIndex + 1 };
  }

  /**
   * Build range filter for numeric/date comparisons
   */
  private buildRangeFilter(rangeFilter: any, params: any[], startIndex: number): FilterResult {
    const rangeClauses: string[] = [];
    let paramIndex = startIndex;

    Object.entries(rangeFilter).forEach(([field, conditions]) => {
      Object.entries(conditions as any).forEach(([op, value]) => {
        const operator = this.getRangeOperator(op);
        const fieldRef = this.getFieldReference(field);

        params.push(value);
        if (typeof value === 'number') {
          rangeClauses.push(`(${fieldRef})::numeric ${operator} $${paramIndex}::numeric`);
        } else {
          rangeClauses.push(`${fieldRef} ${operator} $${paramIndex}`);
        }
        paramIndex++;
      });
    });

    const sql = rangeClauses.length > 0 ? rangeClauses.join(' AND ') : '';
    return { sql, nextParamIndex: paramIndex };
  }

  /**
   * Get field reference handling .keyword subfields
   */
  private getFieldReference(field: string): string {
    // Handle .keyword subfields by extracting the base field name
    const baseField = field.includes('.keyword') ? field.split('.')[0] : field;
    return `d.content->>'${baseField}'`;
  }

  /**
   * Map range operators to SQL operators
   */
  private getRangeOperator(op: string): string {
    const operatorMap: Record<string, string> = {
      gte: '>=',
      gt: '>',
      lte: '<=',
      lt: '<',
      eq: '=',
    };

    return operatorMap[op] || '=';
  }

  /**
   * Combine multiple filter clauses
   */
  combineClauses(
    mustClauses: FilterResult[],
    shouldClauses: FilterResult[],
    mustNotClauses: FilterResult[],
  ): FilterResult {
    const allClauses: string[] = [];
    let maxParamIndex = 0;

    // Add must clauses (AND)
    mustClauses.forEach(clause => {
      if (clause.sql) {
        allClauses.push(clause.sql);
        maxParamIndex = Math.max(maxParamIndex, clause.nextParamIndex);
      }
    });

    // Add should clauses (OR)
    const shouldSqls = shouldClauses.filter(clause => clause.sql).map(clause => clause.sql);
    if (shouldSqls.length > 0) {
      allClauses.push(`(${shouldSqls.join(' OR ')})`);
      shouldClauses.forEach(clause => {
        maxParamIndex = Math.max(maxParamIndex, clause.nextParamIndex);
      });
    }

    // Add must not clauses (NOT)
    mustNotClauses.forEach(clause => {
      if (clause.sql) {
        allClauses.push(`NOT (${clause.sql})`);
        maxParamIndex = Math.max(maxParamIndex, clause.nextParamIndex);
      }
    });

    const sql = allClauses.length > 0 ? ` AND (${allClauses.join(' AND ')})` : '';
    return { sql, nextParamIndex: maxParamIndex };
  }
}
