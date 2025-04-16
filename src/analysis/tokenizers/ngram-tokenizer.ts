import { Tokenizer, TokenizerOptions } from '../interfaces/tokenizer.interface';

export interface NgramTokenizerOptions extends TokenizerOptions {
  minGram?: number;
  maxGram?: number;
}

export class NgramTokenizer implements Tokenizer {
  private options: NgramTokenizerOptions;

  constructor(options: NgramTokenizerOptions = {}) {
    this.options = {
      minGram: 2,
      maxGram: 3,
      lowercase: true,
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

    // Generate n-grams
    const minGram = this.options.minGram || 2;
    const maxGram = this.options.maxGram || 3;
    const tokens: string[] = [];

    // For each position in the text
    for (let i = 0; i < processedText.length; i++) {
      // Generate n-grams of different lengths
      for (let n = minGram; n <= maxGram && i + n <= processedText.length; n++) {
        const ngram = processedText.substring(i, i + n);
        tokens.push(ngram);
      }
    }

    return tokens;
  }

  getName(): string {
    return 'ngram';
  }
}
