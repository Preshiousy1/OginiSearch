import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder, QueryBuildResult } from './base-query-builder';

@Injectable()
export class TermQueryBuilder extends BaseQueryBuilder {
  build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchFields?: string[],
  ): QueryBuildResult {
    if (!query.term) {
      throw new Error('Term query requires term object');
    }

    const [field, value] = Object.entries(query.term)[0];
    const boost = (query.term as any).boost || 1.0;

    const paramIdx = this.addParam(params, value);
    const fieldRef = this.getFieldReference(field);

    const sql = `
      ${boost}::float as score
    FROM documents d
    WHERE d.index_name = $1
      AND ${fieldRef} = $${paramIdx}::text`;

    return {
      sql,
      params,
      nextParamIndex: paramIdx + 1,
    };
  }
}
