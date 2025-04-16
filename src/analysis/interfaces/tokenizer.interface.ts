export interface TokenizerOptions {
  lowercase?: boolean;
  removeStopWords?: boolean;
  stopWords?: string[];
  stemming?: boolean;
  removeSpecialChars?: boolean;
  specialCharsPattern?: RegExp;
}

export interface Tokenizer {
  /**
   * Tokenize the input text into an array of tokens
   * @param text The text to tokenize
   * @returns Array of tokens
   */
  tokenize(text: string): string[];

  /**
   * Get the name of the tokenizer
   */
  getName(): string;
}
