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

    // 🎯 BUSINESS HEALTH: Primary quality indicator (40-100 scale)
    const health = parseFloat(source.health || document.health) || 0;
    const normalizedHealth = Math.min(1, Math.max(0, (health - 40) / 60)); // Normalize 40-100 to 0-1

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
          textRelevance: 0.25,
          semanticSimilarity: 0.2,
          locationProximity: 0.35, // Higher for location queries
          freshness: 0.1,
          popularity: 0.1,
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
          textRelevance: 0.3,
          semanticSimilarity: 0.25,
          locationProximity: 0.2,
          freshness: 0.1,
          popularity: 0.15, // Higher for business queries
        };
      default:
        return {
          textRelevance: 0.35,
          semanticSimilarity: 0.25,
          locationProximity: 0.2,
          freshness: 0.1,
          popularity: 0.1,
        };
    }
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
   * Rank results using multi-signal scoring
   */
  async rankResults(
    results: any[],
    query: string,
    userContext?: { userLocation?: LocationCoordinates; userId?: string },
  ): Promise<any[]> {
    const queryType = this.detectQueryType(query, !!userContext?.userLocation);
    const weights = this.getQueryWeights(queryType);

    const rankedResults = results.map(result => {
      const textScore = this.calculateTextScore(result, query);
      const semanticScore = this.calculateSemanticScore(result, query);
      const locationScore = this.calculateLocationScore(result, userContext?.userLocation);
      const freshnessScore = this.calculateFreshnessScore(result);
      const popularityScore = this.calculatePopularityScore(result);

      // Calculate weighted final score
      const finalScore =
        textScore * weights.textRelevance +
        semanticScore * weights.semanticSimilarity +
        locationScore * weights.locationProximity +
        freshnessScore * weights.freshness +
        popularityScore * weights.popularity;

      return {
        ...result,
        rankingScores: {
          textScore,
          semanticScore,
          locationScore,
          freshnessScore,
          popularityScore,
          finalScore,
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
