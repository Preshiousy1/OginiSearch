import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MatchQualityClassifierService,
  MatchQualityClassification,
  MatchQualityTier,
  TypoCorrectionInfo,
} from './match-quality-classifier.service';
import { LocationCoordinates } from './multi-signal-ranking.service';

/**
 * Tiered result for internal processing
 */
interface TieredResult {
  result: any;
  classification: MatchQualityClassification;
  tierScore: number;
  confirmationScore: number;
  healthScore: number;
  finalScore: number;
  debugInfo: {
    tier: string;
    isConfirmed: boolean;
    health: number;
    rating: number;
    matchType: string;
  };
}

/**
 * Ranking configuration - now configurable via environment variables
 */
interface RankingConfig {
  useWorkerThreads: boolean;
  workerThreshold: number;
  enableDebugLogging: boolean;
  includeRankingMetadata: boolean; // Include rankingScores in results (disabled for performance)
  parallelChunkSize: number; // Chunk size for parallel processing
  classificationThreshold: number; // Use parallel classification if results > this
}

/**
 * Tiered Ranking Service
 *
 * Implements a three-tier ranking algorithm:
 * 1. EXACT MATCH: Exact word matches rank highest
 * 2. CLOSE MATCH: Fuzzy/typo matches rank second
 * 3. OTHER MATCH: Semantic/category matches rank third
 *
 * Within each tier, results are sorted by:
 * - Confirmed businesses first
 * - Then by health score (descending)
 * - Then by rating (descending)
 * - Then by freshness (descending)
 *
 * Performance optimized:
 * - Single-pass classification
 * - Optimized sorting with cached scores
 * - Worker threads for large result sets (optional)
 * - Early exit patterns throughout
 * - Configurable parallelization
 */
@Injectable()
export class TieredRankingService {
  private readonly logger = new Logger(TieredRankingService.name);
  private readonly config: RankingConfig;

  constructor(
    private readonly matchQualityClassifier: MatchQualityClassifierService,
    private readonly configService: ConfigService,
  ) {
    // 🚀 OPTIMIZATION: Make parallelization configurable via environment variables
    this.config = {
      useWorkerThreads:
        this.configService.get<string>('RANKING_USE_WORKER_THREADS', 'false') === 'true',
      workerThreshold: parseInt(
        this.configService.get<string>('RANKING_WORKER_THRESHOLD', '50'), // Lowered from 500 to 50 - check actual results, not requested size
        10,
      ),
      enableDebugLogging:
        this.configService.get<string>('RANKING_DEBUG_LOGGING', 'true') === 'true',
      includeRankingMetadata:
        this.configService.get<string>('RANKING_INCLUDE_METADATA', 'false') === 'true',
      parallelChunkSize: parseInt(
        this.configService.get<string>('RANKING_PARALLEL_CHUNK_SIZE', '10'),
        10,
      ),
      classificationThreshold: parseInt(
        this.configService.get<string>('RANKING_CLASSIFICATION_THRESHOLD', '10'),
        10,
      ),
    };
  }

  /**
   * Rank results using tiered algorithm
   * Main entry point for search ranking
   */
  async rankResults(
    results: any[],
    query: string,
    typoCorrection?: TypoCorrectionInfo,
    userContext?: {
      userLocation?: LocationCoordinates;
      userId?: string;
      requestedSize?: number;
      totalResults?: number;
    },
  ): Promise<any[]> {
    const startTime = Date.now();

    // Fast path: empty results
    if (results.length === 0) {
      return [];
    }

    // Fast path: single result
    if (results.length === 1) {
      return this.enrichSingleResult(results[0], query);
    }

    // Decide whether to use worker threads
    // 🚀 OPTIMIZATION: Always use worker threads if enabled, OR check actual returned results
    // The database may return many results even if requested size is small (for better ranking)
    // So we check the actual results.length from the database, not requestedSize
    // This ensures we use workers when we actually have many results to process
    const shouldUseWorkers =
      this.config.useWorkerThreads &&
      (results.length >= this.config.workerThreshold ||
        (userContext?.totalResults && userContext.totalResults >= this.config.workerThreshold));

    if (shouldUseWorkers) {
      // Determine the actual reason that triggered worker threads
      const reason =
        results.length >= this.config.workerThreshold
          ? `returned results (${results.length})`
          : `total results (${userContext.totalResults})`;

      this.logger.log(`📊 Using worker threads for ${results.length} results (reason: ${reason})`);
      return this.rankWithWorkers(results, query, typoCorrection, userContext);
    }

    // Standard path: classify and rank in main thread (with parallel classification)
    return await this.rankInMainThread(results, query, typoCorrection, userContext, startTime);
  }

  /**
   * Rank results in main thread (fast path for most queries)
   * Optimized for speed with minimal allocations and parallel processing
   */
  private async rankInMainThread(
    results: any[],
    query: string,
    typoCorrection?: TypoCorrectionInfo,
    userContext?: { userLocation?: LocationCoordinates; userId?: string },
    startTime?: number,
  ): Promise<any[]> {
    const classificationStart = Date.now();

    // Step 1: Classify all results (PARALLEL - chunked processing)
    const classifications = await this.matchQualityClassifier.classifyBatch(
      results,
      query,
      typoCorrection,
    );

    const classificationTime = Date.now() - classificationStart;

    // Step 1.5: Pre-calculate freshness scores in parallel (OPTIMIZATION)
    const freshnessStart = Date.now();
    const freshnessScoresPromises = results.map(async result => {
      return new Promise<{ result: any; freshness: number }>(resolve => {
        setImmediate(() => {
          resolve({
            result,
            freshness: this.calculateFreshnessScore(result),
          });
        });
      });
    });
    const freshnessScores = await Promise.all(freshnessScoresPromises);
    const freshnessMap = new Map(
      freshnessScores.map(({ result, freshness }) => [result, freshness]),
    );
    const freshnessTime = Date.now() - freshnessStart;

    // Step 2: Build tiered results with scores (PARALLEL - using Promise.all)
    const tieredBuildingStart = Date.now();
    const tieredResultsPromises = results.map(async result => {
      const classification = classifications.get(result);
      if (!classification) {
        throw new Error('Classification not found for result');
      }
      const freshnessScore = freshnessMap.get(result);
      // Use setImmediate to allow parallel processing
      return new Promise<TieredResult>(resolve => {
        setImmediate(() => {
          resolve(this.buildTieredResult(result, classification, freshnessScore));
        });
      });
    });

    const tieredResults: TieredResult[] = await Promise.all(tieredResultsPromises);
    const tieredBuildingTime = Date.now() - tieredBuildingStart;

    // Step 3: Sort by final score (single sort operation)
    const sortStart = Date.now();
    tieredResults.sort((a, b) => {
      // Primary: final score (descending)
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      // Secondary: health (descending)
      if (b.healthScore !== a.healthScore) {
        return b.healthScore - a.healthScore;
      }
      // Tertiary: tier score (descending)
      return b.tierScore - a.tierScore;
    });
    const sortingTime = Date.now() - sortStart;

    // Step 4: Extract ranked results (PARALLEL - using Promise.all)
    const extractionStart = Date.now();
    const rankedResultsPromises = tieredResults.map(async tr => {
      return new Promise<any>(resolve => {
        setImmediate(() => {
          const result = { ...tr.result };

          // Only include ranking metadata if enabled (disabled by default for performance)
          if (this.config.includeRankingMetadata) {
            result.rankingScores = {
              finalScore: tr.finalScore,
              tierScore: tr.tierScore,
              confirmationScore: tr.confirmationScore,
              healthScore: tr.healthScore,
              matchQuality: tr.classification.tier,
              matchType: tr.classification.matchType,
              matchConfidence: tr.classification.confidence,
              ...tr.debugInfo,
            };
          }

          resolve(result);
        });
      });
    });

    const rankedResults = await Promise.all(rankedResultsPromises);
    const extractionTime = Date.now() - extractionStart;

    // Performance logging
    const totalTime = Date.now() - (startTime || classificationStart);

    if (this.config.enableDebugLogging) {
      const stats = this.matchQualityClassifier.getTierStatistics(classifications);

      // Calculate parallelization efficiency
      const sequentialEstimate =
        classificationTime + freshnessTime + tieredBuildingTime + sortingTime + extractionTime;
      const parallelEfficiency =
        sequentialEstimate > 0 ? ((sequentialEstimate / totalTime) * 100).toFixed(1) : 'N/A';

      this.logger.log(
        `🎯 Tiered Ranking: ${results.length} results in ${totalTime}ms ` +
          `(classify: ${classificationTime}ms, freshness: ${freshnessTime}ms, tiered_build: ${tieredBuildingTime}ms, sort: ${sortingTime}ms, extract: ${extractionTime}ms) | ` +
          `Tiers: Exact=${stats.exact}, Close=${stats.close}, Other=${stats.other} | ` +
          `Parallel Efficiency: ${parallelEfficiency}%`,
      );

      // Log detailed timing breakdown for performance analysis
      if (totalTime > 100) {
        // Only log detailed breakdown for slower operations
        const classifyPercent = ((classificationTime / totalTime) * 100).toFixed(1);
        const freshnessPercent = ((freshnessTime / totalTime) * 100).toFixed(1);
        const tieredPercent = ((tieredBuildingTime / totalTime) * 100).toFixed(1);
        const sortPercent = ((sortingTime / totalTime) * 100).toFixed(1);
        const extractPercent = ((extractionTime / totalTime) * 100).toFixed(1);
        const speedup = (sequentialEstimate / totalTime).toFixed(2);

        this.logger.debug(
          `📊 Detailed Timing Breakdown:\n` +
            `   Classification: ${classificationTime}ms (${classifyPercent}%)\n` +
            `   Freshness Calc: ${freshnessTime}ms (${freshnessPercent}%)\n` +
            `   Tiered Building: ${tieredBuildingTime}ms (${tieredPercent}%)\n` +
            `   Sorting: ${sortingTime}ms (${sortPercent}%)\n` +
            `   Extraction: ${extractionTime}ms (${extractPercent}%)\n` +
            `   Sequential Estimate: ${sequentialEstimate}ms\n` +
            `   Actual Time: ${totalTime}ms\n` +
            `   Speedup: ${speedup}x`,
        );
      }

      // Log top 5 results for debugging (use tieredResults which has all the data)
      if (tieredResults.length > 0) {
        const top5 = tieredResults.slice(0, 5).map(tr => ({
          name: tr.result.source?.name || tr.result.name,
          tier: MatchQualityTier[tr.classification.tier],
          confirmed: tr.debugInfo.isConfirmed,
          health: tr.debugInfo.health,
          score: tr.finalScore,
        }));
      }
    }

    return rankedResults;
  }

  /**
   * Build tiered result with all scores calculated
   * Optimized to minimize object allocations
   * @param freshnessScore - Pre-calculated freshness score (optional, will calculate if not provided)
   */
  private buildTieredResult(
    result: any,
    classification: MatchQualityClassification,
    freshnessScore?: number,
  ): TieredResult {
    const source = result.source || result;

    // Extract business attributes (single pass)
    const health = parseFloat(source.health || result.health) || 0;
    const rating =
      parseFloat(source.average_rating || result.average_rating) ||
      parseFloat(source.rating || result.rating) ||
      source.stars ||
      result.stars ||
      0;
    const isConfirmed =
      source.is_verified || result.is_verified || source.verified_at || result.verified_at || false;
    const isFeatured = source.is_featured || result.is_featured || false;

    // Calculate tier score (primary ranking factor)
    // EXACT=10000, CLOSE=5000, OTHER=1000
    const tierScore = classification.tier * 1000 + (classification.tier === 3 ? 7000 : 0);

    // Calculate confirmation score (secondary ranking factor)
    // Confirmed businesses get +2000 boost
    const confirmationScore = isConfirmed ? 2000 : 0;

    // Calculate health score (tertiary ranking factor within tier+confirmation)
    // Health is 0-100, used directly
    const healthScore = health;

    // Calculate rating boost (quaternary factor)
    // Rating is 0-5, scaled to 0-50
    const ratingBoost = rating * 10;

    // Calculate freshness score (quinary factor) - use pre-calculated if available
    const freshnessScoreValue = freshnessScore ?? this.calculateFreshnessScore(result);

    // Calculate featured boost (small boost within tier)
    const featuredBoost = isFeatured ? 500 : 0;

    // Calculate text relevance contribution (minimal weight)
    const textScore = result.score || 0;
    const normalizedTextScore = Math.min(10, Math.log10(Math.max(1, textScore)) * 2.5);

    // Final score calculation (deterministic, easy to debug)
    const finalScore =
      tierScore + // 10000, 5000, or 1000 (PRIMARY)
      confirmationScore + // +2000 or 0 (SECONDARY)
      healthScore + // 0-100 (TERTIARY)
      ratingBoost + // 0-50 (QUATERNARY)
      freshnessScoreValue + // 0-10 (QUINARY)
      featuredBoost + // 0 or 500 (MINOR BOOST)
      normalizedTextScore; // 0-10 (MINIMAL)

    return {
      result,
      classification,
      tierScore,
      confirmationScore,
      healthScore,
      finalScore,
      debugInfo: {
        tier: MatchQualityTier[classification.tier],
        isConfirmed,
        health,
        rating,
        matchType: classification.matchType,
      },
    };
  }

  /**
   * Calculate freshness score (0-10)
   * Optimized for speed
   */
  private calculateFreshnessScore(result: any): number {
    const source = result.source || result;
    const updatedAt =
      source.updatedAt || source.updated_at || source.createdAt || source.created_at;

    if (!updatedAt) {
      return 5; // Neutral score if no date
    }

    const date = new Date(updatedAt);
    if (isNaN(date.getTime())) {
      return 5; // Neutral score if invalid date
    }

    const daysSinceUpdate = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

    // Freshness decay over 1 year
    // 0-30 days = 10 points
    // 31-90 days = 8 points
    // 91-180 days = 6 points
    // 181-365 days = 4 points
    // 365+ days = 2 points
    if (daysSinceUpdate <= 30) return 10;
    if (daysSinceUpdate <= 90) return 8;
    if (daysSinceUpdate <= 180) return 6;
    if (daysSinceUpdate <= 365) return 4;
    return 2;
  }

  /**
   * Enrich single result (fast path)
   */
  private enrichSingleResult(result: any, query: string): any[] {
    const classification = this.matchQualityClassifier.classifyMatchQuality(result, query);
    const freshnessScore = this.calculateFreshnessScore(result);
    const tieredResult = this.buildTieredResult(result, classification, freshnessScore);

    const enrichedResult = { ...result };

    // Only include ranking metadata if enabled (disabled by default for performance)
    if (this.config.includeRankingMetadata) {
      enrichedResult.rankingScores = {
        finalScore: tieredResult.finalScore,
        tierScore: tieredResult.tierScore,
        confirmationScore: tieredResult.confirmationScore,
        healthScore: tieredResult.healthScore,
        matchQuality: tieredResult.classification.tier,
        matchType: tieredResult.classification.matchType,
        matchConfidence: tieredResult.classification.confidence,
        ...tieredResult.debugInfo,
      };
    }

    return [enrichedResult];
  }

  /**
   * Rank with worker threads (for large result sets)
   * Uses worker threads for parallel ranking of large result sets
   */
  private async rankWithWorkers(
    results: any[],
    query: string,
    typoCorrection?: TypoCorrectionInfo,
    userContext?: { userLocation?: LocationCoordinates; userId?: string },
  ): Promise<any[]> {
    const { Worker } = await import('worker_threads');
    const path = await import('path');
    const fs = await import('fs');

    return new Promise((resolve, reject) => {
      // Try multiple possible paths for the worker file
      const possiblePaths = [
        path.join(__dirname, '../workers/ranking.worker.js'), // dist/search/workers/ (TypeScript output)
        path.join(__dirname, '../../workers/ranking.worker.js'), // dist/search/services/../workers/
        path.join(process.cwd(), 'dist/search/workers/ranking.worker.js'), // Absolute from cwd (TypeScript output)
        path.join(process.cwd(), 'dist/src/search/workers/ranking.worker.js'), // Alternative location
        path.join(process.cwd(), 'src/search/workers/ranking.worker.ts'), // Development mode
      ];

      let workerPath: string | null = null;
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            workerPath = possiblePath;
            break;
          }
        } catch (e) {
          // Continue to next path
        }
      }

      if (!workerPath) {
        this.logger.warn(
          `Worker file not found in any of these paths: ${possiblePaths.join(
            ', ',
          )} - falling back to main thread`,
        );
        this.rankInMainThread(results, query, typoCorrection, userContext)
          .then(resolve)
          .catch(reject);
        return;
      }

      this.logger.log(`📦 Using worker thread from: ${workerPath}`);
      const worker = new Worker(workerPath, {
        workerData: {
          results,
          query,
          typoCorrection: typoCorrection
            ? {
                correctedQuery: typoCorrection.correctedQuery,
                corrections: typoCorrection.corrections,
              }
            : undefined,
        },
      });

      const timeout = setTimeout(() => {
        worker.terminate();
        this.logger.warn('Worker thread timeout - falling back to main thread');
        this.rankInMainThread(results, query, typoCorrection, userContext)
          .then(resolve)
          .catch(reject);
      }, 10000); // 10 second timeout

      worker.on('message', (result: { success: boolean; ranked?: any[]; error?: string }) => {
        clearTimeout(timeout);
        if (result.success && result.ranked) {
          // Convert worker results back to expected format
          const rankedResults = result.ranked.map((r: any) => r.result);
          this.logger.log(`✅ Worker thread completed ranking for ${rankedResults.length} results`);
          resolve(rankedResults);
        } else {
          this.logger.warn(`Worker thread error: ${result.error} - falling back to main thread`);
          this.rankInMainThread(results, query, typoCorrection, userContext)
            .then(resolve)
            .catch(reject);
        }
        worker.terminate();
      });

      worker.on('error', error => {
        clearTimeout(timeout);
        this.logger.warn(`Worker thread error: ${error.message} - falling back to main thread`);
        this.rankInMainThread(results, query, typoCorrection, userContext)
          .then(resolve)
          .catch(reject);
        worker.terminate();
      });
    });
  }

  /**
   * Get detailed ranking breakdown for debugging
   */
  getRankingBreakdown(results: any[]): {
    tierBreakdown: {
      exact: { confirmed: number; unconfirmed: number };
      close: { confirmed: number; unconfirmed: number };
      other: { confirmed: number; unconfirmed: number };
    };
    topResults: Array<{
      name: string;
      tier: string;
      confirmed: boolean;
      health: number;
      score: number;
    }>;
  } {
    const breakdown = {
      exact: { confirmed: 0, unconfirmed: 0 },
      close: { confirmed: 0, unconfirmed: 0 },
      other: { confirmed: 0, unconfirmed: 0 },
    };

    // If ranking metadata is not included, we can't provide breakdown
    // This is fine - the breakdown is mainly for debugging
    for (const result of results) {
      if (!result.rankingScores) {
        // Metadata not included - skip breakdown
        continue;
      }

      const tier = result.rankingScores.matchQuality;
      const isConfirmed = result.rankingScores.isConfirmed;

      switch (tier) {
        case MatchQualityTier.EXACT_MATCH:
          breakdown.exact[isConfirmed ? 'confirmed' : 'unconfirmed']++;
          break;
        case MatchQualityTier.CLOSE_MATCH:
          breakdown.close[isConfirmed ? 'confirmed' : 'unconfirmed']++;
          break;
        case MatchQualityTier.OTHER_MATCH:
          breakdown.other[isConfirmed ? 'confirmed' : 'unconfirmed']++;
          break;
      }
    }

    const topResults = results.slice(0, 10).map(r => ({
      name: r.source?.name || r.name || 'Unknown',
      tier: r.rankingScores ? MatchQualityTier[r.rankingScores.matchQuality] : 'UNKNOWN',
      confirmed: r.rankingScores?.isConfirmed || false,
      health: r.rankingScores?.health || 0,
      score: r.rankingScores?.finalScore || 0,
    }));

    return { tierBreakdown: breakdown, topResults };
  }
}
