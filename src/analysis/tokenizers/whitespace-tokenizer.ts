import { Tokenizer, TokenizerOptions } from '../interfaces/tokenizer.interface';

export class WhitespaceTokenizer implements Tokenizer {
  private options: TokenizerOptions;

  constructor(options: TokenizerOptions = {}) {
    this.options = {
      lowercase: false,
      removeStopWords: false,
      removeSpecialChars: false,
      ...options,
    };
  }

  tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    let processedText = text;

    // Apply lowercase if option is enabled
    if (this.options.lowercase) {
      processedText = processedText.toLowerCase();
    }

    // Split text into tokens using whitespace
    let tokens = processedText.split(/\s+/).filter(token => token.length > 0);

    // Remove stop words if option is enabled
    if (this.options.removeStopWords && this.options.stopWords) {
      tokens = tokens.filter(token => !this.options.stopWords.includes(token));
    }

    return tokens;
  }

  getName(): string {
    return 'whitespace';
  }
}
