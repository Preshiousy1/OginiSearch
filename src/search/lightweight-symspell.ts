/**
 * Lightweight SymSpell Implementation
 *
 * This is a simplified, dependency-free implementation of SymSpell
 * optimized for our typo tolerance use case.
 *
 * Key features:
 * - No external dependencies
 * - O(1) lookup time for corrections
 * - Memory-efficient storage
 * - Generic field support
 */

export interface SymSpellSuggestion {
  term: string;
  distance: number;
  count: number;
}

export interface SymSpellConfig {
  maxDistance: number;
  prefixLength: number;
  countThreshold: number;
}

export class LightweightSymSpell {
  private readonly dictionary = new Map<string, number>();
  private readonly deletes = new Map<string, Set<string>>();
  private readonly config: SymSpellConfig;

  constructor(config: Partial<SymSpellConfig> = {}) {
    this.config = {
      maxDistance: config.maxDistance || 2,
      prefixLength: config.prefixLength || 7,
      countThreshold: config.countThreshold || 1,
      ...config,
    };
  }

  /**
   * Add a term to the dictionary with its frequency
   */
  add(term: string, count = 1): void {
    if (!term || term.length === 0) return;

    const termLower = term.toLowerCase().trim();

    // Add to main dictionary
    this.dictionary.set(termLower, (this.dictionary.get(termLower) || 0) + count);

    // Generate deletes for this term
    this.generateDeletes(termLower);
  }

  /**
   * Search for suggestions for a given term
   */
  search(term: string): SymSpellSuggestion[] {
    if (!term || term.length === 0) return [];

    const termLower = term.toLowerCase().trim();
    const suggestions = new Map<string, SymSpellSuggestion>();

    // Check if term exists exactly
    if (this.dictionary.has(termLower)) {
      suggestions.set(termLower, {
        term: termLower,
        distance: 0,
        count: this.dictionary.get(termLower)!,
      });
    }

    // Generate deletes for the search term
    const searchDeletes = this.generateDeletesForTerm(termLower);

    // Find candidates by checking deletes
    for (const deleteKey of searchDeletes) {
      const candidates = this.deletes.get(deleteKey);
      if (candidates) {
        for (const candidate of candidates) {
          if (!suggestions.has(candidate)) {
            const distance = this.levenshteinDistance(termLower, candidate);
            if (distance <= this.config.maxDistance) {
              suggestions.set(candidate, {
                term: candidate,
                distance,
                count: this.dictionary.get(candidate) || 0,
              });
            }
          }
        }
      }
    }

    // Sort by distance, then by frequency
    return Array.from(suggestions.values())
      .sort((a, b) => {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        return b.count - a.count;
      })
      .slice(0, 10); // Return top 10 suggestions
  }

  /**
   * Get the size of the dictionary
   */
  get size(): number {
    return this.dictionary.size;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.dictionary.clear();
    this.deletes.clear();
  }

  /**
   * Generate delete operations for a term
   */
  private generateDeletes(term: string): void {
    const deletes = this.generateDeletesForTerm(term);

    for (const deleteKey of deletes) {
      if (!this.deletes.has(deleteKey)) {
        this.deletes.set(deleteKey, new Set());
      }
      this.deletes.get(deleteKey)!.add(term);
    }
  }

  /**
   * Generate all possible deletes for a term
   */
  private generateDeletesForTerm(term: string): string[] {
    const deletes: string[] = [];
    const maxDistance = Math.min(this.config.maxDistance, term.length);

    for (let distance = 1; distance <= maxDistance; distance++) {
      this.generateDeletesForDistance(term, distance, deletes);
    }

    return deletes;
  }

  /**
   * Generate deletes for a specific distance
   */
  private generateDeletesForDistance(term: string, distance: number, deletes: string[]): void {
    if (distance === 1) {
      // Single character deletions
      for (let i = 0; i < term.length; i++) {
        const deleteKey = term.slice(0, i) + term.slice(i + 1);
        if (deleteKey.length >= this.config.prefixLength) {
          deletes.push(deleteKey);
        }
      }
    } else {
      // Recursive deletions for higher distances
      const previousDeletes = deletes.filter(d => d.length === term.length - (distance - 1));
      for (const prevDelete of previousDeletes) {
        for (let i = 0; i < prevDelete.length; i++) {
          const deleteKey = prevDelete.slice(0, i) + prevDelete.slice(i + 1);
          if (deleteKey.length >= this.config.prefixLength && !deletes.includes(deleteKey)) {
            deletes.push(deleteKey);
          }
        }
      }
    }
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
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + substitutionCost, // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get statistics about the dictionary
   */
  getStats(): {
    totalTerms: number;
    totalDeletes: number;
    avgFrequency: number;
    maxFrequency: number;
  } {
    const frequencies = Array.from(this.dictionary.values());
    const totalDeletes = Array.from(this.deletes.values()).reduce((sum, set) => sum + set.size, 0);

    return {
      totalTerms: this.dictionary.size,
      totalDeletes,
      avgFrequency:
        frequencies.length > 0 ? frequencies.reduce((a, b) => a + b, 0) / frequencies.length : 0,
      maxFrequency: frequencies.length > 0 ? Math.max(...frequencies) : 0,
    };
  }
}
