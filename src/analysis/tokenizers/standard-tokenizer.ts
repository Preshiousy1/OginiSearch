import { Tokenizer, TokenizerOptions } from '../interfaces/tokenizer.interface';

export class StandardTokenizer implements Tokenizer {
  private options: TokenizerOptions;
  private readonly defaultStopWords = [
    // Articles
    'a',
    'an',
    'the',

    // Conjunctions
    'and',
    'or',
    'but',
    'nor',
    'yet',
    'so',

    // Prepositions
    'in',
    'on',
    'at',
    'to',
    'for',
    'with',
    'by',
    'about',
    'of',
    'from',
    'as',

    // Forms of "to be"
    'is',
    'are',
    'am',
    'was',
    'were',
    'be',
    'been',
    'being',

    // Pronouns
    'i',
    'me',
    'my',
    'mine',
    'you',
    'your',
    'yours',
    'he',
    'him',
    'his',
    'she',
    'her',
    'hers',
    'it',
    'its',
    'we',
    'us',
    'our',
    'ours',
    'they',
    'them',
    'their',
    'theirs',

    // Demonstratives
    'this',
    'that',
    'these',
    'those',

    // Common adverbs
    'not',
    'very',
    'too',
    'only',
    'just',
    'more',
    'most',
    'some',
    'any',
  ];

  constructor(options: TokenizerOptions = {}) {
    this.options = {
      lowercase: true,
      removeStopWords: false,
      stopWords: this.defaultStopWords,
      stemming: false,
      removeSpecialChars: true,
      specialCharsPattern: /[^\w\s]/g,
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

    let tokens: string[];

    if (this.options.removeSpecialChars && this.options.specialCharsPattern) {
      // Remove special characters and split on word boundaries
      processedText = processedText.replace(this.options.specialCharsPattern, ' ');
      tokens = processedText
        .split(/\b|\s+/)
        .map(token => token.trim())
        .filter(token => token.length > 0);
    } else {
      // When preserving special characters, only split on whitespace
      tokens = processedText.split(/\s+/).filter(token => token.length > 0);
    }

    // Remove stop words if option is enabled
    if (this.options.removeStopWords && this.options.stopWords) {
      tokens = tokens.filter(token => !this.options.stopWords.includes(token));
    }

    // Apply stemming if option is enabled (would require a stemming library)
    if (this.options.stemming) {
      // This would typically use a stemming library like Porter stemmer
      // For now, we'll leave this as a placeholder
      // tokens = tokens.map(token => stemmer.stem(token));
    }

    // Final check to ensure no empty tokens
    return tokens.filter(token => token.length > 0);
  }

  getName(): string {
    return 'standard';
  }
}
