import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryExpansionResult } from '../interfaces/intelligent-search.interface';

@Injectable()
export class QueryExpansionService {
  private readonly logger = new Logger(QueryExpansionService.name);

  // Synonym mappings for business types and services
  private readonly synonyms = new Map<string, string[]>([
    // Business types
    [
      'restaurant',
      ['food', 'dining', 'eatery', 'cafe', 'bistro', 'pub', 'bar', 'grill', 'kitchen'],
    ],
    ['hotel', ['accommodation', 'lodging', 'guesthouse', 'inn', 'resort', 'motel', 'hostel']],
    ['clinic', ['hospital', 'medical', 'healthcare', 'doctor', 'pharmacy', 'dental', 'clinic']],
    ['shop', ['store', 'retail', 'market', 'mall', 'supermarket', 'grocery', 'shop']],
    ['bank', ['financial', 'credit union', 'atm', 'money', 'finance', 'banking']],
    ['school', ['education', 'university', 'college', 'academy', 'institute', 'school']],
    ['gym', ['fitness', 'workout', 'exercise', 'sports', 'training', 'gym']],
    ['salon', ['beauty', 'hair', 'spa', 'cosmetics', 'styling', 'salon']],

    // Services
    ['delivery', ['delivery', 'deliver', 'home delivery', 'door delivery']],
    ['takeout', ['takeout', 'take away', 'take-away', 'pickup', 'to go']],
    ['24/7', ['24/7', '24 hours', 'all day', 'all night', 'always open']],
    ['emergency', ['emergency', 'urgent', 'immediate', 'asap']],
    ['appointment', ['appointment', 'booking', 'reservation', 'schedule']],
  ]);

  // Related terms for better context understanding
  private readonly relatedTerms = new Map<string, string[]>([
    ['pizza', ['Italian', 'delivery', 'takeout', 'restaurant']],
    ['coffee', ['cafe', 'beverage', 'drink', 'breakfast']],
    ['haircut', ['salon', 'beauty', 'styling', 'appointment']],
    ['workout', ['gym', 'fitness', 'exercise', 'training']],
    ['medicine', ['pharmacy', 'drugstore', 'medical', 'prescription']],
    ['money', ['bank', 'atm', 'financial', 'cash']],
  ]);

  constructor(private readonly configService?: ConfigService) {}

  /**
   * Expand query with synonyms and related terms
   */
  async expandQuery(
    originalQuery: string,
    businessTypes: string[],
    services: string[],
  ): Promise<QueryExpansionResult> {
    const normalizedQuery = this.normalizeQuery(originalQuery);
    const expandedTerms: string[] = [];
    const synonyms: string[] = [];
    const relatedTerms: string[] = [];

    // Add original query terms
    const originalTerms = normalizedQuery.split(/\s+/).filter(term => term.length > 0);
    expandedTerms.push(...originalTerms);

    // Add synonyms for business types
    for (const businessType of businessTypes) {
      const businessSynonyms = this.synonyms.get(businessType) || [];
      synonyms.push(...businessSynonyms);
      expandedTerms.push(...businessSynonyms);
    }

    // Add synonyms for services
    for (const service of services) {
      const serviceSynonyms = this.synonyms.get(service) || [];
      synonyms.push(...serviceSynonyms);
      expandedTerms.push(...serviceSynonyms);
    }

    // Add related terms for specific keywords
    for (const term of originalTerms) {
      const related = this.relatedTerms.get(term) || [];
      relatedTerms.push(...related);
      expandedTerms.push(...related);
    }

    // Remove duplicates and create expanded query
    const uniqueExpandedTerms = [...new Set(expandedTerms)];
    const expandedQuery = uniqueExpandedTerms.join(' ');

    return {
      original: originalQuery,
      expanded: expandedQuery,
      synonyms: [...new Set(synonyms)],
      relatedTerms: [...new Set(relatedTerms)],
    };
  }

  /**
   * Get synonyms for a specific term
   */
  getSynonyms(term: string): string[] {
    return this.synonyms.get(term.toLowerCase()) || [];
  }

  /**
   * Get related terms for a specific term
   */
  getRelatedTerms(term: string): string[] {
    return this.relatedTerms.get(term.toLowerCase()) || [];
  }

  /**
   * Check if a term has synonyms
   */
  hasSynonyms(term: string): boolean {
    return this.synonyms.has(term.toLowerCase());
  }

  /**
   * Check if a term has related terms
   */
  hasRelatedTerms(term: string): boolean {
    return this.relatedTerms.has(term.toLowerCase());
  }

  /**
   * Normalize query for consistent processing
   */
  private normalizeQuery(query: string): string {
    if (!query) return '';
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Add custom synonym mapping
   */
  addSynonym(term: string, synonyms: string[]): void {
    const normalizedTerm = term.toLowerCase();
    const existingSynonyms = this.synonyms.get(normalizedTerm) || [];
    this.synonyms.set(normalizedTerm, [...new Set([...existingSynonyms, ...synonyms])]);
  }

  /**
   * Add custom related terms mapping
   */
  addRelatedTerms(term: string, related: string[]): void {
    const normalizedTerm = term.toLowerCase();
    const existingRelated = this.relatedTerms.get(normalizedTerm) || [];
    this.relatedTerms.set(normalizedTerm, [...new Set([...existingRelated, ...related])]);
  }
}
