import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder, QueryBuildResult } from './base-query-builder';

@Injectable()
export class WildcardQueryBuilder extends BaseQueryBuilder {
  build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchQueryFields?: string[],
  ): QueryBuildResult {
    if (!query.wildcard) {
      throw new Error('Wildcard query requires wildcard object');
    }

    let field: string;
    let wildcardValue: string;
    let boost = 1.0;

    // Handle different wildcard query formats
    if ('field' in query.wildcard && 'value' in query.wildcard) {
      field = query.wildcard.field as string;
      wildcardValue = String(query.wildcard.value);
      boost = typeof query.wildcard.boost === 'number' ? query.wildcard.boost : 1.0;
    } else {
      const [f, pattern] = Object.entries(query.wildcard)[0];
      field = f;
      if (typeof pattern === 'object' && 'value' in pattern) {
        wildcardValue = String(pattern.value);
        boost = typeof (pattern as any).boost === 'number' ? (pattern as any).boost : 1.0;
      } else {
        wildcardValue = String(pattern);
      }
    }

    const likePattern = wildcardValue.replace(/\*/g, '%').replace(/\?/g, '_');
    const paramIdx = this.addParam(params, likePattern);

    let sql: string;

    // Handle _all field by searching across specified fields or entire content
    if (field === '_all') {
      if (searchQueryFields && searchQueryFields.length > 0) {
        const fieldConditions = searchQueryFields
          .map(f => `d.content->>'${f.replace('.keyword', '')}' ILIKE $${paramIdx}::text`)
          .join(' OR ');
        sql = `
          ${boost}::float as score
        FROM documents d
        WHERE d.index_name = $1
          AND (${fieldConditions})`;
      } else {
        sql = `
          ${boost}::float as score
        FROM documents d
        WHERE d.index_name = $1
          AND d.content::text ILIKE '%' || $${paramIdx}::text || '%'`;
      }
    } else {
      const fieldRef = this.getFieldReference(field);
      sql = `
        ${boost}::float as score
      FROM documents d
      WHERE d.index_name = $1
        AND ${fieldRef} ILIKE $${paramIdx}::text`;
    }

    return {
      sql,
      params,
      nextParamIndex: paramIdx + 1,
    };
  }
}
