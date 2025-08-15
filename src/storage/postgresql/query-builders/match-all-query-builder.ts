import { Injectable } from '@nestjs/common';
import { BaseQueryBuilder, QueryBuildResult } from './base-query-builder';

@Injectable()
export class MatchAllQueryBuilder extends BaseQueryBuilder {
  build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchFields?: string[],
  ): QueryBuildResult {
    const boost = query.match_all?.boost || 1.0;

    const sql = `
      ${boost}::float as score
    FROM search_documents sd
    JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
    WHERE sd.index_name = $1`;

    return {
      sql,
      params,
      nextParamIndex: paramIndex,
    };
  }
}
