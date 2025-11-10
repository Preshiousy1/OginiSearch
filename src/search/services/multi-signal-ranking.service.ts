import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LocationCoordinates {
  lat: number;
  lng: number;
}

export interface QueryWeights {
  textRelevance: number;
  semanticSimilarity: number;
  locationProximity: number;
  freshness: number;
  popularity: number;
}

export interface RankingFeatures {
  textScore: number;
  semanticScore: number;
  locationScore: number;
  freshnessScore: number;
  popularityScore: number;
  queryComplexity: number;
  userEngagement: number;
}

export interface UserPreferences {
  userId: string;
  locationWeight: number;
  freshnessWeight: number;
  popularityWeight: number;
  preferredCategories: string[];
  lastUpdated: Date;
}

export interface RankingMetrics {
  queryType: string;
  responseTime: number;
  clickThroughRate: number;
  userSatisfaction: number;
  resultRelevance: number;
  weightDistribution: QueryWeights;
}

@Injectable()
export class MultiSignalRankingService {
  private readonly logger = new Logger(MultiSignalRankingService.name);

  constructor(private readonly configService?: ConfigService) {}

  /**
   * Calculate text relevance score using existing BM25
   */
  calculateTextScore(document: any, query: string): number {
    return document.score || 1.0;
  }

  /**
   * Calculate semantic similarity score
   */
  calculateSemanticScore(document: any, query: string): number {
    return document.semanticScore || 0.0;
  }

  /**
   * Calculate location proximity score
   */
  calculateLocationScore(document: any, userLocation?: LocationCoordinates): number {
    if (!userLocation || !document.latitude || !document.longitude) {
      return 0.5; // Neutral score if no location data
    }

    const distance = this.calculateDistance(
      userLocation.lat,
      userLocation.lng,
      document.latitude,
      document.longitude,
    );

    // Score based on distance (5km radius)
    return Math.max(0, 1 - distance / 5000);
  }

  /**
   * Calculate content freshness score
   */
  calculateFreshnessScore(document: any): number {
    const updatedAt = document.updatedAt || document.createdAt || Date.now();
    const daysSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);

    // 1 year decay period
    return Math.max(0.1, 1 - daysSinceUpdate / 365);
  }

  /**
   * Calculate business popularity/health score
   * Combines health, rating, verification, and engagement
   */
  calculatePopularityScore(document: any): number {
    // Handle both direct document and source-wrapped document
    const source = document.source || document;

    // 🎯 BUSINESS HEALTH: Primary quality indicator (0-100 scale)
    const health = parseFloat(source.health || document.health) || 0;
    const normalizedHealth = Math.min(1, Math.max(0, health / 100)); // Normalize 0-100 to 0-1

    // 🌟 RATING: Customer satisfaction (0-5 scale)
    const rating =
      parseFloat(source.average_rating || document.average_rating) ||
      parseFloat(source.rating || document.rating) ||
      source.stars ||
      document.stars ||
      0;
    const normalizedRating = Math.min(1, rating / 5);

    // 👁️ ENGAGEMENT: View count
    const engagement =
      source.viewCount || document.viewCount || source.views || document.views || 0;
    const normalizedEngagement = Math.min(1, engagement / 1000);

    // ✓ VERIFICATION: Verified businesses get a boost
    const verificationBoost =
      source.is_verified || document.is_verified || source.verified_at || document.verified_at
        ? 0.2
        : 0;

    // ⭐ FEATURED: Featured businesses get a boost
    const featuredBoost = source.is_featured || document.is_featured ? 0.15 : 0;

    // WEIGHTED COMBINATION: Health is most important for business quality
    return (
      normalizedHealth * 0.4 + // 40% - Health is primary quality indicator
      normalizedRating * 0.3 + // 30% - Customer satisfaction
      normalizedEngagement * 0.1 + // 10% - Popularity/views
      verificationBoost + // +20% boost for verified
      featuredBoost // +15% boost for featured
    );
  }

  /**
   * Get query-aware weight distribution
   */
  getQueryWeights(queryType: string): QueryWeights {
    switch (queryType) {
      case 'location_based':
        return {
          textRelevance: 0.2,
          semanticSimilarity: 0.15,
          locationProximity: 0.35, // Higher for location queries
          freshness: 0.1,
          popularity: 0.2, // Increase from 0.1 - health important everywhere
        };
      case 'semantic':
        return {
          textRelevance: 0.2,
          semanticSimilarity: 0.4, // Higher for semantic queries
          locationProximity: 0.2,
          freshness: 0.1,
          popularity: 0.1,
        };
      case 'business_type':
        return {
          textRelevance: 0.25,
          semanticSimilarity: 0.2,
          locationProximity: 0.15,
          freshness: 0.1,
          popularity: 0.3, // MUCH higher for business queries - health is critical
        };
      default:
        // 🎯 HEALTH-FOCUSED: Give popularity (health + rating) significant weight
        return {
          textRelevance: 0.25, // Reduce from 0.35 - text still important
          semanticSimilarity: 0.15, // Reduce from 0.25
          locationProximity: 0.15, // Reduce from 0.2
          freshness: 0.15, // Increase from 0.1 - reward fresh data
          popularity: 0.3, // TRIPLE from 0.1 - Health is critical!
        };
    }
  }

  /**
   * Quick ranking for small result sets (< 20 results)
   * Simply sort by: Featured > Confirmed > Health > Text relevance
   */
  private quickRankByHealth(results: any[]): any[] {
    return results
      .map(result => {
        const source = result.source || result;
        const health = parseFloat(source.health || result.health) || 0;
        const isFeatured = source.is_featured || result.is_featured || false;
        const isConfirmed =
          source.is_verified ||
          result.is_verified ||
          source.verified_at ||
          result.verified_at ||
          false;

        // Simple priority score
        let quickScore = health; // 0-100
        if (isConfirmed) quickScore += 1000; // Confirmed: +1000
        if (isFeatured) quickScore += 10000; // Featured: +10000

        return {
          ...result,
          rankingScores: {
            quickScore,
            healthScore: health,
            isFeatured,
            isConfirmed,
            finalScore: quickScore,
          },
        };
      })
      .sort((a, b) => b.rankingScores.quickScore - a.rankingScores.quickScore);
  }

  /**
   * Detect query type for weight distribution
   */
  detectQueryType(query: string, hasLocation: boolean): string {
    if (hasLocation) return 'location_based';

    // Check for business-type indicators
    if (
      query.includes('best') ||
      query.includes('top') ||
      query.includes('popular') ||
      query.includes('luxury') ||
      query.includes('cheap') ||
      query.includes('expensive')
    ) {
      return 'business_type';
    }

    // Check for service-specific queries
    if (
      query.includes('delivery') ||
      query.includes('takeout') ||
      query.includes('appointment') ||
      query.includes('booking') ||
      query.includes('24/7') ||
      query.includes('pool')
    ) {
      return 'business_type';
    }

    // Only classify as semantic for very long, complex queries
    if (query.length > 30 && query.split(' ').length > 6) {
      return 'semantic';
    }

    return 'default';
  }

  /**
   * Rank results using multi-signal scoring with business priority logic
   * Priority: Featured > Confirmed > Health (primary) > Text Relevance
   */
  async rankResults(
    results: any[],
    query: string,
    userContext?: { userLocation?: LocationCoordinates; userId?: string },
  ): Promise<any[]> {
    // 🚀 QUICK PATH: For very small result sets (< 20), skip complex ranking
    // Users will scan all results anyway, so health-based ordering is sufficient
    if (results.length < 20) {
      return this.quickRankByHealth(results);
    }

    const queryType = this.detectQueryType(query, !!userContext?.userLocation);
    const weights = this.getQueryWeights(queryType);

    const rankedResults = results.map(result => {
      const source = result.source || result;

      const textScore = this.calculateTextScore(result, query);
      const semanticScore = this.calculateSemanticScore(result, query);
      const locationScore = this.calculateLocationScore(result, userContext?.userLocation);
      const freshnessScore = this.calculateFreshnessScore(result);
      const popularityScore = this.calculatePopularityScore(result);

      // Extract health for business logic
      const health = parseFloat(source.health || result.health) || 0;
      const normalizedHealth = health / 100;

      // Check business status
      const isFeatured = source.is_featured || result.is_featured || false;
      const isConfirmed =
        source.is_verified ||
        result.is_verified ||
        source.verified_at ||
        result.verified_at ||
        false;

      // 🎯 BUSINESS RANKING LOGIC:
      // 1. Featured businesses get massive boost
      // 2. Confirmed businesses rank above unconfirmed
      // 3. Within confirmed: Health is PRIMARY determinant (50% weight)

      let baseScore = 0;

      if (isConfirmed) {
        // For confirmed businesses: Health is PRIMARY determinant (70%)
        // Text relevance is secondary (20%) - enough to distinguish relevant matches
        baseScore =
          normalizedHealth * 700 + // 70% - HEALTH DOMINATES
          textScore * 0.2 + // 20% - Text relevance (still important for finding right results)
          locationScore * 50 + // 5% - Location
          freshnessScore * 30 + // 3% - Freshness
          semanticScore * 20; // 2% - Semantic similarity
      } else {
        // For unconfirmed: Text relevance matters more (they're already ranked lower)
        baseScore =
          textScore * 0.4 + // 40% - Text relevance
          normalizedHealth * 300 + // 30% - Health still important
          locationScore * 150 + // 15% - Location
          freshnessScore * 100 + // 10% - Freshness
          semanticScore * 50; // 5% - Semantic similarity
      }

      // Apply tier boosts
      let finalScore = baseScore;

      if (isFeatured) {
        // Featured businesses: Add 10,000 to ensure they rank first
        finalScore += 10000;
      } else if (isConfirmed) {
        // Confirmed businesses: Add 5,000 to ensure they rank above unconfirmed
        finalScore += 5000;
      }

      return {
        ...result,
        rankingScores: {
          textScore,
          semanticScore,
          locationScore,
          freshnessScore,
          popularityScore,
          healthScore: normalizedHealth * 100, // For debugging
          baseScore,
          finalScore,
          isFeatured,
          isConfirmed,
        },
        weights,
      };
    });

    // Sort by final score
    return rankedResults.sort((a, b) => b.rankingScores.finalScore - a.rankingScores.finalScore);
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Extract ranking features for ML model
   */
  extractRankingFeatures(result: any, query: string): RankingFeatures {
    return {
      textScore: this.calculateTextScore(result, query),
      semanticScore: this.calculateSemanticScore(result, query),
      locationScore: this.calculateLocationScore(result),
      freshnessScore: this.calculateFreshnessScore(result),
      popularityScore: this.calculatePopularityScore(result),
      queryComplexity: query.split(' ').length,
      userEngagement: result.viewCount || 0,
    };
  }

  /**
   * Enhanced Reciprocal Rank Fusion
   */
  async enhancedRRF(
    keywordResults: any[],
    semanticResults: any[],
    locationResults: any[],
  ): Promise<any[]> {
    const k = 60; // RRF parameter
    const combinedResults = new Map<string, { document: any; scores: number[] }>();

    // Combine keyword results
    keywordResults.forEach((result, index) => {
      combinedResults.set(result.id, {
        document: result,
        scores: [1 / (k + index + 1)],
      });
    });

    // Combine semantic results
    semanticResults.forEach((result, index) => {
      const existing = combinedResults.get(result.id);
      if (existing) {
        existing.scores.push(1 / (k + index + 1));
      } else {
        combinedResults.set(result.id, {
          document: result,
          scores: [1 / (k + index + 1)],
        });
      }
    });

    // Combine location results
    locationResults.forEach((result, index) => {
      const existing = combinedResults.get(result.id);
      if (existing) {
        existing.scores.push(1 / (k + index + 1));
      } else {
        combinedResults.set(result.id, {
          document: result,
          scores: [1 / (k + index + 1)],
        });
      }
    });

    // Calculate final scores
    return Array.from(combinedResults.values())
      .map(({ document, scores }) => ({
        ...document,
        finalScore: scores.reduce((sum, score) => sum + score, 0),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Track ranking performance metrics
   */
  async trackRankingPerformance(metrics: RankingMetrics): Promise<void> {
    this.logger.debug(`Ranking performance: ${JSON.stringify(metrics)}`);

    // TODO: Store metrics in database for analysis
    // await this.metricsRepository.save(metrics);

    // Update weights based on performance
    if (metrics.userSatisfaction < 0.7) {
      this.logger.warn(
        `Low user satisfaction (${metrics.userSatisfaction}) for query type: ${metrics.queryType}`,
      );
    }
  }
}
