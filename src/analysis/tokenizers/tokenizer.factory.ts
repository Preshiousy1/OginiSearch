import { Tokenizer, TokenizerOptions } from '../interfaces/tokenizer.interface';
import { StandardTokenizer } from './standard-tokenizer';
import { WhitespaceTokenizer } from './whitespace-tokenizer';
import { NgramTokenizer, NgramTokenizerOptions } from './ngram-tokenizer';

export type TokenizerType = 'standard' | 'whitespace' | 'ngram';

export class TokenizerFactory {
  /**
   * Create a tokenizer based on the specified type and options
   */
  static createTokenizer(type: TokenizerType, options: TokenizerOptions = {}): Tokenizer {
    switch (type) {
      case 'standard':
        return new StandardTokenizer(options);
      case 'whitespace':
        return new WhitespaceTokenizer(options);
      case 'ngram':
        return new NgramTokenizer(options as NgramTokenizerOptions);
      default:
        throw new Error(`Unknown tokenizer type: ${type}`);
    }
  }
}
