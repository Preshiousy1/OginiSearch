import { Injectable, Logger } from '@nestjs/common';
import { BM25Scorer } from '../../index/bm25-scorer';
import { SearchConfigurationService } from './search-configuration.service';

export interface BM25RankingOptions {
  k1?: number;
  b?: number;
  fieldWeights?: Record<string, number>;
  postgresqlWeight?: number;
  bm25Weight?: number;
}

export interface RankedDocument {
  id: string;
  score: number;
  document: Record<string, any>;
}

@Injectable()
export class BM25RankingService {
  private readonly logger = new Logger(BM25RankingService.name);

  constructor(private readonly searchConfig: SearchConfigurationService) {}

  /**
   * Re-rank PostgreSQL candidates using BM25 scoring
   */
  async rankDocuments(
    candidates: any[],
    searchTerm: string,
    indexStats: any,
    options: BM25RankingOptions = {},
    indexName: string,
  ): Promise<RankedDocument[]> {
    if (!candidates.length) {
      return [];
    }

    // Get dynamic configuration from SearchConfigurationService
    const configParams = this.searchConfig.getBM25Parameters(indexName);
    const configFieldWeights = this.searchConfig.getFieldWeights(indexName);

    const {
      k1 = configParams.k1,
      b = configParams.b,
      fieldWeights = configFieldWeights,
      postgresqlWeight = configParams.postgresqlWeight,
      bm25Weight = configParams.bm25Weight,
    } = options;

    // Create BM25 scorer with provided options
    const bm25Scorer = new BM25Scorer(indexStats, {
      k1,
      b,
      fieldWeights,
    });

    const queryTerms = searchTerm
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 0);

    // Calculate BM25 scores for each candidate
    const rerankedCandidates = candidates.map(candidate => {
      let bm25Score = 0;

      // Calculate BM25 score for each field
      for (const [fieldName, fieldWeight] of Object.entries(fieldWeights)) {
        if (candidate.content[fieldName]) {
          const fieldContent = String(candidate.content[fieldName]).toLowerCase();

          // Calculate term frequency for each query term in this field
          for (const term of queryTerms) {
            const termFreq = this.calculateTermFrequency(fieldContent, term);
            if (termFreq > 0) {
              const fieldScore = bm25Scorer.score(term, candidate.document_id, fieldName, termFreq);
              bm25Score += fieldScore * (fieldWeight as number);
            }
          }
        }
      }

      // Combine PostgreSQL and BM25 scores (weighted average)
      const postgresqlScore = parseFloat(candidate.postgresql_score) || 0;
      const finalScore = postgresqlScore * postgresqlWeight + bm25Score * bm25Weight;

      return {
        id: candidate.document_id,
        score: finalScore,
        document: candidate.content,
      };
    });

    // Sort by final combined score
    return rerankedCandidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate term frequency in a text field
   */
  private calculateTermFrequency(text: string, term: string): number {
    if (!term) return 0;

    // Remove wildcard characters commonly present in search inputs
    const sanitized = term.replace(/[\*\?]/g, '');
    if (!sanitized) return 0;

    const regex = new RegExp(`\\b${sanitized}\\b`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  /**
   * Get dynamic field weights based on index configuration
   */
  getFieldWeights(indexName: string): Record<string, number> {
    // Now delegated to SearchConfigurationService
    return this.searchConfig.getFieldWeights(indexName);
  }

  /**
   * Calculate relevance boost based on field importance
   */
  calculateFieldBoost(fieldName: string, fieldWeights: Record<string, number>): number {
    return fieldWeights[fieldName] || 1.0;
  }
}
