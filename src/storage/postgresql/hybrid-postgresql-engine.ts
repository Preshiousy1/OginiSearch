import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchDocument } from './entities/search-document.entity';
import { PostgreSQLQueryBuilder, QueryBuilderOptions } from './postgresql-query-builder';
import { BM25Scorer } from '../../index/bm25-scorer';
import { SearchResponse } from '../../search/interfaces/search.interface';

export interface HybridSearchOptions {
  indexName: string;
  query: string;
  limit?: number;
  offset?: number;
  candidateLimit?: number;
  fieldWeights?: Record<string, number>;
  businessBoost?: boolean;
}

export interface SearchCandidate {
  id: string;
  docId: string;
  content: any;
  fieldLengths: any;
  boostFactor: number;
  pgRank: number;
  finalScore: number;
}

@Injectable()
export class HybridPostgreSQLEngine {
  private readonly logger = new Logger(HybridPostgreSQLEngine.name);

  // Business field weights optimized for Nigerian companies
  private readonly businessFieldWeights = {
    name: 3.0,
    category_name: 2.0,
    description: 1.5,
    tags: 1.5,
    location: 1.2,
    contact_info: 1.0,
    services: 1.3,
    products: 1.3,
  };

  constructor(
    @InjectRepository(SearchDocument)
    private readonly searchDocumentRepository: Repository<SearchDocument>,
    private readonly queryBuilder: PostgreSQLQueryBuilder,
    private readonly bm25Scorer: BM25Scorer,
  ) {}

  /**
   * Two-stage hybrid search: PostgreSQL candidates → BM25 re-ranking
   */
  async hybridSearch(options: HybridSearchOptions): Promise<SearchResponse> {
    const {
      indexName,
      query,
      limit = 20,
      offset = 0,
      candidateLimit = 200,
      fieldWeights = this.businessFieldWeights,
      businessBoost = true,
    } = options;

    const startTime = Date.now();

    try {
      // Stage 1: PostgreSQL full-text search to get candidates
      const candidates = await this.getPostgreSQLCandidates({
        indexName,
        query,
        limit: candidateLimit,
        offset: 0,
        fieldWeights,
        businessBoost,
      });

      this.logger.debug(`Stage 1: Found ${candidates.length} PostgreSQL candidates`);

      if (candidates.length === 0) {
        return {
          hits: [],
          total: 0,
          took: Date.now() - startTime,
          maxScore: 0,
        };
      }

      // Stage 2: BM25 re-ranking of candidates
      const rerankedResults = await this.bm25ReRanking({
        candidates,
        query,
        fieldWeights,
        businessBoost,
      });

      this.logger.debug(`Stage 2: BM25 re-ranking completed`);

      // Apply final pagination
      const paginatedResults = rerankedResults.slice(offset, offset + limit);

      const response: SearchResponse = {
        hits: paginatedResults.map(result => ({
          id: result.docId,
          score: result.finalScore,
          document: result.content,
        })),
        total: rerankedResults.length,
        took: Date.now() - startTime,
        maxScore: rerankedResults.length > 0 ? rerankedResults[0].finalScore : 0,
      };

      return response;
    } catch (error) {
      this.logger.error(`Hybrid search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Stage 1: Get PostgreSQL candidates using full-text search
   */
  private async getPostgreSQLCandidates(options: {
    indexName: string;
    query: string;
    limit: number;
    offset: number;
    fieldWeights: Record<string, number>;
    businessBoost: boolean;
  }): Promise<SearchCandidate[]> {
    const { indexName, query, limit, offset, fieldWeights, businessBoost } = options;

    const queryOptions: QueryBuilderOptions = {
      indexName,
      limit,
      offset,
      fieldWeights,
      boostFactor: businessBoost ? this.getBusinessBoostFactor(query) : 1.0,
    };

    const sqlQuery = this.queryBuilder.buildTermQuery(query, queryOptions);

    const rawResults = await this.searchDocumentRepository.query(
      sqlQuery.query,
      sqlQuery.parameters,
    );

    return rawResults.map(row => ({
      id: row.id,
      docId: row.doc_id,
      content: row.content,
      fieldLengths: row.field_lengths || {},
      boostFactor: row.boost_factor || 1.0,
      pgRank: parseFloat(row.pg_rank) || 0,
      finalScore: parseFloat(row.final_score) || 0,
    }));
  }

  /**
   * Stage 2: BM25 re-ranking of PostgreSQL candidates
   */
  private async bm25ReRanking(options: {
    candidates: SearchCandidate[];
    query: string;
    fieldWeights: Record<string, number>;
    businessBoost: boolean;
  }): Promise<SearchCandidate[]> {
    const { candidates, query, fieldWeights, businessBoost } = options;

    const documents = candidates.map(candidate => ({
      id: candidate.docId,
      content: candidate.content,
      fieldLengths: candidate.fieldLengths,
      boostFactor: candidate.boostFactor,
    }));

    const bm25Results = await Promise.all(
      documents.map(async doc => {
        const bm25Score = await this.calculateBM25Score(doc, query, fieldWeights);
        const businessMultiplier = businessBoost ? this.getBusinessBoostFactor(query) : 1.0;

        return {
          docId: doc.id,
          bm25Score,
          businessMultiplier,
          finalScore: bm25Score * doc.boostFactor * businessMultiplier,
        };
      }),
    );

    const mergedResults = candidates.map(candidate => {
      const bm25Result = bm25Results.find(r => r.docId === candidate.docId);
      return {
        ...candidate,
        finalScore: bm25Result ? bm25Result.finalScore : candidate.finalScore,
      };
    });

    return mergedResults.sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Calculate BM25 score for a document using the existing BM25Scorer
   */
  private async calculateBM25Score(
    document: any,
    query: string,
    fieldWeights: Record<string, number>,
  ): Promise<number> {
    const queryTerms = query.toLowerCase().split(/\s+/);
    let totalScore = 0;

    for (const [fieldName, fieldWeight] of Object.entries(fieldWeights)) {
      if (document.content[fieldName]) {
        const fieldContent = String(document.content[fieldName]).toLowerCase();

        // Calculate term frequency for each query term in this field
        for (const term of queryTerms) {
          const termFreq = this.calculateTermFrequency(fieldContent, term);
          if (termFreq > 0) {
            const fieldScore = this.bm25Scorer.score(term, document.id, fieldName, termFreq);
            totalScore += fieldScore * fieldWeight;
          }
        }
      }
    }

    return totalScore;
  }

  /**
   * Calculate term frequency in a text field
   */
  private calculateTermFrequency(text: string, term: string): number {
    if (!term) return 0;
    const sanitized = term.replace(/[\*\?]/g, '');
    if (!sanitized) return 0;
    const escaped = sanitized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  /**
   * Get business boost factor for Nigerian context
   */
  private getBusinessBoostFactor(query: string): number {
    const lowerQuery = query.toLowerCase();

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
    ];

    const ecommerceKeywords = ['shop', 'buy', 'sell', 'market', 'store', 'payment'];
    const fintechKeywords = ['bank', 'finance', 'loan', 'credit', 'investment'];

    let boostFactor = 1.0;

    if (nigerianKeywords.some(keyword => lowerQuery.includes(keyword))) {
      boostFactor *= 1.5;
    }

    if (ecommerceKeywords.some(keyword => lowerQuery.includes(keyword))) {
      boostFactor *= 1.3;
    }

    if (fintechKeywords.some(keyword => lowerQuery.includes(keyword))) {
      boostFactor *= 1.2;
    }

    return Math.min(boostFactor, 2.5);
  }

  /**
   * Get search statistics for monitoring
   */
  async getSearchStats(indexName: string): Promise<{
    totalDocuments: number;
    averageFieldLengths: Record<string, number>;
    topTerms: Array<{ term: string; frequency: number }>;
  }> {
    const totalDocs = await this.searchDocumentRepository.count({
      where: { indexName },
    });

    // Calculate average field lengths for BM25 normalization
    const avgLengthsQuery = `
      SELECT 
        jsonb_object_keys(field_lengths) as field_name,
        AVG((field_lengths->jsonb_object_keys(field_lengths))::int) as avg_length
      FROM search_documents 
      WHERE index_name = $1
      GROUP BY jsonb_object_keys(field_lengths)
    `;

    const avgLengthsResult = await this.searchDocumentRepository.query(avgLengthsQuery, [
      indexName,
    ]);

    const averageFieldLengths = avgLengthsResult.reduce((acc, row) => {
      acc[row.field_name] = parseFloat(row.avg_length) || 0;
      return acc;
    }, {});

    return {
      totalDocuments: totalDocs,
      averageFieldLengths,
      topTerms: [], // Can be implemented later with term frequency analysis
    };
  }
}
