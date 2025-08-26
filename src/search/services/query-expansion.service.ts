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
    query: string,
    businessTypes: string[],
    services: string[],
  ): Promise<QueryExpansionResult> {
    const original = query;
    let expanded = query;

    try {
      // Limit expansion to prevent query bloat
      const maxSynonyms = 2; // Reduced from 3
      const maxRelatedTerms = 1; // Reduced from 2

      // Add business type synonyms (limited)
      if (businessTypes.length > 0) {
        const synonyms = this.getBusinessTypeSynonyms(businessTypes[0]); // Only use first business type
        const limitedSynonyms = synonyms.slice(0, maxSynonyms);
        if (limitedSynonyms.length > 0) {
          expanded += ' ' + limitedSynonyms.join(' ');
        }
      }

      // Add service synonyms (limited) - only if not already in business types
      if (services.length > 0 && !businessTypes.includes(services[0])) {
        const serviceSynonyms = this.getServiceSynonyms(services[0]); // Only use first service
        const limitedServiceSynonyms = serviceSynonyms.slice(0, maxRelatedTerms);
        if (limitedServiceSynonyms.length > 0) {
          expanded += ' ' + limitedServiceSynonyms.join(' ');
        }
      }

      // Remove duplicate terms and clean up
      const terms = expanded.split(/\s+/);
      const uniqueTerms = [...new Set(terms)];
      expanded = uniqueTerms.join(' ');

      return {
        original,
        expanded: expanded.trim(),
        synonyms: businessTypes,
        relatedTerms: services,
      };
    } catch (error) {
      this.logger.warn(`Query expansion failed: ${error.message}`);
      return {
        original,
        expanded: original,
        synonyms: [],
        relatedTerms: [],
      };
    }
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
   * Get business type synonyms
   */
  private getBusinessTypeSynonyms(businessType: string): string[] {
    return this.synonyms.get(businessType) || [];
  }

  /**
   * Get service synonyms
   */
  private getServiceSynonyms(service: string): string[] {
    return this.synonyms.get(service) || [];
  }

  /**
   * Get query synonyms
   */
  private getQuerySynonyms(query: string): string[] {
    const terms = query.toLowerCase().split(/\s+/);
    const synonyms: string[] = [];

    for (const term of terms) {
      const termSynonyms = this.synonyms.get(term) || [];
      synonyms.push(...termSynonyms);
    }

    return [...new Set(synonyms)]; // Remove duplicates
  }

  /**
   * Normalize query for processing
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
