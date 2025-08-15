import { Injectable, Logger, BadRequestException } from '@nestjs/common';

export interface Suggestion {
  text: string;
  score: number;
  freq: number;
  distance: number;
}

@Injectable()
export class TypoToleranceService {
  private readonly logger = new Logger(TypoToleranceService.name);

  /**
   * Get suggestions for a given input text from provided field terms
   */
  async getSuggestions(fieldTerms: string[], inputText: string, size = 5): Promise<Suggestion[]> {
    try {
      const suggestions = new Map<string, Suggestion>();

      // Process each term
      for (const term of fieldTerms) {
        const actualTerm = term.includes(':') ? term.split(':')[1] : term;

        // Skip if the term is too short
        if (actualTerm.length < 2) continue;

        // Calculate Levenshtein distance for fuzzy matching
        const distance = this.levenshteinDistance(inputText, actualTerm);
        const maxDistance = Math.min(3, Math.floor(actualTerm.length / 3));

        // Consider terms that either:
        // 1. Start with the input text (prefix match)
        // 2. Are within acceptable edit distance (fuzzy match)
        // 3. Contain the input text (substring match)
        const prefixMatch = actualTerm.startsWith(inputText);
        const fuzzyMatch = distance <= maxDistance;
        const substringMatch = actualTerm.includes(inputText);

        if (prefixMatch || fuzzyMatch || substringMatch) {
          if (suggestions.size < 3) {
            // Debug first few matches
            this.logger.debug(
              `Match found: "${actualTerm}" (distance: ${distance}, maxDistance: ${maxDistance}, prefix: ${prefixMatch}, fuzzy: ${fuzzyMatch}, substring: ${substringMatch})`,
            );
          }
          // For simplified version, we'll use a frequency estimate based on term length and commonality
          const freq = this.estimateTermFrequency(actualTerm);

          // Calculate score based on multiple factors
          let score = 0;

          // Prefix matches get highest base score
          if (actualTerm.startsWith(inputText)) {
            score += 100;
          }

          // Exact matches get perfect score
          if (actualTerm === inputText) {
            score += 200;
          }

          // Substring matches get medium score
          if (actualTerm.includes(inputText) && !actualTerm.startsWith(inputText)) {
            score += 50;
          }

          // Adjust score based on edit distance (closer = better)
          score += maxDistance - distance;

          // Adjust score based on estimated frequency (more common = better)
          score += Math.log1p(freq) * 10;

          // Adjust score based on length difference (closer to input length = better)
          const lengthDiff = Math.abs(actualTerm.length - inputText.length);
          score -= lengthDiff * 2;

          suggestions.set(actualTerm, {
            text: actualTerm,
            score,
            freq,
            distance,
          });
        }
      }

      // Convert to array and sort by score
      return Array.from(suggestions.values())
        .sort((a, b) => {
          // First by score
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;

          // Then by frequency if scores are equal
          const freqDiff = b.freq - a.freq;
          if (freqDiff !== 0) return freqDiff;

          // Finally by edit distance if both score and freq are equal
          return a.distance - b.distance;
        })
        .slice(0, size);
    } catch (error) {
      this.logger.error(`Suggestion error: ${error.message}`);
      throw new BadRequestException(`Suggestion error: ${error.message}`);
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   * This helps in finding similar terms for fuzzy matching
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] =
            Math.min(
              dp[i - 1][j - 1], // substitution
              dp[i - 1][j], // deletion
              dp[i][j - 1], // insertion
            ) + 1;
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Estimate term frequency based on common patterns and length
   */
  private estimateTermFrequency(term: string): number {
    // Simple heuristic: shorter common words are more frequent
    const commonWords = [
      'the',
      'and',
      'for',
      'are',
      'but',
      'not',
      'you',
      'all',
      'can',
      'had',
      'was',
      'one',
      'our',
      'out',
      'day',
      'get',
      'has',
      'him',
      'his',
      'how',
      'its',
      'may',
      'new',
      'now',
      'old',
      'see',
      'two',
      'way',
      'who',
      'boy',
      'did',
      'man',
      'put',
      'say',
      'she',
      'too',
      'use',
    ];

    const lowerTerm = term.toLowerCase();

    if (commonWords.includes(lowerTerm)) {
      return 1000; // High frequency for common words
    }

    if (term.length <= 3) {
      return 500; // Short terms are often common
    }

    if (term.length <= 6) {
      return 100; // Medium length terms
    }

    return 10; // Longer terms are typically less frequent
  }

  /**
   * Correct a query by suggesting the most likely correct terms
   */
  async correctQuery(query: string, fieldTerms: string[]): Promise<string> {
    const terms = query.toLowerCase().split(/\s+/);
    const correctedTerms = await Promise.all(
      terms.map(async term => {
        const suggestions = await this.getSuggestions(fieldTerms, term, 1);
        return suggestions.length > 0 ? suggestions[0].text : term;
      }),
    );
    return correctedTerms.join(' ');
  }
}
