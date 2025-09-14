import { Injectable, Logger } from '@nestjs/common';

export interface SpellCheckResult {
  isCorrect: boolean;
  suggestions: string[];
  confidence: number;
}

@Injectable()
export class SpellCheckerService {
  private readonly logger = new Logger(SpellCheckerService.name);
  private readonly commonWords = new Set([
    // Common English words
    'the',
    'be',
    'to',
    'of',
    'and',
    'a',
    'in',
    'that',
    'have',
    'i',
    'it',
    'for',
    'not',
    'on',
    'with',
    'he',
    'as',
    'you',
    'do',
    'at',
    'this',
    'but',
    'his',
    'by',
    'from',
    'they',
    'she',
    'or',
    'an',
    'will',
    'my',
    'one',
    'all',
    'would',
    'there',
    'their',
    'what',
    'so',
    'up',
    'out',
    'if',
    'about',
    'who',
    'get',
    'which',
    'go',
    'me',
    'when',
    'make',
    'can',
    'like',
    'time',
    'no',
    'just',
    'him',
    'know',
    'take',
    'people',
    'into',
    'year',
    'your',
    'good',
    'some',
    'could',
    'them',
    'see',
    'other',
    'than',
    'then',
    'now',
    'look',
    'only',
    'come',
    'its',
    'over',
    'think',
    'also',
    'back',
    'after',
    'use',
    'two',
    'how',
    'our',
    'work',
    'first',
    'well',
    'way',
    'even',
    'new',
    'want',
    'because',
    'any',
    'these',
    'give',
    'day',
    'most',
    'us',
    // Common business terms
    'bank',
    'business',
    'company',
    'service',
    'restaurant',
    'hotel',
    'pharmacy',
    'clinic',
    'hospital',
    'school',
    'store',
    'shop',
    'office',
    'center',
    'market',
    'food',
    'clothing',
    'fashion',
    'beauty',
    'salon',
    'barber',
    'spa',
    'gym',
    'fitness',
    'travel',
    'tour',
    'taxi',
    'car',
    'auto',
    'repair',
    'maintenance',
    'insurance',
    'legal',
    'law',
    'medical',
    'health',
    'dental',
    'veterinary',
    'pet',
    'animal',
    'real',
    'estate',
    'property',
    'rental',
    'construction',
    'building',
    'home',
    'house',
    'apartment',
    'technology',
    'computer',
    'software',
    'hardware',
    'internet',
    'website',
    'digital',
    'marketing',
    'advertising',
    'consulting',
    'finance',
    'accounting',
    'investment',
    'loan',
    'credit',
    'payment',
    'luxury',
    'premium',
    'quality',
    'best',
    'top',
    'excellent',
    'professional',
    'expert',
    'specialist',
    'modern',
    'traditional',
    'local',
    'international',
    'global',
    'national',
    'regional',
    'city',
    'town',
    'village',
    'street',
    'avenue',
    'road',
    'drive',
    'lane',
    'place',
    'square',
    'plaza',
    'mall',
    'complex',
    'building',
    'tower',
    'center',
  ]);

  constructor() {
    this.logger.log('🔤 SpellCheckerService initialized with common words dictionary');
  }

  /**
   * Check if a word is spelled correctly and get suggestions
   */
  checkSpelling(word: string): SpellCheckResult {
    try {
      if (!word || word.length < 3) {
        return {
          isCorrect: true,
          suggestions: [],
          confidence: 1.0,
        };
      }

      const normalizedWord = word.toLowerCase();
      const isCorrect = this.commonWords.has(normalizedWord);

      if (!isCorrect) {
        const suggestions = this.getSuggestions(normalizedWord);

        // Calculate confidence based on suggestion quality
        let confidence = 0.5; // Base confidence for misspelled words
        if (suggestions.length > 0) {
          // Higher confidence if we have good suggestions
          confidence = Math.min(0.9, 0.5 + suggestions.length * 0.1);
        }

        this.logger.log(
          `🔤 Spell check: "${word}" → suggestions: [${suggestions.slice(0, 3).join(', ')}]`,
        );

        return {
          isCorrect: false,
          suggestions: suggestions.slice(0, 5), // Limit to top 5 suggestions
          confidence,
        };
      } else {
        this.logger.log(`✅ Spell check: "${word}" is correct`);
        return {
          isCorrect: true,
          suggestions: [],
          confidence: 1.0,
        };
      }
    } catch (error) {
      this.logger.warn(`⚠️ Spell check failed for "${word}": ${error.message}`);
      return {
        isCorrect: true,
        suggestions: [],
        confidence: 0.5,
      };
    }
  }

  /**
   * Get suggestions for a misspelled word using Levenshtein distance
   */
  private getSuggestions(word: string): string[] {
    const suggestions: Array<{ word: string; distance: number }> = [];

    for (const dictWord of this.commonWords) {
      const distance = this.levenshteinDistance(word, dictWord);
      if (distance <= 2 && distance > 0) {
        // Allow up to 2 character differences
        suggestions.push({ word: dictWord, distance });
      }
    }

    // Sort by distance (closer matches first)
    suggestions.sort((a, b) => a.distance - b.distance);

    return suggestions.map(s => s.word);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get the best correction for a misspelled word
   */
  getBestCorrection(word: string): string | null {
    const result = this.checkSpelling(word);
    if (!result.isCorrect && result.suggestions.length > 0) {
      return result.suggestions[0];
    }
    return null;
  }

  /**
   * Check multiple words and return overall result
   */
  checkMultipleWords(words: string[]): SpellCheckResult {
    if (words.length === 0) {
      return {
        isCorrect: true,
        suggestions: [],
        confidence: 1.0,
      };
    }

    const results = words.map(word => this.checkSpelling(word));
    const misspelledCount = results.filter(r => !r.isCorrect).length;
    const isCorrect = misspelledCount === 0;

    // Combine suggestions from all misspelled words
    const allSuggestions = results
      .filter(r => !r.isCorrect)
      .flatMap(r => r.suggestions)
      .slice(0, 5);

    // Calculate overall confidence
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    return {
      isCorrect,
      suggestions: allSuggestions,
      confidence: avgConfidence,
    };
  }
}
