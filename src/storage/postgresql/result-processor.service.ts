import { Injectable, Logger } from '@nestjs/common';
import { BM25Scorer } from '../../index/bm25-scorer';
import { PostgreSQLIndexStats } from './postgresql-index-stats';

export interface RawSearchResult {
  document_id: string;
  content: any;
  metadata?: any;
  postgresql_score: number;
  total_count?: number;
}

export interface ProcessedSearchHit {
  id: string;
  score: number;
  document: Record<string, any>;
}

export interface SearchResultSummary {
  totalHits: number;
  maxScore: number;
  hits: ProcessedSearchHit[];
}

/**
 * PostgreSQL Result Processor Service
 * Handles BM25 re-ranking, result formatting, and pagination
 */
@Injectable()
export class PostgreSQLResultProcessorService {
  private readonly logger = new Logger(PostgreSQLResultProcessorService.name);

  constructor(private readonly indexStats: PostgreSQLIndexStats) {}

  /**
   * Apply BM25 re-ranking to PostgreSQL candidates for improved relevance
   */
  async bm25Rerank(
    postgresqlResults: RawSearchResult[],
    searchTerm: string,
  ): Promise<ProcessedSearchHit[]> {
    if (!postgresqlResults || postgresqlResults.length === 0) {
      return [];
    }

    try {
      // Convert PostgreSQL results to format expected by BM25 scorer
      const documents = postgresqlResults.map(row => ({
        id: row.document_id,
        document: row.content,
        score: row.postgresql_score, // Keep original PostgreSQL score as reference
      }));

      // Create BM25 scorer with generic field weights
      const bm25Scorer = new BM25Scorer(this.indexStats, {
        k1: 1.2,
        b: 0.75,
        fieldWeights: {
          name: 3.0,
          title: 3.0,
          description: 1.5,
          content: 1.5,
          tags: 1.5,
        },
      });

      const queryTerms = searchTerm
        .toLowerCase()
        .split(/\s+/)
        .filter(term => term.length > 0);

      // Calculate BM25 scores for each candidate
      const rerankedCandidates = documents.map(doc => {
        let bm25Score = 0;

        // Calculate BM25 score for each field
        for (const [fieldName, fieldWeight] of Object.entries(
          bm25Scorer.getParameters().fieldWeights,
        )) {
          if (doc.document[fieldName]) {
            const fieldContent = String(doc.document[fieldName]).toLowerCase();

            // Calculate term frequency for each query term in this field
            for (const term of queryTerms) {
              const termFreq = this.calculateTermFrequency(fieldContent, term);
              if (termFreq > 0) {
                const fieldScore = bm25Scorer.score(term, doc.id, fieldName, termFreq);
                bm25Score += fieldScore * (fieldWeight as number);
              }
            }
          }
        }

        // Combine PostgreSQL and BM25 scores (weighted average)
        const postgresqlScore = doc.score || 0;
        const postgresqlWeight = 0.3;
        const bm25Weight = 0.7;
        const finalScore = postgresqlScore * postgresqlWeight + bm25Score * bm25Weight;

        return {
          id: doc.id,
          score: finalScore,
          document: doc.document,
        };
      });

      // Sort by final combined score
      return rerankedCandidates.sort((a, b) => b.score - a.score);
    } catch (error) {
      this.logger.error(`BM25 re-ranking failed: ${error.message}`);
      // Fallback: return results with PostgreSQL scores
      return this.fallbackToPostgreSQLScores(postgresqlResults);
    }
  }

  /**
   * Fallback scoring when BM25 fails - use PostgreSQL scores
   */
  private fallbackToPostgreSQLScores(results: RawSearchResult[]): ProcessedSearchHit[] {
    return results.map(row => ({
      id: row.document_id,
      score: row.postgresql_score,
      document: row.content,
    }));
  }

  /**
   * Apply pagination to ranked results
   */
  applyPagination(
    rankedResults: ProcessedSearchHit[],
    from: number,
    size: number,
  ): ProcessedSearchHit[] {
    return rankedResults.slice(from, from + size);
  }

  /**
   * Calculate maximum score from results
   */
  calculateMaxScore(hits: ProcessedSearchHit[]): number {
    if (!hits || hits.length === 0) {
      return 0;
    }
    return Math.max(...hits.map(h => h.score));
  }

  /**
   * Extract total count from PostgreSQL results
   */
  extractTotalCount(results: RawSearchResult[]): number {
    if (!results || results.length === 0) {
      return 0;
    }
    return results[0].total_count ? Number(results[0].total_count) : 0;
  }

  /**
   * Process complete search results with ranking and pagination
   */
  async processSearchResults(
    postgresqlResults: RawSearchResult[],
    searchTerm: string,
    from: number,
    size: number,
  ): Promise<SearchResultSummary> {
    // Extract total count before processing
    const totalHits = this.extractTotalCount(postgresqlResults);

    // Apply BM25 re-ranking
    const rankedResults = await this.bm25Rerank(postgresqlResults, searchTerm);

    // Apply pagination
    const paginatedHits = this.applyPagination(rankedResults, from, size);

    // Calculate max score
    const maxScore = this.calculateMaxScore(paginatedHits);

    return {
      totalHits,
      maxScore,
      hits: paginatedHits,
    };
  }

  /**
   * Process fallback results (no BM25 re-ranking needed for ILIKE results)
   */
  async processFallbackResults(
    fallbackResults: RawSearchResult[],
    searchTerm: string,
    size: number,
  ): Promise<SearchResultSummary> {
    const totalHits = this.extractTotalCount(fallbackResults);

    // For fallback results, apply light BM25 scoring but don't re-paginate
    // since pagination was already applied in the SQL query
    const rankedResults = await this.bm25Rerank(fallbackResults, searchTerm);

    // Take only the requested size (fallback query already handled pagination)
    const finalHits = rankedResults.slice(0, size);
    const maxScore = this.calculateMaxScore(finalHits);

    return {
      totalHits,
      maxScore,
      hits: finalHits,
    };
  }

  /**
   * Create empty result when no matches found
   */
  createEmptyResult(): SearchResultSummary {
    return {
      totalHits: 0,
      maxScore: 0,
      hits: [],
    };
  }

  /**
   * Validate and sanitize search results
   */
  validateResults(results: any[]): RawSearchResult[] {
    if (!Array.isArray(results)) {
      this.logger.warn('Invalid results format: expected array');
      return [];
    }

    return results.filter(result => {
      if (!result.document_id || !result.content) {
        this.logger.warn(`Invalid result: missing document_id or content`);
        return false;
      }
      return true;
    });
  }

  /**
   * Calculate term frequency in a text field
   */
  private calculateTermFrequency(text: string, term: string): number {
    const words = text.toLowerCase().split(/\W+/);
    let count = 0;
    for (const word of words) {
      if (word === term) {
        count++;
      }
    }
    return count;
  }

  /**
   * Log performance metrics for result processing
   */
  logResultMetrics(
    operation: string,
    inputCount: number,
    outputCount: number,
    duration: number,
  ): void {
    this.logger.debug(
      `${operation}: processed ${inputCount} → ${outputCount} results in ${duration.toFixed(2)}ms`,
    );
  }
}
