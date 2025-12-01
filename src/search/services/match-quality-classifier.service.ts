import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Match Quality Tiers - Determines result grouping priority
 */
export enum MatchQualityTier {
  EXACT_MATCH = 3, // Tier 1: Perfect or near-perfect matches
  CLOSE_MATCH = 2, // Tier 2: Fuzzy matches, typo corrections
  OTHER_MATCH = 1, // Tier 3: Semantic, category, or weak matches
}

/**
 * Classification result with detailed match information
 */
export interface MatchQualityClassification {
  tier: MatchQualityTier;
  matchType: string;
  confidence: number;
  details: {
    isPerfectMatch: boolean;
    startsWithQuery: boolean;
    containsQuery: boolean;
    editDistance?: number;
    similarity?: number;
    isTypoCorrection: boolean;
  };
}

/**
 * Typo correction information from typo tolerance service
 */
export interface TypoCorrectionInfo {
  originalQuery: string;
  correctedQuery: string;
  confidence: number;
  corrections: Array<{
    original: string;
    correction: string;
    confidence: number;
  }>;
}

/**
 * Match Quality Classifier Service
 *
 * Classifies search results into three quality tiers based on how well
 * they match the search query. This enables tiered ranking where exact
 * matches always rank above close matches, which rank above other matches.
 *
 * Performance optimized for speed:
 * - Early exit patterns
 * - Cached calculations
 * - Minimal string operations
 * - Configurable parallelization
 */
@Injectable()
export class MatchQualityClassifierService {
  private readonly logger = new Logger(MatchQualityClassifierService.name);
  private readonly parallelChunkSize: number;
  private readonly classificationThreshold: number;

  constructor(private readonly configService: ConfigService) {
    // 🚀 OPTIMIZATION: Make parallelization configurable
    this.parallelChunkSize = parseInt(
      this.configService.get<string>('RANKING_PARALLEL_CHUNK_SIZE', '10'),
      10,
    );
    this.classificationThreshold = parseInt(
      this.configService.get<string>('RANKING_CLASSIFICATION_THRESHOLD', '10'),
      10,
    );
  }

  /**
   * Classify a single result's match quality
   * Optimized for speed with early exits
   */
  classifyMatchQuality(
    result: any,
    query: string,
    typoCorrection?: TypoCorrectionInfo,
  ): MatchQualityClassification {
    const source = result.source || result;
    const businessName = (source.name || result.name || source.business_name || '')
      .toLowerCase()
      .trim();

    const normalizedQuery = query.toLowerCase().trim();

    // Fast path: Check for exact matches first (most common case)
    const exactCheck = this.checkExactMatch(businessName, normalizedQuery);
    if (exactCheck.isExact) {
      return {
        tier: MatchQualityTier.EXACT_MATCH,
        matchType: exactCheck.type,
        confidence: 1.0,
        details: {
          isPerfectMatch: exactCheck.type === 'perfect',
          startsWithQuery: exactCheck.type === 'prefix',
          containsQuery: exactCheck.type === 'substring',
          isTypoCorrection: false,
        },
      };
    }

    // Check if this is a typo-corrected match
    if (typoCorrection && typoCorrection.correctedQuery !== typoCorrection.originalQuery) {
      const correctedMatch = this.checkExactMatch(
        businessName,
        typoCorrection.correctedQuery.toLowerCase(),
      );
      if (correctedMatch.isExact) {
        // Exact match with corrected query = close match tier
        return {
          tier: MatchQualityTier.CLOSE_MATCH,
          matchType: 'typo_corrected_' + correctedMatch.type,
          confidence: typoCorrection.confidence,
          details: {
            isPerfectMatch: false,
            startsWithQuery: false,
            containsQuery: false,
            isTypoCorrection: true,
          },
        };
      }
    }

    // Check for close matches (fuzzy, similarity-based)
    const closeCheck = this.checkCloseMatch(businessName, normalizedQuery, result);
    if (closeCheck.isClose) {
      return {
        tier: MatchQualityTier.CLOSE_MATCH,
        matchType: closeCheck.type,
        confidence: closeCheck.confidence,
        details: {
          isPerfectMatch: false,
          startsWithQuery: false,
          containsQuery: false,
          editDistance: closeCheck.editDistance,
          similarity: closeCheck.similarity,
          isTypoCorrection: false,
        },
      };
    }

    // Default: Other match (semantic, category, tags, etc.)
    return {
      tier: MatchQualityTier.OTHER_MATCH,
      matchType: 'other',
      confidence: 0.5,
      details: {
        isPerfectMatch: false,
        startsWithQuery: false,
        containsQuery: false,
        isTypoCorrection: false,
      },
    };
  }

  /**
   * Batch classify multiple results efficiently
   * Processes in chunks in parallel for optimal performance
   *
   * Performance optimization: Uses chunked parallel processing to leverage
   * Node.js event loop and improve throughput for large result sets
   */
  async classifyBatch(
    results: any[],
    query: string,
    typoCorrection?: TypoCorrectionInfo,
  ): Promise<Map<any, MatchQualityClassification>> {
    // Fast path: empty or small arrays
    if (results.length === 0) {
      return new Map();
    }

    if (results.length <= 10) {
      // For small arrays, sequential is faster (no overhead)
      const classifications = new Map<any, MatchQualityClassification>();
      for (const result of results) {
        const classification = this.classifyMatchQuality(result, query, typoCorrection);
        classifications.set(result, classification);
      }
      return classifications;
    }

    const classifications = new Map<any, MatchQualityClassification>();

    // 🚀 OPTIMIZATION: Use configurable chunk size for parallelization
    // Only parallelize if results exceed threshold
    if (results.length <= this.classificationThreshold) {
      // Fast path: sequential processing for small arrays
      results.forEach(result => {
        classifications.set(result, this.classifyMatchQuality(result, query, typoCorrection));
      });
      return classifications;
    }

    // Parallelize classification in chunks
    // Use configurable chunk size for optimal balance between parallelism and overhead
    const chunkSize = Math.max(this.parallelChunkSize, Math.ceil(results.length / 4));
    const chunks: any[][] = [];

    // Split results into chunks
    for (let i = 0; i < results.length; i += chunkSize) {
      chunks.push(results.slice(i, i + chunkSize));
    }

    // Process chunks in parallel using Promise.all
    // Each chunk processes its results and yields to event loop between chunks
    const chunkPromises = chunks.map(async chunk => {
      // Use setImmediate to yield to event loop, allowing other chunks to process
      return new Promise<Array<{ result: any; classification: MatchQualityClassification }>>(
        resolve => {
          setImmediate(() => {
            const chunkResults = chunk.map(result => ({
              result,
              classification: this.classifyMatchQuality(result, query, typoCorrection),
            }));
            resolve(chunkResults);
          });
        },
      );
    });

    // Wait for all chunks to complete and merge results
    const chunkStartTime = Date.now();
    const chunkResults = await Promise.all(chunkPromises);
    const chunkTime = Date.now() - chunkStartTime;

    // Merge all chunk results into final map
    const mergeStartTime = Date.now();
    chunkResults.flat().forEach(({ result, classification }) => {
      classifications.set(result, classification);
    });
    const mergeTime = Date.now() - mergeStartTime;

    // Log performance metrics if processing large batches
    if (results.length > 50) {
      const sequentialEstimate = results.length * 0.5; // Rough estimate: 0.5ms per classification
      const totalTime = chunkTime + mergeTime;
      const speedup = sequentialEstimate / totalTime;
      this.logger.debug(
        `⚡ Batch Classification Performance: ${results.length} results in ${totalTime}ms ` +
          `(chunks: ${chunkTime}ms, merge: ${mergeTime}ms, estimated speedup: ${speedup.toFixed(
            2,
          )}x)`,
      );
    }

    return classifications;
  }

  /**
   * Check for exact matches with early exit
   * Returns immediately on first match found
   */
  private checkExactMatch(businessName: string, query: string): { isExact: boolean; type: string } {
    // 1. Perfect match (highest priority)
    if (businessName === query) {
      return { isExact: true, type: 'perfect' };
    }

    // 2. Starts with query (prefix match)
    if (businessName.startsWith(query)) {
      return { isExact: true, type: 'prefix' };
    }

    // 3. Contains query as substring
    if (businessName.includes(query)) {
      return { isExact: true, type: 'substring' };
    }

    // 4. All query words present in name (word-level match)
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    const nameWords = businessName.split(/\s+/);

    if (queryWords.length >= 2) {
      const allWordsPresent = queryWords.every(qWord =>
        nameWords.some(nWord => nWord === qWord || nWord.startsWith(qWord)),
      );

      if (allWordsPresent) {
        return { isExact: true, type: 'all_words' };
      }
    }

    return { isExact: false, type: 'none' };
  }

  /**
   * Check for close matches (fuzzy, similarity-based)
   * Uses lightweight algorithms for speed
   */
  private checkCloseMatch(
    businessName: string,
    query: string,
    result: any,
  ): {
    isClose: boolean;
    type: string;
    confidence: number;
    editDistance?: number;
    similarity?: number;
  } {
    // 1. Check for fuzzy match with small edit distance (full name vs query)
    const editDistance = this.calculateLevenshteinDistance(businessName, query);
    const maxAllowedDistance = Math.min(3, Math.ceil(query.length / 3));

    if (editDistance <= maxAllowedDistance && editDistance > 0) {
      return {
        isClose: true,
        type: 'fuzzy',
        confidence: 1 - editDistance / query.length,
        editDistance,
      };
    }

    // 1b. Check if any word in the name is close to the query (for single-word queries)
    const qWords = query.split(/\s+/).filter(w => w.length > 0);
    const nWords = businessName.split(/\s+/);

    if (qWords.length === 1) {
      const queryWord = qWords[0];
      for (const nWord of nWords) {
        const wordDistance = this.calculateLevenshteinDistance(nWord, queryWord);
        const wordMaxDistance = Math.min(3, Math.ceil(queryWord.length / 3));

        if (wordDistance <= wordMaxDistance && wordDistance > 0) {
          return {
            isClose: true,
            type: 'fuzzy_word',
            confidence: 1 - wordDistance / queryWord.length,
            editDistance: wordDistance,
          };
        }
      }
    }

    // 2. Check for high similarity (trigram-like)
    const similarity = this.calculateSimpleSimilarity(businessName, query);
    if (similarity > 0.6) {
      return {
        isClose: true,
        type: 'similarity',
        confidence: similarity,
        similarity,
      };
    }

    // 3. Check for partial word matches (most query words with minor variations)
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    const nameWords = businessName.split(/\s+/);

    if (queryWords.length >= 2) {
      let matchedWords = 0;
      for (const qWord of queryWords) {
        for (const nWord of nameWords) {
          const wordDistance = this.calculateLevenshteinDistance(qWord, nWord);
          if (wordDistance <= 2) {
            matchedWords++;
            break;
          }
        }
      }

      const matchRatio = matchedWords / queryWords.length;
      if (matchRatio >= 0.6) {
        return {
          isClose: true,
          type: 'partial_words',
          confidence: matchRatio,
        };
      }
    }

    // 4. Check text score from BM25 (if very high, likely close match)
    const textScore = result.score || 0;
    if (textScore >= 5.0) {
      return {
        isClose: true,
        type: 'high_text_score',
        confidence: Math.min(1, textScore / 10),
      };
    }

    return { isClose: false, type: 'none', confidence: 0 };
  }

  /**
   * Fast Levenshtein distance calculation
   * Optimized with early exit for large distances
   */
  private calculateLevenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Early exit for large differences
    if (Math.abs(len1 - len2) > 3) {
      return Math.abs(len1 - len2);
    }

    // Use 1D array for space efficiency
    const distances: number[] = Array(len2 + 1);

    // Initialize first row
    for (let j = 0; j <= len2; j++) {
      distances[j] = j;
    }

    // Calculate distances
    for (let i = 1; i <= len1; i++) {
      let prev = distances[0];
      distances[0] = i;

      for (let j = 1; j <= len2; j++) {
        const temp = distances[j];
        if (str1[i - 1] === str2[j - 1]) {
          distances[j] = prev;
        } else {
          distances[j] = Math.min(prev, distances[j - 1], distances[j]) + 1;
        }
        prev = temp;
      }
    }

    return distances[len2];
  }

  /**
   * Simple similarity calculation (faster than trigram)
   * Based on character overlap and length similarity
   */
  private calculateSimpleSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.split(''));
    const set2 = new Set(str2.split(''));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    const jaccardSimilarity = intersection.size / union.size;

    // Factor in length similarity
    const lengthSimilarity =
      Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length);

    // Weighted combination
    return jaccardSimilarity * 0.7 + lengthSimilarity * 0.3;
  }

  /**
   * Get tier statistics for logging/debugging
   */
  getTierStatistics(classifications: Map<any, MatchQualityClassification>): {
    exact: number;
    close: number;
    other: number;
    total: number;
  } {
    let exact = 0;
    let close = 0;
    let other = 0;

    for (const classification of classifications.values()) {
      switch (classification.tier) {
        case MatchQualityTier.EXACT_MATCH:
          exact++;
          break;
        case MatchQualityTier.CLOSE_MATCH:
          close++;
          break;
        case MatchQualityTier.OTHER_MATCH:
          other++;
          break;
      }
    }

    return {
      exact,
      close,
      other,
      total: exact + close + other,
    };
  }
}
