import { parentPort, workerData } from 'worker_threads';

// Entity extraction worker for parallel processing
class EntityExtractionWorker {
  private isRunning = true;

  // Business-specific entity mappings
  private readonly businessTypes = new Map<string, string[]>([
    ['restaurant', ['food', 'dining', 'eatery', 'cafe', 'bistro', 'pub', 'bar', 'grill']],
    ['hotel', ['accommodation', 'lodging', 'guesthouse', 'inn', 'resort', 'motel']],
    ['clinic', ['hospital', 'medical', 'healthcare', 'doctor', 'pharmacy', 'dental']],
    ['shop', ['store', 'retail', 'market', 'mall', 'supermarket', 'grocery']],
    ['bank', ['financial', 'credit union', 'atm', 'money', 'finance']],
    ['school', ['education', 'university', 'college', 'academy', 'institute']],
    ['gym', ['fitness', 'workout', 'exercise', 'sports', 'training']],
    ['salon', ['beauty', 'hair', 'spa', 'cosmetics', 'styling']],
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

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (!parentPort) {
      throw new Error('This module must be run as a worker thread');
    }

    parentPort.on('message', async (message: any) => {
      if (message.type === 'extract') {
        await this.extractEntities(message.data);
      } else if (message.type === 'terminate') {
        this.terminate();
      }
    });

    // Report ready
    parentPort.postMessage({ type: 'ready' });
  }

  private async extractEntities(data: { query: string; entityType: string }): Promise<void> {
    try {
      if (!this.isRunning) return;

      const { query, entityType } = data;
      const normalizedQuery = this.normalizeQuery(query);

      let result: string[] = [];

      switch (entityType) {
        case 'businessTypes':
          result = await this.extractBusinessTypes(normalizedQuery);
          break;
        case 'locations':
          result = await this.extractLocationReferences(normalizedQuery);
          break;
        case 'services':
          result = await this.extractServiceKeywords(normalizedQuery);
          break;
        case 'modifiers':
          result = await this.extractModifiers(normalizedQuery);
          break;
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }

      // Send back results
      parentPort?.postMessage({
        type: 'result',
        data: {
          entityType,
          entities: result,
        },
      });
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        data: {
          entityType: data.entityType,
          error: error.message,
        },
      });
    }
  }

  private async extractBusinessTypes(query: string): Promise<string[]> {
    const foundTypes: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const [primaryType, synonyms] of this.businessTypes) {
      // Check for primary type
      if (queryWords.includes(primaryType)) {
        foundTypes.push(primaryType);
        continue;
      }

      // Check for synonyms
      for (const synonym of synonyms) {
        if (queryWords.includes(synonym)) {
          foundTypes.push(primaryType);
          break;
        }
      }
    }

    return foundTypes;
  }

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

  private normalizeQuery(query: string): string {
    if (!query) return '';
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private terminate(): void {
    this.isRunning = false;
    process.exit(0);
  }
}

// Initialize worker
new EntityExtractionWorker();
