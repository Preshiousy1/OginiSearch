import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SearchDocument } from './entities/search-document.entity';

export interface QueryBuilderOptions {
  indexName: string;
  limit?: number;
  offset?: number;
  fieldWeights?: Record<string, number>;
  boostFactor?: number;
}

export interface SQLQuery {
  query: string;
  parameters: any[];
  countQuery?: string;
}

@Injectable()
export class PostgreSQLQueryBuilder {
  constructor(
    @InjectRepository(SearchDocument)
    private readonly searchDocumentRepository: Repository<SearchDocument>,
  ) {}

  /**
   * Build term query - searches for specific terms in tsvector
   */
  buildTermQuery(term: string, options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;
    const sanitizedTerm = this.sanitizeForTsquery(term);

    const baseQuery = `
      SELECT 
        sd.id, sd.doc_id, sd.index_name, sd.content, sd.field_lengths, sd.boost_factor,
        sd.created_at, sd.updated_at,
        ts_rank_cd(sd.search_vector, plainto_tsquery('english', $2)) as pg_rank,
        (ts_rank_cd(sd.search_vector, plainto_tsquery('english', $2)) * sd.boost_factor * $4) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ plainto_tsquery('english', $2)
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $3 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ plainto_tsquery('english', $2)
    `;

    return {
      query: baseQuery,
      parameters: [indexName, sanitizedTerm, limit, boostFactor, offset],
      countQuery,
    };
  }

  /**
   * Build phrase query - searches for exact phrases
   */
  buildPhraseQuery(phrase: string, options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;

    const phraseQuery = phrase
      .trim()
      .split(/\s+/)
      .map(word => this.sanitizeForTsquery(word))
      .join(' <-> ');

    const baseQuery = `
      SELECT 
        sd.id, sd.doc_id, sd.index_name, sd.content, sd.field_lengths, sd.boost_factor,
        sd.created_at, sd.updated_at,
        ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) as pg_rank,
        (ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) * sd.boost_factor * $4 * 1.5) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $3 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
    `;

    return {
      query: baseQuery,
      parameters: [indexName, phraseQuery, limit, boostFactor, offset],
      countQuery,
    };
  }

  /**
   * Build boolean query - supports AND, OR, NOT operations
   */
  buildBooleanQuery(booleanExpression: string, options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;
    const tsqueryExpression = this.convertToTsquery(booleanExpression);

    const baseQuery = `
      SELECT 
        sd.id, sd.doc_id, sd.index_name, sd.content, sd.field_lengths, sd.boost_factor,
        sd.created_at, sd.updated_at,
        ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) as pg_rank,
        (ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) * sd.boost_factor * $4) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $3 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
    `;

    return {
      query: baseQuery,
      parameters: [indexName, tsqueryExpression, limit, boostFactor, offset],
      countQuery,
    };
  }

  /**
   * Build wildcard query - supports prefix and suffix matching
   */
  buildWildcardQuery(wildcardTerm: string, options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;
    const tsqueryWildcard = this.convertWildcardToTsquery(wildcardTerm);

    const baseQuery = `
      SELECT 
        sd.id, sd.doc_id, sd.index_name, sd.content, sd.field_lengths, sd.boost_factor,
        sd.created_at, sd.updated_at,
        ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) as pg_rank,
        (ts_rank_cd(sd.search_vector, to_tsquery('english', $2)) * sd.boost_factor * $4) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $3 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM search_documents sd
      WHERE sd.index_name = $1 AND sd.search_vector @@ to_tsquery('english', $2)
    `;

    return {
      query: baseQuery,
      parameters: [indexName, tsqueryWildcard, limit, boostFactor, offset],
      countQuery,
    };
  }

  /**
   * Build match-all query - returns all documents in index
   */
  buildMatchAllQuery(options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;

    const baseQuery = `
      SELECT 
        sd.id, sd.doc_id, sd.index_name, sd.content, sd.field_lengths, sd.boost_factor,
        sd.created_at, sd.updated_at,
        1.0 as pg_rank, (1.0 * sd.boost_factor * $3) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $2 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM search_documents sd WHERE sd.index_name = $1
    `;

    return {
      query: baseQuery,
      parameters: [indexName, limit, boostFactor, offset],
      countQuery,
    };
  }

  /**
   * Build business-optimized query with Nigerian context
   */
  buildBusinessQuery(searchTerm: string, options: QueryBuilderOptions): SQLQuery {
    const { indexName, limit = 50, offset = 0, boostFactor = 1.0 } = options;

    // Business field weights: name(3.0), category(2.0), description(1.5)
    const businessWeights = {
      name: 3.0,
      category_name: 2.0,
      description: 1.5,
      tags: 1.5,
      location: 1.2,
      ...options.fieldWeights,
    };

    const sanitizedTerm = this.sanitizeForTsquery(searchTerm);

    // Nigerian business context boosting
    const nigerianBoost = this.isNigerianBusinessContext(searchTerm) ? 1.3 : 1.0;

    const baseQuery = `
      SELECT 
        sd.id,
        sd.doc_id,
        sd.index_name,
        sd.content,
        sd.field_lengths,
        sd.boost_factor,
        sd.created_at,
        sd.updated_at,
        ts_rank_cd(
          setweight(sd.search_vector, 'A'), 
          plainto_tsquery('english', $2)
        ) as pg_rank,
        (
          ts_rank_cd(setweight(sd.search_vector, 'A'), plainto_tsquery('english', $2)) * 
          sd.boost_factor * 
          $4 * 
          $5
        ) as final_score
      FROM search_documents sd
      WHERE sd.index_name = $1
        AND sd.search_vector @@ plainto_tsquery('english', $2)
      ORDER BY final_score DESC, sd.created_at DESC
      LIMIT $3 OFFSET $6
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM search_documents sd
      WHERE sd.index_name = $1
        AND sd.search_vector @@ plainto_tsquery('english', $2)
    `;

    return {
      query: baseQuery,
      parameters: [indexName, sanitizedTerm, limit, boostFactor, nigerianBoost, offset],
      countQuery,
    };
  }

  // Helper methods
  private sanitizeForTsquery(term: string): string {
    return term
      .replace(/[&|!():*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private convertToTsquery(booleanExpression: string): string {
    return booleanExpression
      .replace(/\bAND\b/gi, ' & ')
      .replace(/\bOR\b/gi, ' | ')
      .replace(/\bNOT\b/gi, ' !')
      .replace(/[()]/g, match => match)
      .replace(/\s+/g, ' ')
      .trim();
  }

  private convertWildcardToTsquery(wildcardTerm: string): string {
    return wildcardTerm
      .replace(/\*/g, ':*')
      .replace(/[^a-zA-Z0-9:*\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isNigerianBusinessContext(searchTerm: string): boolean {
    const nigerianKeywords = [
      'dangote',
      'lagos',
      'abuja',
      'kano',
      'nigeria',
      'naira',
      'gtbank',
      'zenith',
      'access',
      'fidelity',
      'uba',
      'fcmb',
      'mtn',
      'airtel',
      'glo',
      '9mobile',
      'konga',
      'jumia',
      'paystack',
      'flutterwave',
      'nollywood',
      'afrobeats',
      'jollof',
      'eko',
      'ikeja',
      'vi',
      'mainland',
      'island',
    ];

    return nigerianKeywords.some(keyword => searchTerm.toLowerCase().includes(keyword));
  }
}
