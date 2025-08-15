import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder, QueryBuildResult } from './base-query-builder';

@Injectable()
export class BoolQueryBuilder extends BaseQueryBuilder {
  build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchFields?: string[],
  ): QueryBuildResult {
    if (!query.bool) {
      throw new Error('Bool query requires bool object');
    }

    let sql = `
      1.0 as score
    FROM documents d
    WHERE d.index_name = $1`;

    let currentParamIndex = paramIndex;

    // Process MUST clauses (AND conditions)
    if (query.bool.must) {
      query.bool.must.forEach((mustClause: any) => {
        if (mustClause.match) {
          const paramIdx = this.addParam(params, mustClause.match.value);
          const field = mustClause.match.field;

          if (field) {
            // Field-specific search
            const fieldRef = this.getFieldReference(field);
            sql += ` AND ${fieldRef} ILIKE '%' || $${paramIdx}::text || '%'`;
          } else if (searchFields && searchFields.length > 0) {
            // Multi-field search using searchFields
            const fieldConditions = searchFields
              .map(
                f =>
                  `d.content->>'${f.replace(
                    '.keyword',
                    '',
                  )}' ILIKE '%' || $${paramIdx}::text || '%'`,
              )
              .join(' OR ');
            sql += ` AND (${fieldConditions})`;
          } else {
            // Default to name field if no specific field or searchFields provided
            sql += ` AND d.content->>'name' ILIKE '%' || $${paramIdx}::text || '%'`;
          }
          currentParamIndex = paramIdx;
        }
      });
    }

    // Process SHOULD clauses (OR conditions)
    if (query.bool.should) {
      const shouldClauses: string[] = [];
      query.bool.should.forEach((shouldClause: any) => {
        if (shouldClause.match) {
          const paramIdx = this.addParam(params, shouldClause.match.value);
          const field = shouldClause.match.field;

          if (field) {
            // Field-specific search
            const fieldRef = this.getFieldReference(field);
            shouldClauses.push(`${fieldRef} ILIKE '%' || $${paramIdx}::text || '%'`);
          } else if (searchFields && searchFields.length > 0) {
            // Multi-field search using searchFields
            const fieldConditions = searchFields
              .map(
                f =>
                  `d.content->>'${f.replace(
                    '.keyword',
                    '',
                  )}' ILIKE '%' || $${paramIdx}::text || '%'`,
              )
              .join(' OR ');
            shouldClauses.push(`(${fieldConditions})`);
          } else {
            // Default to name field
            shouldClauses.push(`d.content->>'name' ILIKE '%' || $${paramIdx}::text || '%'`);
          }
          currentParamIndex = paramIdx;
        }
      });
      if (shouldClauses.length > 0) {
        sql += ` AND (${shouldClauses.join(' OR ')})`;
      }
    }

    // Process MUST_NOT clauses (NOT conditions)
    if (query.bool.must_not) {
      query.bool.must_not.forEach((mustNotClause: any) => {
        if (mustNotClause.match) {
          const paramIdx = this.addParam(params, mustNotClause.match.value);
          const field = mustNotClause.match.field;

          if (field) {
            // Field-specific search
            const fieldRef = this.getFieldReference(field);
            sql += ` AND NOT (${fieldRef} ILIKE '%' || $${paramIdx}::text || '%')`;
          } else if (searchFields && searchFields.length > 0) {
            // Multi-field search using searchFields
            const fieldConditions = searchFields
              .map(
                f =>
                  `d.content->>'${f.replace(
                    '.keyword',
                    '',
                  )}' ILIKE '%' || $${paramIdx}::text || '%'`,
              )
              .join(' OR ');
            sql += ` AND NOT (${fieldConditions})`;
          } else {
            // Default to name field
            sql += ` AND NOT (d.content->>'name' ILIKE '%' || $${paramIdx}::text || '%')`;
          }
          currentParamIndex = paramIdx;
        }
      });
    }

    return {
      sql,
      params,
      nextParamIndex: currentParamIndex + 1,
    };
  }
}
