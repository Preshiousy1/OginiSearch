import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);
  private dictionaryWords: Set<string> | null = null;
  private isInitialized = false;

  /**
   * Initialize the dictionary asynchronously
   */
  private async initializeDictionary(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.log('📚 Initializing dictionary for word validation...');

      // Use eval to avoid build-time issues with ES modules
      const dictionaryModule = await eval('import("dictionary-en")');
      const dictionary = dictionaryModule.default || dictionaryModule;

      // Parse the .dic file to extract words
      const dicContent = (dictionary as any).dic.toString();
      const words = dicContent
        .split('\n')
        .filter(line => line.trim() && !line.startsWith('#'))
        .map(line => {
          // Extract word from format like "word/flag" or just "word"
          const word = line.split('/')[0].trim();
          return word.toLowerCase();
        })
        .filter(word => word.length >= 3); // Only keep words 3+ characters

      if (words && words.length > 0) {
        this.dictionaryWords = new Set(words);
        this.isInitialized = true;
        this.logger.log(`📚 Dictionary initialized with ${this.dictionaryWords.size} words`);
      } else {
        throw new Error('No words found in dictionary');
      }
    } catch (error) {
      this.logger.error(`❌ Failed to initialize dictionary: ${error.message}`);
      // Fallback: create empty set to avoid blocking
      this.dictionaryWords = new Set();
      this.isInitialized = true;
    }
  }

  /**
   * Check if a word exists in the dictionary
   */
  async isWordValid(word: string): Promise<boolean> {
    try {
      await this.initializeDictionary();

      if (!this.dictionaryWords) {
        return true; // Fallback: assume valid if dictionary failed
      }

      const wordLower = word.toLowerCase().trim();

      // Skip very short words
      if (wordLower.length < 3) {
        return true;
      }

      // Check against dictionary
      return this.dictionaryWords.has(wordLower);
    } catch (error) {
      this.logger.warn(`⚠️ Word validation failed for "${word}": ${error.message}`);
      return true; // Fallback: assume valid to avoid blocking
    }
  }

  /**
   * Extract base words from wildcard patterns (* and ?)
   */
  private extractBaseWordsFromWildcard(query: string): string[] {
    // Remove wildcard characters and split by common separators
    const cleanQuery = query
      .replace(/[*?]/g, ' ') // Replace wildcards with spaces
      .replace(/[^\w\s]/g, ' ') // Replace non-word, non-space chars with spaces
      .trim();

    // Split into words and filter out short/empty ones
    const words = cleanQuery
      .split(/\s+/)
      .filter(word => word.length >= 3)
      .map(word => word.toLowerCase());

    return words;
  }

  /**
   * Check if a query contains wildcard characters
   */
  private isWildcardQuery(query: string): boolean {
    return query.includes('*') || query.includes('?');
  }

  /**
   * Check if a query is likely spelled correctly
   */
  async isQueryLikelyCorrect(query: string): Promise<boolean> {
    try {
      const queryLower = query.toLowerCase().trim();

      // Skip very short queries
      if (queryLower.length < 3) {
        return true;
      }

      // Check if query contains multiple words separated by spaces (likely a name/phrase)
      if (queryLower.includes(' ') && !this.isWildcardQuery(queryLower)) {
        // For multi-word phrases, split and check each word
        const words = queryLower.split(/\s+/).filter(word => word.length >= 3);
        if (words.length === 0) return true;

        // If most words are valid, consider the query correct
        const validWords = await Promise.all(words.map(word => this.isWordValid(word)));
        const validCount = validWords.filter(Boolean).length;
        return validCount / words.length >= 0.5; // At least 50% of words should be valid
      }

      // Handle wildcard queries (*, ?)
      if (this.isWildcardQuery(queryLower)) {
        const baseWords = this.extractBaseWordsFromWildcard(queryLower);

        // If no meaningful base words extracted, assume it's a valid search pattern
        if (baseWords.length === 0) {
          return true;
        }

        // Check if all extracted base words are valid
        const validityChecks = await Promise.all(baseWords.map(word => this.isWordValid(word)));

        // If any base word is valid, consider the wildcard query valid
        return validityChecks.some(Boolean);
      }

      // For single words, check against dictionary (case-insensitive)
      return await this.isWordValid(queryLower);
    } catch (error) {
      this.logger.warn(`⚠️ Query validation failed for "${query}": ${error.message}`);
      return true; // Fallback: assume correct to avoid blocking
    }
  }

  /**
   * Get dictionary statistics
   */
  async getDictionaryStats(): Promise<{ wordCount: number; isInitialized: boolean }> {
    await this.initializeDictionary();
    return {
      wordCount: this.dictionaryWords?.size || 0,
      isInitialized: this.isInitialized,
    };
  }
}
