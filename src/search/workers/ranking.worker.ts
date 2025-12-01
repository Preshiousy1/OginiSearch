import { parentPort, workerData } from 'worker_threads';

/**
 * Ranking Worker Thread
 * Processes ranking calculations in a separate thread for large result sets
 */

interface RankingWorkerData {
  results: any[];
  query: string;
  typoCorrection?: {
    correctedQuery?: string;
    suggestions?: any[];
  };
}

interface RankingResult {
  result: any;
  classification: {
    tier: string;
    matchType: string;
    confidence: number;
  };
  tierScore: number;
  confirmationScore: number;
  healthScore: number;
  finalScore: number;
}

// Match quality tiers (must match MatchQualityTier enum)
const MatchQualityTier = {
  EXACT_MATCH: 3,
  CLOSE_MATCH: 2,
  OTHER_MATCH: 1,
};

// Classification logic (matches main thread logic)
function classifyMatchQuality(
  result: any,
  query: string,
  typoCorrection?: any,
): {
  tier: number;
  matchType: string;
  confidence: number;
} {
  const source = result.source || result;
  const businessName = (source.name || result.name || source.business_name || '')
    .toLowerCase()
    .trim();
  const normalizedQuery = query.toLowerCase().trim();

  // Fast path: Exact match
  if (businessName === normalizedQuery) {
    return { tier: MatchQualityTier.EXACT_MATCH, matchType: 'perfect', confidence: 1.0 };
  }
  if (businessName.startsWith(normalizedQuery)) {
    return { tier: MatchQualityTier.EXACT_MATCH, matchType: 'prefix', confidence: 0.95 };
  }
  if (businessName.includes(normalizedQuery)) {
    return { tier: MatchQualityTier.EXACT_MATCH, matchType: 'substring', confidence: 0.9 };
  }

  // Check typo correction
  if (typoCorrection?.correctedQuery) {
    const correctedQuery = typoCorrection.correctedQuery.toLowerCase().trim();
    if (businessName === correctedQuery || businessName.includes(correctedQuery)) {
      return {
        tier: MatchQualityTier.CLOSE_MATCH,
        matchType: 'typo_corrected',
        confidence: typoCorrection.confidence || 0.7,
      };
    }
  }

  // Close match (fuzzy)
  const words = businessName.split(/\s+/);
  const queryWords = normalizedQuery.split(/\s+/);
  const matchingWords = queryWords.filter(qw => words.some(w => w.includes(qw) || qw.includes(w)));

  if (matchingWords.length >= queryWords.length * 0.7) {
    return { tier: MatchQualityTier.CLOSE_MATCH, matchType: 'fuzzy', confidence: 0.7 };
  }

  return { tier: MatchQualityTier.OTHER_MATCH, matchType: 'semantic', confidence: 0.3 };
}

// Calculate freshness score (0-10)
function calculateFreshnessScore(result: any): number {
  const source = result.source || result;
  const updatedAt = source.updatedAt || source.updated_at || source.createdAt || source.created_at;

  if (!updatedAt) return 5;

  const date = new Date(updatedAt);
  if (isNaN(date.getTime())) return 5;

  const daysSinceUpdate = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceUpdate <= 30) return 10;
  if (daysSinceUpdate <= 90) return 8;
  if (daysSinceUpdate <= 180) return 6;
  if (daysSinceUpdate <= 365) return 4;
  return 2;
}

// Calculate scores (matches main thread logic)
function calculateScores(
  result: any,
  classification: any,
  freshnessScore: number,
): {
  tierScore: number;
  confirmationScore: number;
  healthScore: number;
  finalScore: number;
} {
  const source = result.source || result;

  // Tier score (PRIMARY)
  const tierScores: Record<number, number> = {
    [MatchQualityTier.EXACT_MATCH]: 10000,
    [MatchQualityTier.CLOSE_MATCH]: 5000,
    [MatchQualityTier.OTHER_MATCH]: 1000,
  };
  const tierScore = tierScores[classification.tier] || 1000;

  // Confirmation score (SECONDARY)
  const isConfirmed =
    source.is_verified || result.is_verified || source.verified_at || result.verified_at || false;
  const confirmationScore = isConfirmed ? 2000 : 0;

  // Health score (TERTIARY)
  const health = parseFloat(source.health || result.health || '0') || 0;
  const healthScore = health;

  // Rating boost
  const rating =
    parseFloat(
      source.average_rating || result.average_rating || source.rating || result.rating || '0',
    ) || 0;
  const ratingBoost = Math.min(50, rating * 10);

  // Featured boost
  const isFeatured = source.is_featured || result.is_featured || false;
  const featuredBoost = isFeatured ? 500 : 0;

  // Final score (matches main thread calculation)
  const finalScore =
    tierScore + confirmationScore + healthScore + ratingBoost + freshnessScore + featuredBoost;

  return { tierScore, confirmationScore, healthScore, finalScore };
}

// Main ranking function
function rankResults(data: RankingWorkerData): RankingResult[] {
  const { results, query, typoCorrection } = data;
  const ranked: RankingResult[] = [];

  for (const result of results) {
    const classification = classifyMatchQuality(result, query, typoCorrection);
    const freshnessScore = calculateFreshnessScore(result);
    const scores = calculateScores(result, classification, freshnessScore);

    ranked.push({
      result,
      classification: {
        tier:
          classification.tier === MatchQualityTier.EXACT_MATCH
            ? 'EXACT_MATCH'
            : classification.tier === MatchQualityTier.CLOSE_MATCH
            ? 'CLOSE_MATCH'
            : 'OTHER_MATCH',
        matchType: classification.matchType,
        confidence: classification.confidence,
      },
      ...scores,
    });
  }

  // Sort by final score descending
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  return ranked;
}

// Handle workerData (immediate execution when workerData is provided)
if (workerData) {
  try {
    const ranked = rankResults(workerData as RankingWorkerData);
    // Send results via parentPort if available, otherwise use process.send
    if (parentPort) {
      parentPort.postMessage({ success: true, ranked });
    } else {
      process.send?.({ success: true, ranked });
    }
  } catch (error: any) {
    if (parentPort) {
      parentPort.postMessage({ success: false, error: error.message });
    } else {
      process.send?.({ success: false, error: error.message });
    }
  }
} else if (parentPort) {
  // Handle message-based communication (for future use with worker pools)
  parentPort.on('message', async (data: RankingWorkerData) => {
    try {
      const ranked = rankResults(data);
      parentPort.postMessage({ success: true, ranked });
    } catch (error: any) {
      parentPort.postMessage({ success: false, error: error.message });
    }
  });
}
