import { Injectable } from '@nestjs/common';

export interface QueryBuildResult {
  sql: string;
  params: any[];
  nextParamIndex: number;
}

@Injectable()
export abstract class BaseQueryBuilder {
  /**
   * Build SQL query for the specific query type
   */
  abstract build(
    indexName: string,
    query: any,
    params: any[],
    paramIndex: number,
    searchFields?: string[],
  ): QueryBuildResult;

  /**
   * Helper to get field reference (handles .keyword fields)
   */
  protected getFieldReference(field: string): string {
    const baseField = field.includes('.keyword') ? field.split('.')[0] : field;
    return `d.content->>'${baseField}'`;
  }

  /**
   * Helper to add parameter and return next index
   */
  protected addParam(params: any[], value: any): number {
    params.push(value);
    return params.length;
  }
}
