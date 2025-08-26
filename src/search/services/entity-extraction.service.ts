import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityExtractionResult } from '../interfaces/intelligent-search.interface';

@Injectable()
export class EntityExtractionService {
  private readonly logger = new Logger(EntityExtractionService.name);

  // Business-specific entity mappings
  private readonly businessTypes = new Map<string, string[]>([
    // Food & Dining
    [
      'restaurant',
      ['food', 'dining', 'eatery', 'cafe', 'bistro', 'pub', 'bar', 'grill', 'kitchen'],
    ],
    ['cafe', ['coffee', 'tea', 'beverage', 'breakfast', 'cafe', 'coffee shop']],
    ['pizza', ['pizza', 'italian', 'delivery', 'takeout']],
    ['fast food', ['fast food', 'quick food', 'takeaway', 'takeout', 'fast']],

    // Accommodation
    ['hotel', ['accommodation', 'lodging', 'guesthouse', 'inn', 'resort', 'motel', 'hostel']],
    ['resort', ['resort', 'vacation', 'holiday', 'beach resort', 'mountain resort']],
    ['guesthouse', ['guesthouse', 'bed and breakfast', 'bnb', 'inn']],

    // Healthcare
    ['clinic', ['hospital', 'medical', 'healthcare', 'doctor', 'pharmacy', 'dental', 'clinic']],
    ['hospital', ['hospital', 'medical center', 'healthcare', 'emergency']],
    ['pharmacy', ['pharmacy', 'drugstore', 'chemist', 'medical store']],
    ['dental', ['dental', 'dentist', 'oral health', 'teeth']],
    ['laboratory', ['lab', 'laboratory', 'testing', 'diagnostic']],

    // Retail & Shopping
    ['shop', ['store', 'retail', 'market', 'mall', 'supermarket', 'grocery', 'shop']],
    ['supermarket', ['supermarket', 'grocery', 'food store', 'market']],
    ['mall', ['mall', 'shopping center', 'plaza', 'shopping mall']],
    ['electronics', ['electronics', 'tech', 'computer', 'phone', 'gadget']],
    ['fashion', ['fashion', 'clothing', 'apparel', 'style', 'wear']],

    // Financial Services
    ['bank', ['financial', 'credit union', 'atm', 'money', 'finance', 'banking']],
    ['atm', ['atm', 'cash machine', 'money machine', 'bank machine']],
    ['insurance', ['insurance', 'coverage', 'policy', 'protection']],

    // Education
    ['school', ['education', 'university', 'college', 'academy', 'institute', 'school']],
    ['university', ['university', 'college', 'higher education', 'campus']],
    ['training', ['training', 'course', 'workshop', 'learning', 'education']],

    // Fitness & Sports
    ['gym', ['fitness', 'workout', 'exercise', 'sports', 'training', 'gym']],
    ['fitness', ['fitness', 'workout', 'exercise', 'training', 'gym']],
    ['sports', ['sports', 'athletic', 'fitness', 'training']],
    ['swimming', ['swimming', 'pool', 'aquatic', 'water sports']],

    // Beauty & Personal Care
    ['salon', ['beauty', 'hair', 'spa', 'cosmetics', 'styling', 'salon']],
    ['spa', ['spa', 'wellness', 'relaxation', 'massage', 'beauty']],
    ['barber', ['barber', 'haircut', 'grooming', "men's hair"]],
    ['nail', ['nail', 'manicure', 'pedicure', 'nail art']],

    // Automotive
    ['car', ['car', 'automotive', 'vehicle', 'auto', 'motor']],
    ['mechanic', ['mechanic', 'auto repair', 'car service', 'automotive']],
    ['gas station', ['gas', 'fuel', 'petrol', 'gas station', 'filling station']],

    // Professional Services
    ['lawyer', ['lawyer', 'attorney', 'legal', 'law', 'advocate']],
    ['accountant', ['accountant', 'accounting', 'tax', 'financial advisor']],
    ['consultant', ['consultant', 'consulting', 'advisor', 'expert']],

    // Technology
    ['software', ['software', 'tech', 'technology', 'digital', 'app']],
    ['web design', ['web design', 'website', 'digital', 'online']],
    ['it', ['it', 'technology', 'computer', 'tech', 'information technology']],

    // Real Estate
    ['real estate', ['real estate', 'property', 'housing', 'realty']],
    ['agent', ['agent', 'broker', 'real estate', 'property']],

    // Entertainment
    ['cinema', ['cinema', 'movie', 'theater', 'film', 'entertainment']],
    ['club', ['club', 'nightclub', 'entertainment', 'party']],
    ['gaming', ['gaming', 'game', 'arcade', 'entertainment']],

    // Transportation
    ['taxi', ['taxi', 'cab', 'transport', 'ride', 'car service']],
    ['bus', ['bus', 'transport', 'public transport', 'transit']],
    ['airport', ['airport', 'air travel', 'flight', 'aviation']],

    // Home Services
    ['plumber', ['plumber', 'plumbing', 'pipe', 'water']],
    ['electrician', ['electrician', 'electrical', 'power', 'wiring']],
    ['cleaner', ['cleaner', 'cleaning', 'housekeeping', 'janitorial']],
    ['security', ['security', 'guard', 'protection', 'safety']],

    // Events & Venues
    ['venue', ['venue', 'event', 'hall', 'space', 'facility']],
    ['wedding', ['wedding', 'marriage', 'ceremony', 'reception']],
    ['conference', ['conference', 'meeting', 'event', 'business']],

    // Religious
    ['church', ['church', 'religious', 'worship', 'faith']],
    ['mosque', ['mosque', 'islamic', 'prayer', 'religious']],
    ['temple', ['temple', 'religious', 'worship', 'faith']],

    // Government
    ['government', ['government', 'public', 'official', 'administration']],
    ['post office', ['post office', 'mail', 'postal', 'shipping']],
    ['police', ['police', 'law enforcement', 'security', 'authority']],
  ]);

  private readonly locationKeywords = [
    'near',
    'close to',
    'around',
    'in',
    'at',
    'within',
    'nearby',
    'me',
    'here',
    'this area',
    'local',
    'downtown',
    'uptown',
  ];

  private readonly serviceKeywords = [
    'delivery',
    'takeout',
    'pickup',
    '24/7',
    'emergency',
    'urgent',
    'online',
    'appointment',
    'booking',
    'reservation',
    'walk-in',
    'drive-thru',
    'curbside',
    'home service',
    'mobile',
  ];

  private readonly modifiers = [
    'best',
    'cheap',
    'expensive',
    'popular',
    'new',
    'old',
    'famous',
    'top',
    'rated',
    'recommended',
    'affordable',
    'luxury',
    'budget',
    'quick',
    'fast',
    'slow',
    'quiet',
    'busy',
    'crowded',
  ];

  constructor(private readonly configService?: ConfigService) {}

  /**
   * Extract all entities from a query using parallel processing
   */
  async extractEntities(query: string): Promise<EntityExtractionResult> {
    const normalizedQuery = this.normalizeQuery(query);

    // Use Promise.all for parallel processing (simulating worker threads)
    const [businessTypes, locations, services, modifiers] = await Promise.all([
      this.extractBusinessTypes(normalizedQuery),
      this.extractLocationReferences(normalizedQuery),
      this.extractServiceKeywords(normalizedQuery),
      this.extractModifiers(normalizedQuery),
    ]);

    return {
      businessTypes,
      locations,
      services,
      modifiers,
    };
  }

  /**
   * Extract business types from query
   */
  private async extractBusinessTypes(query: string): Promise<string[]> {
    const foundTypes: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const [primaryType, synonyms] of this.businessTypes) {
      // Check for primary type (including plurals)
      if (this.matchesWord(queryWords, primaryType)) {
        foundTypes.push(primaryType);
        continue;
      }

      // Check for synonyms (including plurals)
      for (const synonym of synonyms) {
        if (this.matchesWord(queryWords, synonym)) {
          foundTypes.push(primaryType);
          break;
        }
      }
    }

    return foundTypes;
  }

  /**
   * Check if a word matches any of the query words (handling plurals)
   */
  private matchesWord(queryWords: string[], targetWord: string): boolean {
    // Direct match
    if (queryWords.includes(targetWord)) {
      return true;
    }

    // Handle plurals (simple pluralization)
    const plural = targetWord.endsWith('y') ? targetWord.slice(0, -1) + 'ies' : targetWord + 's';

    if (queryWords.includes(plural)) {
      return true;
    }

    // Handle singular from plural
    if (targetWord.endsWith('ies')) {
      const singular = targetWord.slice(0, -3) + 'y';
      if (queryWords.includes(singular)) {
        return true;
      }
    } else if (targetWord.endsWith('s')) {
      const singular = targetWord.slice(0, -1);
      if (queryWords.includes(singular)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract location references from query
   */
  private async extractLocationReferences(query: string): Promise<string[]> {
    const foundLocations: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/);

    // Check for location keywords
    for (const keyword of this.locationKeywords) {
      if (query.includes(keyword)) {
        foundLocations.push(keyword);
      }
    }

    // Check for common location patterns
    const locationPatterns = [
      /\b(near|close to|around)\s+me\b/i,
      /\b(in|at)\s+([a-zA-Z\s]+)\b/i,
      /\b(downtown|uptown|midtown)\b/i,
    ];

    for (const pattern of locationPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        foundLocations.push(matches[0]);
      }
    }

    return foundLocations;
  }

  /**
   * Extract service keywords from query
   */
  private async extractServiceKeywords(query: string): Promise<string[]> {
    const foundServices: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const service of this.serviceKeywords) {
      if (queryWords.includes(service) || query.includes(service)) {
        foundServices.push(service);
      }
    }

    return foundServices;
  }

  /**
   * Extract modifiers from query
   */
  private async extractModifiers(query: string): Promise<string[]> {
    const foundModifiers: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const modifier of this.modifiers) {
      if (queryWords.includes(modifier)) {
        foundModifiers.push(modifier);
      }
    }

    return foundModifiers;
  }

  /**
   * Normalize query for consistent processing
   */
  private normalizeQuery(query: string): string {
    if (!query) return '';
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Get business type synonyms for query expansion
   */
  getBusinessTypeSynonyms(businessType: string): string[] {
    return this.businessTypes.get(businessType) || [];
  }

  /**
   * Check if query contains location references
   */
  hasLocationReference(query: string): boolean {
    const normalizedQuery = this.normalizeQuery(query);
    return this.locationKeywords.some(keyword => normalizedQuery.includes(keyword));
  }

  /**
   * Get all available business types
   */
  getAllBusinessTypes(): string[] {
    return Array.from(this.businessTypes.keys());
  }
}
