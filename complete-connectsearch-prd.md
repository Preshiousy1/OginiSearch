# Ogini Product Requirements Document

## 1. Product Overview & Market Analysis

### 1.1 Vision

Ogini is a developer-friendly search-as-a-service microservice built with NestJS/TypeScript, providing fast and relevant search functionality while maintaining simplicity and scalability.

### 1.2 Market Positioning

Unlike heavyweight solutions like Elasticsearch that require significant infrastructure and expertise, or closed SaaS platforms like Algolia with usage-based pricing that can become expensive at scale, Ogini provides:

- **Developer simplicity**: Easy integration with minimal configuration
- **Operational lightness**: Lower resource requirements than Elasticsearch
- **Cost predictability**: Self-hosted with no per-query fees
- **Framework integration**: First-class support for popular frameworks
- **Deployment flexibility**: From single instances to distributed clusters

### 1.3 Target Users

- Startups and SMBs with search needs beyond basic database queries
- Development teams who need search but lack specialized search expertise
- Projects with cost-sensitivity where Algolia pricing is prohibitive
- Applications with moderate data volumes (up to tens of millions of documents)
- Teams building internal tools with search requirements

### 1.4 Total Cost of Ownership Comparison

| Aspect | Ogini | Elasticsearch | Algolia | Meilisearch |
|--------|--------------|---------------|---------|-------------|
| Infrastructure | Moderate | High | None (SaaS) | Low |
| Setup complexity | Low | High | Low | Low |
| Maintenance | Low | High | None | Low |
| Pricing model | Self-hosted | Self-hosted or SaaS | Usage-based | Self-hosted or SaaS |
| Expertise required | Minimal | Significant | Minimal | Minimal |
| Scaling complexity | Moderate | High | None | Moderate |

## 2. Key Features

### 2.1 Core Search Capabilities

#### 2.1.1 Search Algorithm
- Okapi BM25 implementation for proven relevance
- Configurable weighting factors for different fields
- Support for exact phrase matching
- Field-specific boosting and importance factors

#### 2.1.2 Text Analysis Pipeline
- Configurable tokenization strategies
- Language detection for multi-language content
- Normalization, stemming, and lemmatization
- Stopword handling with language-specific defaults
- Support for custom analyzers and token filters

#### 2.1.3 Query Understanding
- Basic spelling correction with edit distance
- Synonym expansion using custom dictionaries
- Query relaxation for zero-result scenarios
- Query scoping to specific fields or content types

#### 2.1.4 Typo Tolerance
- Character-level n-gram indexing for efficient fuzzy matching
- Configurable tolerance levels based on word length
- Position-aware typo correction
- Phonetic matching for name searches (optional)

#### 2.1.5 Multilingual Support
- Language detection for automatic analyzer selection
- Language-specific tokenization and stemming
- Unicode normalization for international characters
- Right-to-left language support

### 2.2 Performance and Scalability

#### 2.2.1 Tiered Architecture
- In-memory cache for frequently accessed queries and documents
- Persistent storage for complete index
- Read replicas for search-heavy workloads

#### 2.2.2 Sharding Strategy
- Hash-based document distribution
- Configurable shard count and replication factor
- Cross-shard query coordination
- Consistent hashing for minimal redistribution during scaling

#### 2.2.3 Resource Optimization
- Efficient memory usage with appropriate data structures
- Smart compression for index storage
- Incremental updates to minimize reindexing operations
- Query result caching with time-to-live configuration

### 2.3 Developer Experience

#### 2.3.1 Comprehensive API Documentation
- Interactive Swagger/OpenAPI documentation
- Detailed DTOs with clear property descriptions
- Real-world examples for every endpoint
- Response schema documentation with status codes

#### 2.3.2 Simple, Developer-Friendly API
- RESTful endpoints with predictable patterns
- GraphQL support for flexible queries
- WebSocket support for real-time search suggestions

#### 2.3.3 Client Libraries
- TypeScript/JavaScript client (auto-generated)
- PHP/Laravel integration package
- Python client library
- Additional language SDKs based on demand

#### 2.3.4 Documentation and Examples
- Getting started guides for common scenarios
- Framework-specific tutorials (React, Vue, Laravel, etc.)
- Complete working example applications
- Best practices for search implementation

### 2.4 Advanced Features

#### 2.4.1 Relevance Controls
- Field boosting with weighting factors
- Document boosting based on metadata
- Recency boosting for time-sensitive content
- Custom scoring functions with expression language

#### 2.4.2 Vector Search
- Basic vector embedding support
- Semantic search capabilities
- Hybrid search combining keyword and vector approaches
- Pre-built embedding models for common use cases

#### 2.4.3 Geospatial Search
- Support for location-based queries
- IP-based location detection
- Distance-based sorting and filtering
- Location-aware relevance boosting

#### 2.4.4 Analytics Integration
- Search query tracking
- Zero-result query monitoring
- Click-through tracking
- A/B testing for result ranking

#### 2.4.5 Adaptable Featured Search
- Metadata-driven featuring system for any entity type
- Configurable keyword and category-based featuring
- Priority ranking system for featured results
- Time-bound featuring with automatic expiration
- Registry for dynamically adding featurable entity types
- Cross-entity type featuring capabilities

### 2.5 Enterprise Features

#### 2.5.1 Security
- API key-based authentication
- Role-based access control for indexes
- Document-level security filtering
- Encrypted storage for sensitive data

#### 2.5.2 Multi-Tenancy
- Complete tenant isolation
- Tenant-specific configurations
- Resource quotas and rate limiting
- Cross-tenant analytics (with proper permissions)

#### 2.5.3 Operational Features
- Health check endpoints
- Backup and restore capabilities
- Monitoring and alerting integration
- Audit logging for security events

## 3. Technical Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────┐
│           Client Applications        │
└───────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│            API Gateway               │
└───────────────────┬─────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│         Ogini API            │
│  ┌───────────┐  ┌───────────────┐   │
│  │   REST    │  │    GraphQL    │   │
│  └─────┬─────┘  └────────┬──────┘   │
│        │                 │          │
│  ┌─────▼─────────────────▼──────┐   │
│  │       Service Layer          │   │
│  └─────┬─────────────────┬──────┘   │
│        │                 │          │
│  ┌─────▼─────┐     ┌─────▼─────┐    │
│  │  Search   │     │   Index   │    │
│  │  Engine   │     │  Manager  │    │
│  └─────┬─────┘     └─────┬─────┘    │
└────────┼─────────────────┼──────────┘
         │                 │
┌────────▼─────────────────▼──────────┐
│          Storage Layer               │
│  ┌───────────┐       ┌───────────┐  │
│  │  Index    │       │ Document  │  │
│  │  Store    │       │  Store    │  │
│  └───────────┘       └───────────┘  │
└─────────────────────────────────────┘
```

In the initial phase (1-3 months), we'll focus on a simplified architecture with:

1. **Single-Node Design**: All components run in a single process
2. **Embedded RocksDB**: For efficient local storage
3. **MongoDB Integration**: For document storage
4. **Memory-Optimized Index**: For fast search operations
5. **REST API Only**: GraphQL will come in later phases
6. **Simple Client Library**: Focused on TypeScript/JavaScript

This approach allows us to deliver exceptional developer experience quickly while laying the groundwork for more advanced features in later phases.

### 3.2 Core Components for Phase 1

#### 3.2.1 Simplified Search Engine

The Phase 1 search engine focuses on core functionality:

```typescript
class SimpleSearchEngine implements SearchEngine {
  constructor(
    private readonly indexStore: IndexStore,
    private readonly documentStore: DocumentStore,
    private readonly analyzer: AnalysisPipeline,
    private readonly scoreCalculator: ScoreCalculator
  ) {}
  
  async search(
    indexName: string, 
    searchParams: SearchParams
  ): Promise<SearchResults> {
    // Get index metadata
    const indexConfig = await this.indexStore.getIndexMetadata(indexName);
    if (!indexConfig) {
      throw new Error(`Index ${indexName} not found`);
    }
    
    // Process query
    const processedQuery = this.analyzer.processQuery(
      searchParams.query,
      indexConfig.defaultAnalyzer
    );
    
    // Get matching documents
    const matches = await this.findMatches(indexName, processedQuery);
    
    // Score and rank
    const scoredMatches = this.scoreCalculator.scoreMatches(
      processedQuery,
      matches,
      indexConfig
    );
    
    // Apply filters if present
    const filteredMatches = searchParams.filters
      ? this.applyFilters(scoredMatches, searchParams.filters)
      : scoredMatches;
    
    // Sort by score
    const sortedMatches = filteredMatches.sort((a, b) => b.score - a.score);
    
    // Apply pagination
    const limit = searchParams.limit || 20;
    const offset = searchParams.offset || 0;
    const paginatedMatches = sortedMatches.slice(offset, offset + limit);
    
    // Fetch document data
    const hits = await Promise.all(
      paginatedMatches.map(async match => {
        const doc = await this.documentStore.getDocument(indexName, match.documentId);
        return {
          id: match.documentId,
          score: match.score,
          document: doc
        };
      })
    );
    
    return {
      hits,
      totalHits: filteredMatches.length,
      query: searchParams.query,
      processingTimeMs: 0 // Calculated in middleware
    };
  }
  
  // Helper methods (simplified for Phase 1)
  private async findMatches(
    indexName: string,
    query: ProcessedQuery
  ): Promise<Match[]> {
    // For each term, get posting list
    const matchesByTerm = await Promise.all(
      query.terms.map(async term => {
        const postings = await this.indexStore.getPostings(indexName, term);
        return postings.map(posting => ({
          documentId: posting.documentId,
          term,
          termFrequency: posting.frequency,
          positions: posting.positions
        }));
      })
    );
    
    // Flatten and group by document
    const matches: Record<string, Match> = {};
    
    for (const termMatches of matchesByTerm) {
      for (const match of termMatches) {
        if (!matches[match.documentId]) {
          matches[match.documentId] = {
            documentId: match.documentId,
            termMatches: {},
            score: 0
          };
        }
        
        matches[match.documentId].termMatches[match.term] = {
          frequency: match.termFrequency,
          positions: match.positions
        };
      }
    }
    
    return Object.values(matches);
  }
  
  private applyFilters(matches: ScoredMatch[], filters: any): ScoredMatch[] {
    // Simple filter implementation for Phase 1
    // More complex filters will be added in Phase 2
    return matches.filter(match => {
      // Implementation details...
      return true; // Placeholder
    });
  }
}
```

#### 3.2.2 Document Processor

Streamlined document processing for Phase 1:

```typescript
class DocumentProcessor {
  constructor(
    private readonly analyzer: AnalysisPipeline
  ) {}
  
  processDocument(
    document: any,
    indexConfig: IndexConfig
  ): ProcessedDocument {
    const result: ProcessedDocument = {
      id: document.id,
      fields: {},
      fieldLengths: {}
    };
    
    // Process each searchable field
    for (const field of indexConfig.searchableAttributes) {
      if (!document[field] || typeof document[field] !== 'string') {
        continue;
      }
      
      const fieldValue = document[field];
      const analyzerName = indexConfig.fieldAnalyzers?.[field] || indexConfig.defaultAnalyzer;
      
      // Analyze the field
      const tokens = this.analyzer.analyze(fieldValue, analyzerName);
      
      // Store processed tokens
      result.fields[field] = tokens.map(token => token.term);
      
      // Store field length (using original text length)
      result.fieldLengths[field] = fieldValue.length;
    }
    
    return result;
  }
}
```

#### 3.2.3 Index Manager

The Index Manager handles index operations:

```typescript
class IndexManager {
  constructor(
    private readonly indexStore: IndexStore,
    private readonly documentStore: DocumentStore,
    private readonly documentProcessor: DocumentProcessor,
    private readonly schemaManager: SchemaVersionManager
  ) {}
  
  async createIndex(
    indexName: string,
    config: IndexConfig
  ): Promise<void> {
    // Validate config
    this.validateConfig(config);
    
    // Create the schema version
    await this.schemaManager.registerSchema(indexName, 1, {
      mappings: this.convertConfigToMappings(config)
    });
    
    // Set as current schema version
    await this.schemaManager.setCurrentVersion(indexName, 1);
    
    // Store index configuration
    await this.indexStore.saveIndexMetadata(indexName, {
      name: indexName,
      config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0
    });
  }
  
  async addDocument(
    indexName: string,
    document: any
  ): Promise<void> {
    // Get index metadata
    const indexMeta = await this.indexStore.getIndexMetadata(indexName);
    if (!indexMeta) {
      throw new Error(`Index ${indexName} not found`);
    }
    
    // Process document
    const processedDoc = this.documentProcessor.processDocument(
      document,
      indexMeta.config
    );
    
    // Store document in document store
    await this.documentStore.storeDocument(
      indexName,
      document.id,
      document,
      this.schemaManager.getCurrentVersion(indexName)
    );
    
    // Update inverted index
    await this.updateInvertedIndex(indexName, processedDoc);
    
    // Update document count
    await this.updateDocumentCount(indexName, 1);
  }
  
  // Additional methods...
  
  private async updateInvertedIndex(
    indexName: string,
    processedDoc: ProcessedDocument
  ): Promise<void> {
    // Get all unique terms from all fields
    const termFrequencies = new Map<string, Map<string, number>>();
    
    for (const [field, terms] of Object.entries(processedDoc.fields)) {
      for (const term of terms) {
        if (!termFrequencies.has(term)) {
          termFrequencies.set(term, new Map());
        }
        
        const fieldFreq = termFrequencies.get(term)!;
        fieldFreq.set(field, (fieldFreq.get(field) || 0) + 1);
      }
    }
    
    // Update each term's posting list
    const updates: Promise<void>[] = [];
    
    for (const [term, fieldFreqs] of termFrequencies.entries()) {
      const postingUpdate = {
        documentId: processedDoc.id,
        frequencies: Object.fromEntries(fieldFreqs),
        // In Phase 1, we'll skip position information for simplicity
        positions: {}
      };
      
      updates.push(this.indexStore.updatePosting(indexName, term, postingUpdate));
    }
    
    await Promise.all(updates);
  }
}
```

#### 3.2.4 Adaptable Featured Search Implementation

Ogini provides a flexible featuring system that works with any entity type:

```typescript
// Featured item entity for storing featuring metadata
@Entity()
export class FeaturedItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entityType: string; // 'business', 'product', 'article', etc.

  @Column()
  entityId: string; // The ID in the original collection/table

  @Column('simple-array')
  keywords: string[]; // Keywords that trigger this featured item

  @Column('simple-array')
  categories: string[]; // Categories where this should be featured

  @Column({ default: 0 })
  rank: number; // Priority among featured items (lower = higher priority)

  @Column({ nullable: true, type: 'datetime' })
  expiresAt: Date | null; // When the featuring expires

  @Column({ type: 'jsonb', nullable: true })
  featureOptions: Record<string, any>; // Additional featuring options
}

// Feature Registry Service for managing featurable entity types
@Injectable()
export class FeatureRegistryService {
  private readonly entityConfigs: Map<string, EntityFeatureConfig> = new Map();

  registerEntity(entityType: string, config: EntityFeatureConfig): void {
    this.entityConfigs.set(entityType, config);
  }

  getEntityConfig(entityType: string): EntityFeatureConfig | undefined {
    return this.entityConfigs.get(entityType);
  }

  getRegisteredEntityTypes(): string[] {
    return Array.from(this.entityConfigs.keys());
  }
}

interface EntityFeatureConfig {
  indexName: string; // Which search index this entity belongs to
  documentIdField: string; // Which field contains the unique ID
  keywordFields: string[]; // Fields to extract keywords from
  categoryFields: string[]; // Fields containing category information
  boostAmount: number; // How much to boost this entity type when featured
}

// Feature Manager Service for handling featured items
@Injectable()
export class FeatureManagerService {
  constructor(
    @InjectRepository(FeaturedItem)
    private featuredItemRepository: Repository<FeaturedItem>,
    private featureRegistryService: FeatureRegistryService
  ) {}

  async featureEntity(
    entityType: string,
    entityId: string,
    options: FeatureOptions
  ): Promise<FeaturedItem> {
    // Validate entity type is registered
    const config = this.featureRegistryService.getEntityConfig(entityType);
    if (!config) {
      throw new Error(`Entity type ${entityType} is not registered for featuring`);
    }

    // Create or update featured item
    let featuredItem = await this.featuredItemRepository.findOne({
      where: { entityType, entityId }
    });

    if (!featuredItem) {
      featuredItem = new FeaturedItem();
      featuredItem.entityType = entityType;
      featuredItem.entityId = entityId;
    }

    featuredItem.keywords = options.keywords || [];
    featuredItem.categories = options.categories || [];
    featuredItem.rank = options.rank || 0;
    featuredItem.expiresAt = options.expiresAt || null;
    featuredItem.featureOptions = options.additionalOptions || {};

    return this.featuredItemRepository.save(featuredItem);
  }

  async getFeaturedItems(
    entityType?: string,
    options?: GetFeaturedItemsOptions
  ): Promise<FeaturedItem[]> {
    const queryBuilder = this.featuredItemRepository.createQueryBuilder('featured');
    
    // Only get active featured items
    queryBuilder.where('featured.expiresAt IS NULL OR featured.expiresAt > :now', {
      now: new Date()
    });
    
    if (entityType) {
      queryBuilder.andWhere('featured.entityType = :entityType', { entityType });
    }
    
    // Apply additional filters
    if (options?.categories?.length) {
      queryBuilder.andWhere('featured.categories && :categories', {
        categories: options.categories
      });
    }
    
    if (options?.keywords?.length) {
      queryBuilder.andWhere('featured.keywords && :keywords', {
        keywords: options.keywords
      });
    }
    
    // Order by rank
    queryBuilder.orderBy('featured.rank', 'ASC');
    
    return queryBuilder.getMany();
  }
}

// Search Enhancer Service to augment search results with featured items
@Injectable()
export class SearchEnhancerService {
  constructor(
    private featureManagerService: FeatureManagerService,
    private featureRegistryService: FeatureRegistryService,
    private searchService: SearchService
  ) {}

  async enhancedSearch(
    indexName: string,
    searchParams: SearchParams
  ): Promise<EnhancedSearchResults> {
    // Extract keywords from the query
    const keywords = this.extractKeywords(searchParams.query);
    
    // Find all entity types for this index
    const entityTypes = this.getEntityTypesForIndex(indexName);
    
    // Get all featured items relevant to this search
    const featuredItems = await this.featureManagerService.getFeaturedItems(
      undefined, // Get all entity types
      {
        keywords,
        categories: searchParams.categories
      }
    );
    
    // Filter to only include entity types for this index
    const relevantFeaturedItems = featuredItems.filter(item => 
      entityTypes.includes(item.entityType)
    );
    
    // Execute normal search
    const searchResults = await this.searchService.search(indexName, searchParams);
    
    // Enhance results with featured items
    const enhancedResults = this.enhanceResults(searchResults, relevantFeaturedItems);
    
    return enhancedResults;
  }
  
  private enhanceResults(
    results: SearchResults,
    featuredItems: FeaturedItem[]
  ): EnhancedSearchResults {
    // Map of entity IDs to their featured info
    const featuredMap = new Map(
      featuredItems.map(item => [`${item.entityType}:${item.entityId}`, item])
    );
    
    // Split results into featured and non-featured
    const featuredResults: SearchHit[] = [];
    const regularResults: SearchHit[] = [];
    
    // Check each hit to see if it's featured
    for (const hit of results.hits) {
      // Try to identify entity type from the document
      const entityType = this.identifyEntityType(hit.document);
      if (!entityType) {
        regularResults.push(hit);
        continue;
      }
      
      // Check if this document is featured
      const featuredKey = `${entityType}:${hit.id}`;
      if (featuredMap.has(featuredKey)) {
        // Add featuring info to the hit
        const featureInfo = featuredMap.get(featuredKey)!;
        const enhancedHit = {
          ...hit,
          featured: true,
          featureInfo: {
            rank: featureInfo.rank,
            keywords: featureInfo.keywords,
            categories: featureInfo.categories
          }
        };
        
        featuredResults.push(enhancedHit);
      } else {
        regularResults.push(hit);
      }
    }
    
    // Sort featured results by rank
    featuredResults.sort((a, b) => 
      (a.featureInfo?.rank || 0) - (b.featureInfo?.rank || 0)
    );
    
    // Return combined results
    return {
      ...results,
      hits: [...featuredResults, ...regularResults],
      featuredCount: featuredResults.length
    };
  }
}
```

### 3.3 API Specification

#### 3.3.1 REST API Endpoints

- **Index Management**
  - `POST /indexes` - Create a new index
  - `GET /indexes` - List all indexes
  - `GET /indexes/:indexName` - Get index details
  - `PUT /indexes/:indexName` - Update index configuration
  - `DELETE /indexes/:indexName` - Delete an index

- **Document Management**
  - `POST /indexes/:indexName/documents` - Add or update documents
  - `GET /indexes/:indexName/documents/:documentId` - Get a document by ID
  - `DELETE /indexes/:indexName/documents/:documentId` - Delete a document
  - `POST /indexes/:indexName/documents/batch` - Batch document operations

- **Search**
  - `POST /indexes/:indexName/search` - Perform a search
  - `GET /indexes/:indexName/suggest?q=:query` - Get search suggestions
  - `POST /indexes/:indexName/geo-search` - Perform location-based search
  - `GET /indexes/:indexName/search/around?lat=:latitude&lng=:longitude&radius=:radius` - Find documents near a location

- **Webhooks**
  - `POST /indexes/:indexName/webhook` - Webhook for document updates
  - `POST /indexes/:indexName/webhook/batch` - Webhook for batch updates

- **Analytics**
  - `GET /indexes/:indexName/analytics/popular` - Get popular searches
  - `GET /indexes/:indexName/analytics/zero-results` - Get zero-result queries

- **Featured Results Management**
  - `GET /admin/features/entity-types` - List registered entity types that can be featured
  - `POST /admin/features/:entityType/:entityId/feature` - Feature an entity
  - `DELETE /admin/features/:entityType/:entityId/feature` - Remove feature status
  - `GET /admin/features/featured` - List featured items

#### 3.3.2 GraphQL Schema (Phase 2+)

```graphql
type Index {
  name: String!
  documentCount: Int!
  createdAt: DateTime!
  updatedAt: DateTime!
  configuration: IndexConfiguration!
}

type IndexConfiguration {
  searchableAttributes: [String!]!
  filterableAttributes: [String!]!
  sortableAttributes: [String!]!
  typoTolerance: TypoTolerance!
  pagination: PaginationConfig!
  vectorSearch: VectorSearchConfig
  geoSearch: GeoSearchConfig
  analyzers: [AnalyzerConfig!]!
}

type Document {
  id: ID!
  attributes: JSONObject!
  vector: [Float]
  location: GeoPoint
}

type SearchResult {
  hits: [SearchHit!]!
  totalHits: Int!
  processingTimeMs: Int!
  query: String!
  facets: [Facet!]
}

type SearchHit {
  id: ID!
  document: JSONObject!
  score: Float!
  highlights: [Highlight!]
  distance: Float
}

type Query {
  index(name: String!): Index
  indexes: [Index!]!
  document(indexName: String!, id: ID!): Document
  search(
    indexName: String!, 
    query: String!, 
    filters: JSONObject, 
    sort: [String!], 
    limit: Int, 
    offset: Int
  ): SearchResult!
  suggest(
    indexName: String!, 
    query: String!, 
    limit: Int
  ): [String!]!
  geoSearch(
    indexName: String!,
    query: String,
    latitude: Float!,
    longitude: Float!,
    radius: Float,
    limit: Int,
    offset: Int
  ): SearchResult!
}

type EnhancedSearchResult extends SearchResult {
  featuredCount: number;
  hits: EnhancedSearchHit[];
}

type EnhancedSearchHit extends SearchHit {
  featured: boolean;
  featureInfo: FeatureInfo;
}

type FeatureInfo {
  rank: number;
  keywords: [String!];
  categories: [String!];
}

# Additional type definitions...
```

### 3.4 Data Flow

```
┌───────────┐     ┌────────────┐     ┌──────────────┐
│           │     │            │     │              │
│  Source   │────▶│  Document  │────▶│ Text Analysis│
│  System   │     │  Processing│     │    Pipeline   │
│           │     │            │     │              │
└───────────┘     └────────────┘     └──────┬───────┘
                                           │
┌───────────┐     ┌────────────┐     ┌─────▼──────┐
│           │     │            │     │            │
│  API      │◀────│  Query     │◀────│  Indexing  │
│  Response │     │  Processing│     │  Engine    │
│           │     │            │     │            │
└───────────┘     └────────────┘     └────────────┘
```

## 4. Implementation Details

### 4.1 Search Algorithm

Ogini uses the Okapi BM25 algorithm for ranking documents:

```typescript
class BM25Scorer implements Scorer {
  // BM25 parameters
  private k1: number = 1.2;  // Term frequency saturation
  private b: number = 0.75;  // Document length normalization
  
  constructor(
    private readonly indexStats: IndexStats,
    private readonly fieldWeights: Record<string, number>
  ) {}
  
  score(
    query: ParsedQuery, 
    document: IndexedDocument, 
    termFrequencies: TermFrequencies
  ): number {
    let score = 0;
    
    for (const term of query.terms) {
      for (const [field, weight] of Object.entries(this.fieldWeights)) {
        if (!termFrequencies[term]?.[field]) continue;
        
        const tf = termFrequencies[term][field];
        const df = this.indexStats.documentFrequency(term, field);
        const avgdl = this.indexStats.averageFieldLength(field);
        const dl = document.fieldLength(field);
        
        // BM25 formula
        const idf = Math.log(
          (this.indexStats.documentCount - df + 0.5) / 
          (df + 0.5) + 1
        );
        
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (dl / avgdl));
        
        score += weight * idf * (numerator / denominator);
      }
    }
    
    return score;
  }
}
```

### 4.2 Analysis Pipeline

The analysis pipeline processes text for both indexing and querying:

```typescript
interface Analyzer {
  analyze(text: string): Token[];
}

interface Token {
  term: string;
  position: number;
  startOffset: number;
  endOffset: number;
  type: string;
  attributes?: Record<string, any>;
}

class AnalysisPipeline {
  private analyzers: Map<string, Analyzer> = new Map();
  
  constructor(
    private readonly tokenizers: Map<string, Tokenizer>,
    private readonly filters: Map<string, TokenFilter>
  ) {}
  
  registerAnalyzer(name: string, config: AnalyzerConfig): void {
    const tokenizer = this.tokenizers.get(config.tokenizer);
    if (!tokenizer) {
      throw new Error(`Tokenizer ${config.tokenizer} not found`);
    }
    
    const tokenFilters = config.filters.map(filterId => {
      const filter = this.filters.get(filterId);
      if (!filter) {
        throw new Error(`Token filter ${filterId} not found`);
      }
      return filter;
    });
    
    this.analyzers.set(name, new ChainAnalyzer(tokenizer, tokenFilters));
  }
  
  getAnalyzer(name: string): Analyzer {
    const analyzer = this.analyzers.get(name);
    if (!analyzer) {
      throw new Error(`Analyzer ${name} not found`);
    }
    return analyzer;
  }
}
```

### 4.3 Query Processing

```typescript
class QueryProcessor {
  constructor(
    private readonly analyzer: AnalysisPipeline,
    private readonly spellChecker?: SpellChecker,
    private readonly synonymExpander?: SynonymExpander
  ) {}

  processQuery(
    query: string,
    analyzerName: string,
    options: QueryOptions = {}
  ): ProcessedQuery {
    // Normalize and sanitize query
    const normalizedQuery = this.normalizeQuery(query);
    
    // Apply spell checking if enabled
    let correctedQuery = normalizedQuery;
    if (options.spellcheck && this.spellChecker) {
      correctedQuery = this.spellChecker.correct(normalizedQuery);
    }
    
    // Analyze query text
    const analyzer = this.analyzer.getAnalyzer(analyzerName);
    const tokens = analyzer.analyze(correctedQuery);
    
    // Extract phrases (terms in quotes)
    const phrases = this.extractPhrases(normalizedQuery);
    
    // Expand with synonyms if enabled
    let expandedTerms: string[] = tokens.map(t => t.term);
    if (options.synonyms && this.synonymExpander) {
      expandedTerms = this.synonymExpander.expand(expandedTerms);
    }
    
    return {
      original: query,
      normalized: normalizedQuery,
      corrected: correctedQuery !== normalizedQuery ? correctedQuery : undefined,
      tokens,
      terms: expandedTerms,
      phrases
    };
  }
  
  private normalizeQuery(query: string): string {
    // Basic normalization: trim, convert to lowercase, collapse whitespace
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  
  private extractPhrases(query: string): string[] {
    // Match text inside double quotes that doesn't contain double quotes
    const phraseRegex = /"([^"]*)"/g;
    const phrases: string[] = [];
    let match;
    
    while ((match = phraseRegex.exec(query)) !== null) {
      if (match[1].trim().length > 0) {
        phrases.push(match[1].trim());
      }
    }
    
    return phrases;
  }
}
```

## 5. Data Storage Strategy

### 5.1 Storage Technology Selection

Ogini uses a hybrid storage approach optimized for search workloads:

1. **Primary Index Store**: RocksDB
   - LSM-tree based storage for efficient writes and reads
   - Tuned for search index structures
   - Supports atomic updates and snapshots
   - Suitable for both single-node and distributed deployments

2. **Document Store**: MongoDB
   - Document-oriented storage that matches search document model
   - Flexible schema for varied document structures
   - Built-in sharding and replication
   - Good performance for document retrieval by ID

3. **In-Memory Layer**: Redis
   - Caching for frequent queries and hot documents
   - Pub/sub for distributed coordination
   - Sorted sets for real-time analytics

### 5.2 Schema Evolution Strategy

Ogini implements a versioned schema approach to handle evolving document structures:

```typescript
interface SchemaVersionManager {
  // Register a new schema version
  registerSchema(indexName: string, version: number, schema: IndexSchema): void;
  
  // Get all schema versions for an index
  getSchemaVersions(indexName: string): Map<number, IndexSchema>;
  
  // Get specific schema version
  getSchema(indexName: string, version: number): IndexSchema;
  
  // Get current schema version number
  getCurrentVersion(indexName: string): number;
  
  // Update current schema version
  setCurrentVersion(indexName: string, version: number): void;
}
```

The schema evolution process works as follows:

1. **Schema Registration**: New schemas are registered with version numbers
2. **Backward Compatibility**: New schemas must define transformation functions for older document versions
3. **Forward Migration**: Documents are migrated to new schema versions during indexing
4. **Query Adaptation**: Queries are adapted based on the schema version they target

```typescript
interface SchemaTransformation {
  // Transform document from prior version to current version
  forwardTransform(document: any, fromVersion: number, toVersion: number): any;
  
  // Transform document from current version to prior version (if needed)
  backwardTransform(document: any, fromVersion: number, toVersion: number): any;
  
  // Transform query to work with a specific document version
  transformQuery(query: any, queryVersion: number, documentVersion: number): any;
}
```

This approach allows:
- Adding new fields without reindexing
- Renaming fields with aliasing
- Changing field types with transformation functions
- Removing fields with graceful degradation

Example schema evolution:

```typescript
// Original schema (v1)
registerSchema('products', 1, {
  mappings: {
    name: { type: 'text', analyzer: 'standard' },
    price: { type: 'number' },
    description: { type: 'text', analyzer: 'english' }
  }
});

// Updated schema (v2) with new fields and renamed fields
registerSchema('products', 2, {
  mappings: {
    name: { type: 'text', analyzer: 'standard' },
    price: { type: 'number' },
    description: { type: 'text', analyzer: 'english' },
    // New field
    category: { type: 'keyword' },
    // Renamed field (was 'description')
    productDescription: { type: 'text', analyzer: 'english' }
  },
  transformations: {
    forwardTransform: (doc, fromVersion, toVersion) => {
      if (fromVersion === 1 && toVersion === 2) {
        // Copy description to productDescription
        doc.productDescription = doc.description;
        return doc;
      }
      return doc;
    },
    transformQuery: (query, queryVersion, docVersion) => {
      if (queryVersion === 2 && docVersion === 1) {
        // Replace productDescription with description in query
        if (query.filters?.productDescription) {
          query.filters.description = query.filters.productDescription;
          delete query.filters.productDescription;
        }
        return query;
      }
      return query;
    }
  }
});
```

### 5.3 Consistency Model

Ogini provides clear consistency guarantees:

1. **Single-Node Consistency**:
   - Read-after-write consistency for document operations
   - Atomic updates for individual documents
   - ACID transactions for multi-document operations within an index

2. **Multi-Node Consistency**:
   - Eventually consistent by default
   - Configurable consistency levels for reads:
     - `local`: Read from local node only (fastest, may be stale)
     - `majority`: Read from majority of nodes (balanced)
     - `all`: Read from all nodes (slowest, most consistent)
   - Write acknowledgement options:
     - `ack`: Acknowledged when primary receives
     - `majority`: Acknowledged when majority replicate
     - `fsync`: Acknowledged when persisted to disk

```typescript
interface ConsistencyOptions {
  readConsistency: 'local' | 'majority' | 'all';
  writeAcknowledgement: 'ack' | 'majority' | 'fsync';
  timeout: number; // milliseconds
}

// Usage in search request
const results = await searchClient.search('products', {
  query: 'smartphone',
  consistency: {
    readConsistency: 'majority',
    timeout: 1000
  }
});
```

### 5.4 Data Durability and Recovery

Ogini ensures data durability through:

1. **Write-Ahead Logging (WAL)**:
   - All index updates are first written to WAL
   - WAL is synced to disk before acknowledging writes
   - Automatic recovery from WAL after crashes

2. **Periodic Snapshots**:
   - Point-in-time consistent snapshots of indices
   - Configurable snapshot frequency
   - Incremental snapshots for efficiency

3. **Backup Strategy**:
   - Full backups: Complete index and document store
   - Incremental backups: Changes since last backup
   - Logical backups: Schema-aware exports
   - Physical backups: Raw storage files

```typescript
interface BackupOptions {
  type: 'full' | 'incremental' | 'logical';
  destination: string;
  retention: {
    count: number;
    days: number;
  };
  compress: boolean;
  encrypted: boolean;
  encryptionKey?: string;
}

interface RestoreOptions {
  backupId: string;
  targetIndexName?: string; // For restoring to different index
  pointInTime?: Date; // For time-travel queries
}
```

## 6. Operational Architecture

### 6.1 Deployment Options

#### 6.1.1 Single Instance Deployment

For small to medium workloads:

```
┌─────────────────────────────────┐
│         Single Instance         │
│                                 │
│   ┌─────────┐    ┌─────────┐   │
│   │  API    │    │  Search │   │
│   │  Server │    │  Engine │   │
│   └────┬────┘    └────┬────┘   │
│        │              │        │
│   ┌────▼────────────▼────┐     │
│   │       Storage        │     │
│   └─────────────────────┘      │
└─────────────────────────────────┘
```

#### 6.1.2 Distributed Deployment

For larger workloads with horizontal scaling:

```
┌─────────────────────────────────┐
│        Load Balancer            │
└──────────────┬──────────────────┘
               │
     ┌─────────▼─────────┐
     │                   │
┌────▼───┐         ┌────▼───┐
│  API   │         │  API   │
│ Server │         │ Server │
└────┬───┘         └────┬───┘
     │                  │
     └──────┬───────────┘
            │
┌───────────▼────────────┐
│    Service Discovery   │
└───────────┬────────────┘
            │
    ┌───────▼────────┐
    │                │
┌───▼──┐        ┌────▼─┐
│Search│        │Search│
│Node 1│        │Node 2│
└───┬──┘        └───┬──┘
    │               │
┌───▼───┐       ┌───▼───┐
│Storage│       │Storage│
│Shard 1│       │Shard 2│
└───────┘       └───────┘
```

#### 6.1.3 Containerized Deployment

Docker Compose example for local development:

```yaml
version: '3.8'
services:
  ogini:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - STORAGE_TYPE=mongodb
      - MONGODB_URI=mongodb://mongo:27017/ogini
    depends_on:
      - mongo
    volumes:
      - app-data:/app/data
      
  mongo:
    image: mongo:5.0
    volumes:
      - mongo-data:/data/db
      
volumes:
  app-data:
  mongo-data:
```

Kubernetes deployment example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ogini
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ogini
  template:
    metadata:
      labels:
        app: ogini
    spec:
      containers:
      - name: ogini
        image: ogini:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: STORAGE_TYPE
          value: "mongodb"
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: ogini-secrets
              key: mongodb-uri
        resources:
          limits:
            cpu: "1"
            memory: "1Gi"
          requests:
            cpu: "500m"
            memory: "512Mi"
```

### 6.2 Monitoring and Alerting

Ogini includes comprehensive monitoring endpoints:

```typescript
@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly healthService: HealthService,
    private readonly metricsService: MetricsService
  ) {}
  
  @Get('health')
  @ApiOperation({ summary: 'Get service health status' })
  async getHealth(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
  
  @Get('metrics')
  @ApiOperation({ summary: 'Get service metrics' })
  async getMetrics(): Promise<Metrics> {
    return this.metricsService.getMetrics();
  }
}
```

Key metrics exposed:

- Query latency (p50, p95, p99)
- Query throughput
- Index size and document count
- Cache hit/miss ratio
- Error rate
- Resource utilization

### 6.3 Disaster Recovery

Ogini supports multiple disaster recovery strategies:

1. **Snapshot restoration**: Recover from point-in-time backup
2. **Standby replicas**: Maintain read replicas for failover
3. **Cross-region deployment**: Geographically distributed resilience

Recovery Time Objective (RTO): < 5 minutes
Recovery Point Objective (RPO): < 1 minute with continuous replication

## 7. Security Framework

### 7.1 Authentication and Authorization

Ogini uses a multi-layered security approach:

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}
  
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);
    
    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }
    
    // Validate API key
    const apiKeyEntity = await this.authService.validateApiKey(apiKey);
    if (!apiKeyEntity) {
      throw new UnauthorizedException('Invalid API key');
    }
    
    // Check permissions
    const resource = this.getResourceFromRequest(request);
    const action = this.getActionFromRequest(request);
    
    const hasPermission = await this.authService.checkPermission(
      apiKeyEntity,
      resource,
      action
    );
    
    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }
    
    // Attach auth info to request
    request.auth = {
      apiKey: apiKeyEntity,
      tenantId: apiKeyEntity.tenantId
    };
    
    return true;
  }
  
  private extractApiKey(request: Request): string | undefined {
    // Implementation details...
  }
  
  private getResourceFromRequest(request: Request): string {
    // Implementation details...
  }
  
  private getActionFromRequest(request: Request): string {
    // Implementation details...
  }
}
```

### 7.2 Data Security

Ogini ensures data security through:

1. **Encryption at rest**: Sensitive data encrypted in storage
2. **Encryption in transit**: TLS for all API connections
3. **Data isolation**: Strict tenant separation
4. **Field-level security**: Control access to specific document fields

```typescript
interface DocumentSecurityPolicy {
  // Define which fields are accessible to which roles
  fieldVisibility: Record<string, string[]>;
  
  // Define conditions for document access
  accessConditions: FilterCondition[];
  
  // Apply security policy to documents
  applyPolicy(documents: any[], userRoles: string[]): any[];
}
```

### 7.3 Audit Logging

Security-relevant operations are logged for compliance:

```typescript
@Injectable()
export class AuditLogger {
  constructor(
    @Inject(Logger) private readonly logger: LoggerService,
    private readonly configService: ConfigService
  ) {}
  
  logAction(
    action: AuditAction,
    resource: string,
    metadata: AuditMetadata,
    outcome: 'success' | 'failure',
    error?: string
  ): void {
    const logLevel = outcome === 'success' ? 'log' : 'warn';
    
    const auditRecord = {
      timestamp: new Date().toISOString(),
      action,
      resource,
      user: metadata.user,
      tenantId: metadata.tenantId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      outcome,
      error,
      details: metadata.details
    };
    
    this.logger[logLevel]('Audit record', auditRecord);
    
    // If audit persistence is enabled, also save to storage
    if (this.configService.get('audit.persistence.enabled')) {
      this.persistAuditRecord(auditRecord);
    }
  }
  
  private async persistAuditRecord(record: AuditRecord): Promise<void> {
    // Implementation details...
  }
}
```

## 8. Performance Optimization

### 8.1 Performance Targets

| Metric | Target | Method |
|--------|--------|--------|
| Query latency (p95) | < 50ms | Query optimization, caching, indexing |
| Indexing throughput | > 1000 docs/sec | Batching, async processing |
| Storage efficiency | < 2x original data | Compression, field selection |
| Cache hit ratio | > 80% | Adaptive caching strategies |
| Max documents per node | 10M | Sharding, resource allocation |

### 8.2 Optimization Techniques

#### 8.2.1 Query Optimization

```typescript
class QueryOptimizer {
  optimize(query: ParsedQuery): OptimizedQuery {
    // Identify high-selectivity terms
    const termStats = this.analyzeTermSelectivity(query.terms);
    
    // Order terms by selectivity for early termination
    const orderedTerms = this.orderBySelectivity(query.terms, termStats);
    
    // Identify phrases for exact matching
    const phrases = query.phrases;
    
    // Group related terms
    const termGroups = this.groupRelatedTerms(orderedTerms);
    
    return {
      ...query,
      optimizedTerms: orderedTerms,
      termGroups,
      executionPlan: this.createExecutionPlan(orderedTerms, phrases, termGroups)
    };
  }
  
  // Implementation details...
}
```

#### 8.2.2 Index Compression

```typescript
class IndexCompressor {
  compressPostings(postings: Posting[]): Buffer {
    // Variable byte encoding for document IDs
    const docIds = this.encodeVariableByte(
      postings.map(p => p.documentId)
    );
    
    // Delta encoding for positions
    const positions = postings.flatMap(p => {
      const deltas = this.encodeDelta(p.positions);
      return [p.positions.length, ...deltas];
    });
    
    // Pack frequencies
    const frequencies = postings.map(p => p.frequency);
    
    // Compress combined data
    return this.compressCombined([docIds, positions, frequencies]);
  }
  
  // Implementation details...
}
```

#### 8.2.3 Adaptive Caching

```typescript
class AdaptiveCacheManager {
  constructor(
    private readonly maxMemory: number,
    private readonly stats: CacheStatistics
  ) {}
  
  optimizeAllocation(): void {
    // Analyze query patterns
    const patterns = this.stats.getQueryPatterns();
    
    // Identify hot queries
    const hotQueries = this.stats.getHotQueries();
    
    // Adjust TTLs based on access frequency
    for (const [query, frequency] of Object.entries(hotQueries)) {
      const ttl = this.calculateOptimalTtl(frequency);
      this.cache.setTtl(query, ttl);
    }
    
    // Adjust memory allocation between result cache and term dictionary
    const queryHitRatio = this.stats.getQueryHitRatio();
    const termHitRatio = this.stats.getTermHitRatio();
    
    if (queryHitRatio > termHitRatio) {
      // Allocate more to result cache
      this.reallocateMemory(0.7, 0.3);
    } else {
      // Allocate more to term dictionary
      this.reallocateMemory(0.3, 0.7);
    }
  }
  
  // Implementation details...
}
```

## 9. Testing Strategy

### 9.1 Testing Philosophy

Ogini follows a comprehensive testing approach with emphasis on:

- **Correctness**: Ensuring search results match expectations
- **Performance**: Verifying system meets latency and throughput targets
- **Resilience**: Validating system behavior under failure conditions
- **Scalability**: Testing behavior as data volume and query load increase

### 9.2 Testing Layers

#### 9.2.1 Unit Tests

Testing individual components in isolation:

```typescript
// src/search/services/search.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { createConnection, getConnection } from 'typeorm';
import { DocumentRepository } from '../repositories/document.repository';

describe('SearchService', () => {
  let service: SearchService;
  let repository: DocumentRepository;

  beforeAll(async () => {
    // Set up in-memory SQLite for testing
    await createConnection({
      type: 'sqlite',
      database: ':memory:',
      dropSchema: true,
      entities: [/* test entities */],
      synchronize: true,
      logging: false
    });
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: DocumentRepository,
          useClass: MockDocumentRepository,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    repository = module.get<DocumentRepository>(DocumentRepository);
  });

  it('should perform basic search', async () => {
    // Arrange
    jest.spyOn(repository, 'search').mockResolvedValue([
      { id: '1', content: 'test document' }
    ]);

    // Act
    const results = await service.search('test');

    // Assert
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(repository.search).toHaveBeenCalledWith('test', expect.any(Object));
  });

  // More tests...
});
```

#### 9.2.2 Integration Tests

Testing component interactions with MongoDB for document tests:

```typescript
// src/test/search.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { AppModule } from '../app.module';

describe('Search API (integration)', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;
  let dbConnection: Connection;

  beforeAll(async () => {
    // Set up MongoDB memory server
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongoServer.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    // Setup test data
    dbConnection = moduleFixture.get('DATABASE_CONNECTION');
    await seedTestData(dbConnection);
  });

  afterAll(async () => {
    await app.close();
    await mongoServer.stop();
  });

  it('should search documents', () => {
    return request(app.getHttpServer())
      .post('/indexes/test/search')
      .send({ query: 'example' })
      .expect(200)
      .then(response => {
        expect(response.body.hits).toBeDefined();
        expect(response.body.hits.length).toBeGreaterThan(0);
        expect(response.body.totalHits).toBeGreaterThan(0);
      });
  });

  // More tests...
});
```

#### 9.2.3 End-to-End Tests

Testing complete search flows with real infrastructure:

```typescript
// e2e/search-flows.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Search Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/search');
  });

  test('should display search results', async ({ page }) => {
    // Type into search box
    await page.fill('[data-testid="search-input"]', 'example');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results to load
    await page.waitForSelector('[data-testid="search-results"]');
    
    // Verify results
    const resultCount = await page.locator('[data-testid="result-item"]').count();
    expect(resultCount).toBeGreaterThan(0);
    
    // Verify result content
    const firstResultText = await page.textContent('[data-testid="result-item"]:first-child');
    expect(firstResultText).toContain('example');
  });

  // More E2E tests...
});
```

### 9.3 Resilience Testing with Chaos Engineering

Ogini includes chaos engineering practices to verify system resilience:

```typescript
// chaos/network-partition.spec.ts
import { ChaosMesh } from '@chaos-mesh/client';
import { SearchClient } from '../src/client';
import { setupTestCluster, cleanupTestCluster } from './utils/cluster';

describe('Network Partition Tests', () => {
  let chaosMesh: ChaosMesh;
  let searchClient: SearchClient;
  let clusterInfo: any;
  
  beforeAll(async () => {
    // Set up a test cluster with multiple nodes
    clusterInfo = await setupTestCluster({
      nodes: 3,
      replicationFactor: 2
    });
    
    searchClient = new SearchClient({
      endpoints: clusterInfo.endpoints,
      apiKey: clusterInfo.apiKey
    });
    
    chaosMesh = new ChaosMesh({
      endpoint: process.env.CHAOS_MESH_ENDPOINT
    });
  });
  
  afterAll(async () => {
    await cleanupTestCluster(clusterInfo);
  });
  
  it('should continue serving reads during network partition', async () => {
    // Create a partition between nodes
    const partition = await chaosMesh.createNetworkPartition({
      source: [`${clusterInfo.podPrefix}-0`],
      target: [`${clusterInfo.podPrefix}-1`, `${clusterInfo.podPrefix}-2`],
      duration: '30s'
    });
    
    try {
      // Perform searches during the partition
      for (let i = 0; i < 10; i++) {
        const results = await searchClient.search('test-index', {
          query: 'resilience test',
          // Use local consistency to ensure reads work
          consistency: { readConsistency: 'local' }
        });
        
        // Validate results
        expect(results.hits.length).toBeGreaterThan(0);
        
        await new Promise(r => setTimeout(r, 1000));
      }
    } finally {
      // Clean up the chaos experiment
      await chaosMesh.deleteNetworkPartition(partition.name);
    }
  });
  
  it('should recover and resync after network partition heals', async () => {
    // Create a partition between nodes
    const partition = await chaosMesh.createNetworkPartition({
      source: [`${clusterInfo.podPrefix}-0`],
      target: [`${clusterInfo.podPrefix}-1`, `${clusterInfo.podPrefix}-2`],
      duration: '30s'
    });
    
    // Add documents to isolated node
    const testDocs = generateTestDocuments(10);
    await searchClient.addDocuments('test-index', testDocs, {
      // Force documents to be sent to the isolated node
      nodeSelector: clusterInfo.nodes[0].id
    });
    
    // Wait for partition to heal (plus some buffer)
    await new Promise(r => setTimeout(r, 40 * 1000));
    
    // Verify documents are available from all nodes
    for (const node of clusterInfo.nodes) {
      const results = await searchClient.search('test-index', {
        query: testDocs[0].title,
        nodeSelector: node.id
      });
      
      expect(results.hits.length).toBeGreaterThan(0);
      expect(results.hits[0].id).toBe(testDocs[0].id);
    }
  });
});
```

### 9.4 Circuit Breaker Implementation

Ogini implements circuit breakers to handle dependency failures gracefully:

```typescript
// src/common/circuit-breaker.ts
import { Injectable } from '@nestjs/common';

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  fallbackFn?: (...args: any[]) => any;
}

enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN
}

@Injectable()
export class CircuitBreaker {
  private circuits: Map<string, Circuit> = new Map();
  
  register(name: string, options: CircuitBreakerOptions): void {
    this.circuits.set(name, {
      name,
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastFailure: null,
      options
    });
  }
  
  async execute<T>(
    circuitName: string,
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    const circuit = this.circuits.get(circuitName);
    
    if (!circuit) {
      throw new Error(`Circuit ${circuitName} not registered`);
    }
    
    // Check if circuit is open
    if (circuit.state === CircuitState.OPEN) {
      const now = Date.now();
      
      // Check if reset timeout has elapsed
      if (circuit.lastFailure && now - circuit.lastFailure > circuit.options.resetTimeout) {
        circuit.state = CircuitState.HALF_OPEN;
      } else {
        return this.handleOpenCircuit(circuit, args);
      }
    }
    
    try {
      // Execute the function
      const result = await fn(...args);
      
      // Reset on success if half-open
      if (circuit.state === CircuitState.HALF_OPEN) {
        this.resetCircuit(circuit);
      }
      
      return result;
    } catch (error) {
      return this.handleFailure(circuit, error, args);
    }
  }
  
  private resetCircuit(circuit: Circuit): void {
    circuit.state = CircuitState.CLOSED;
    circuit.failureCount = 0;
    circuit.lastFailure = null;
  }
  
  private handleFailure(circuit: Circuit, error: Error, args: any[]): any {
    circuit.failureCount++;
    circuit.lastFailure = Date.now();
    
    // Open circuit if failure threshold reached
    if (circuit.failureCount >= circuit.options.failureThreshold) {
      circuit.state = CircuitState.OPEN;
    }
    
    return this.handleOpenCircuit(circuit, args);
  }
  
  private handleOpenCircuit(circuit: Circuit, args: any[]): any {
    if (circuit.options.fallbackFn) {
      return circuit.options.fallbackFn(...args);
    }
    
    throw new Error(`Circuit ${circuit.name} is open`);
  }
}

interface Circuit {
  name: string;
  state: CircuitState;
  failureCount: number;
  lastFailure: number | null;
  options: CircuitBreakerOptions;
}
```

### 9.5 Performance Benchmarking

Ogini includes a comprehensive benchmark suite to evaluate performance against comparable systems:

#### 9.5.1 Benchmark Methodology

1. **Standard Test Datasets**:
   - MSMARCO Passage Ranking (for text search)
   - Common Crawl sample (for web content)
   - E-commerce product catalog (250K products with attributes)
   - Wikipedia articles (1M documents)

2. **Benchmark Metrics**:
   - Query latency (p50, p95, p99)
   - Query throughput (QPS)
   - Indexing speed (docs/second)
   - Index size ratio (vs. raw data)
   - Memory usage
   - CPU utilization

3. **Comparison Systems**:
   - Elasticsearch (as enterprise baseline)
   - Meilisearch (as lightweight comparison)
   - PostgreSQL with pg_trgm (as SQL baseline)

```typescript
// benchmark/query-performance.bench.ts
import { Benchmark } from '@influxdata/influxdb-client';
import { SearchClient } from '../src/client';
import {
  MeiliSearchClient,
  ElasticsearchClient,
  PostgresClient
} from './clients';
import { loadQuerySets } from './datasets';

async function runBenchmark() {
  // Set up clients
  const oginiSearch = new SearchClient({ /* config */ });
  const meilisearch = new MeiliSearchClient({ /* config */ });
  const elasticsearch = new ElasticsearchClient({ /* config */ });
  const postgres = new PostgresClient({ /* config */ });
  
  // Load test queries
  const { simpleQueries, complexQueries, facetedQueries } = await loadQuerySets();
  
  // Configure benchmark
  const bench = new Benchmark({
    iterations: 100,
    warmup: 10,
    teardown: async () => {
      // Clean up resources
    }
  });
  
  // Register test cases
  bench.add('ogini-simple', async () => {
    await Promise.all(simpleQueries.map(q => 
      oginiSearch.search('benchmark-index', { query: q })
    ));
  });
  
  bench.add('meilisearch-simple', async () => {
    await Promise.all(simpleQueries.map(q => 
      meilisearch.search('benchmark-index', { q })
    ));
  });
  
  bench.add('elasticsearch-simple', async () => {
    await Promise.all(simpleQueries.map(q => 
      elasticsearch.search({
        index: 'benchmark-index',
        body: { query: { match: { content: q } } }
      })
    ));
  });
  
  bench.add('postgres-simple', async () => {
    await Promise.all(simpleQueries.map(q => 
      postgres.query(
        'SELECT * FROM documents WHERE content @@ to_tsquery($1) LIMIT 10',
        [q]
      )
    ));
  });
  
  // Add more test cases for complex and faceted queries
  
  // Run benchmark
  await bench.run();
  
  // Generate report
  const report = bench.report();
  console.table(report.summary);
  
  // Export results
  await report.exportTo('csv', './benchmark-results.csv');
}

runBenchmark().catch(console.error);
```

## 10. Roadmap

### 10.1 Phase 1: Core Experience (Months 1-3)

**Focus: Exceptional developer experience with limited but polished core features**

- Simple yet effective search functionality with BM25 algorithm
- Single-node architecture with clean persistence layer
- REST API with comprehensive Swagger documentation
- Streamlined document processing pipeline
- First-class TypeScript client library with perfect type definitions
- Simplified Docker deployment
- Basic text analysis with tokenization and stemming
- Core unit and integration testing
- Extremely thorough developer documentation with interactive examples

**Guiding Principles:**
- Developer experience over feature breadth
- Operational simplicity over distributed scaling
- Excellent documentation over complex capabilities
- Core relevance quality over advanced customization

### 10.2 Phase 2: Search Enhancement (Months 4-6)

- Advanced text analysis (synonyms, normalization)
- Typo tolerance with n-gram matching
- Faceted search capabilities
- Basic relevance tuning controls
- Additional client libraries (PHP/Laravel, Python)
- Structured query syntax
- Improved monitoring and metrics
- Performance optimization
- Adaptable featured search for any entity type

### 10.3 Phase 3: Scale and Flexibility (Months 7-9)

- Multi-node capability with basic sharding
- GraphQL API
- Webhook integration
- Analytics dashboard
- Basic vector search support
- Simplified geospatial search
- Enhanced security features
- Advanced caching strategies

### 10.4 Phase 4: Enterprise and Advanced Features (Months 10-12)

- Full distributed architecture
- Advanced relevance tuning
- Complex multilingual support
- Cross-index operations
- A/B testing framework
- Advanced vector search capabilities
- Full-featured geospatial search
- Enterprise security features

## 11. Success Metrics

- Query performance (p95 < 50ms at defined scale)
- Indexing performance (> 1000 documents/second)
- Developer adoption (number of active instances)
- API uptime (> 99.9%)
- Search relevance (NDCG > 0.85, MAP > 0.8)
- Test coverage (> 85% code coverage)
- Documentation completeness (all features documented with examples)

## 12. Glossary

- **BM25**: A ranking function used to rank documents based on term frequency and inverse document frequency
- **Index**: A data structure that enables fast search operations
- **Document**: A record containing fields that can be searched
- **Tokenization**: The process of breaking text into individual tokens
- **Posting List**: A list of documents containing a specific term
- **Shard**: A horizontal partition of data in an index
- **NDCG**: Normalized Discounted Cumulative Gain, a measure of search quality
- **MAP**: Mean Average Precision, a measure of search accuracy
- **Vector Search**: Search based on semantic similarity using vector embeddings