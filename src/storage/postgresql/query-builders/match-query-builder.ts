import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder, QueryBuildResult } from './base-query-builder';

@Injectable()
export class MatchQueryBuilder extends BaseQueryBuilder {
  build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchFields?: string[],
  ): QueryBuildResult {
    if (!query.match?.value) {
      throw new Error('Match query requires value field');
    }

    const value = query.match.value;
    const boost = query.match.boost || 1.0;
    const field = query.match.field;

    const paramIdx = this.addParam(params, value);

    let sql: string;

    if (field && field !== '_all') {
      // Field-specific search
      const fieldRef = this.getFieldReference(field);
      sql = `
        CASE WHEN ${fieldRef} ILIKE '%' || $${paramIdx}::text || '%' 
        THEN ${boost}::float * (1.0 + ts_rank_cd(to_tsvector('english', ${fieldRef}), plainto_tsquery('english', $${paramIdx}::text)))
        ELSE 0 END as score
      FROM documents d
      WHERE d.index_name = $1
        AND ${fieldRef} ILIKE '%' || $${paramIdx}::text || '%'`;
    } else if (searchFields && searchFields.length > 0) {
      // Multi-field search using searchFields
      const fieldConditions = searchFields
        .map(
          f => `d.content->>'${f.replace('.keyword', '')}' ILIKE '%' || $${paramIdx}::text || '%'`,
        )
        .join(' OR ');

      sql = `
        ${boost}::float as score
      FROM documents d  
      WHERE d.index_name = $1
        AND (${fieldConditions})`;
    } else {
      // Full-text search using materialized_vector (optimized) with fallback
      sql = `
        ts_rank_cd(COALESCE(sd.materialized_vector, sd.search_vector), plainto_tsquery('english', $${paramIdx}::text)) * ${boost} as score
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1
        AND COALESCE(sd.materialized_vector, sd.search_vector) @@ plainto_tsquery('english', $${paramIdx}::text)`;
    }

    return {
      sql,
      params,
      nextParamIndex: paramIdx + 1,
    };
  }
}
