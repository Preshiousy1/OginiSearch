import { TokenFilter, TokenFilterOptions } from '../interfaces/token-filter.interface';

export interface StopwordFilterOptions extends TokenFilterOptions {
  stopwords?: string[];
}

export class StopwordFilter implements TokenFilter {
  private options: StopwordFilterOptions;
  private readonly defaultStopwords = [
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

  constructor(options: StopwordFilterOptions = {}) {
    this.options = {
      stopwords: options.stopwords || this.defaultStopwords,
    };
  }

  filter(tokens: string[]): string[] {
    if (!tokens || !Array.isArray(tokens)) {
      return [];
    }

    return tokens.filter(token => !this.options.stopwords.includes(token));
  }

  getName(): string {
    return 'stopword';
  }
}
