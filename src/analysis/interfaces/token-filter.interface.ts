export interface TokenFilterOptions {
  [key: string]: any;
}

export interface TokenFilter {
  /**
   * Filter an array of tokens
   * @param tokens Array of tokens to filter
   * @returns Processed array of tokens
   */
  filter(tokens: string[]): string[];

  /**
   * Get the name of the filter
   */
  getName(): string;
}
