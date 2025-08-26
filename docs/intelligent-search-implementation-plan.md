# Intelligent Search Implementation Plan for Ogini

## Overview
This document outlines the implementation plan for adding intelligent search capabilities to our existing PostgreSQL-based search engine. The plan focuses on enhancing query understanding, semantic search, and advanced ranking while maintaining our current 200ms response times and leveraging existing worker threads for parallel processing.

## Current Architecture Analysis

### Existing Strengths
- PostgreSQL full-text search with BM25 scoring
- Worker thread architecture for parallel processing
- Redis caching layer
- Generic index-agnostic design
- 200ms response times achieved

### Integration Points
- `QueryProcessorService` - Enhanced with entity extraction
- `PostgreSQLSearchEngine` - Hybrid search capabilities
- Worker threads - Parallel query processing and embedding generation
- Existing caching - Multi-layer result caching

## Phase 1: Query Intelligence (Weeks 1-2)

### Goal
Handle contextual queries like "restaurants near me" → "restaurant" + location filtering

### Core Components

#### 1. Enhanced Query Processing
```typescript
interface QueryComponents {
  original: string;
  normalized: string;
  entities: {
    businessTypes: string[];
    locations: string[];
    services: string[];
    modifiers: string[]; // "near", "close to", "best", "cheap"
  };
  intent: 'informational' | 'transactional' | 'navigational';
  expanded: string;
  locationContext?: LocationContext;
}
```

#### 2. Entity Recognition System
- **Business Types**: restaurant, hotel, clinic, shop, bank, etc.
- **Location References**: "near me", "close to", "in [city]", coordinates
- **Service Keywords**: delivery, takeout, 24/7, emergency
- **Modifiers**: best, cheap, expensive, popular, new

#### 3. Query Expansion
- Synonyms mapping (restaurant → food, dining, eatery)
- Related terms (pizza → Italian, delivery, takeout)
- Intent-based expansion (informational vs transactional)

### Worker Thread Integration for Phase 1

#### Parallel Entity Extraction
```typescript
// Use worker threads for parallel entity processing
const entityWorkers = new WorkerPool(4); // 4 workers for entity extraction

// Parallel processing of different entity types
const [businessTypes, locations, services] = await Promise.all([
  entityWorkers.execute('extractBusinessTypes', query),
  entityWorkers.execute('extractLocationReferences', query),
  entityWorkers.execute('extractServiceKeywords', query)
]);
```

#### Background Query Analysis
- Pre-process common query patterns
- Cache entity extraction results
- Update synonym mappings in background

### Implementation Tasks

#### Task 1.1: Enhanced QueryProcessorService
- [ ] Add entity extraction methods
- [ ] Implement intent classification
- [ ] Add query expansion with synonyms
- [ ] Integrate with worker threads for parallel processing

#### Task 1.2: Location Processing Service
- [ ] Create LocationProcessorService
- [ ] Implement location reference parsing
- [ ] Add geographic radius calculations
- [ ] Handle coordinate-based queries

#### Task 1.3: Business-Specific Enhancements
- [ ] Business type recognition (restaurant, hotel, etc.)
- [ ] Service keyword extraction
- [ ] Modifier processing (best, cheap, etc.)
- [ ] Category-based query expansion

## Phase 2: Semantic Search (Weeks 3-4)

### Goal
Add semantic understanding without changing core architecture

### Core Components

#### 1. pgvector Integration
- Add pgvector extension to PostgreSQL
- Generate embeddings for document content
- Implement vector similarity search

#### 2. Hybrid Search Architecture
- Combine keyword and semantic search results
- Reciprocal Rank Fusion (RRF) for result combination
- Weighted scoring based on query complexity

#### 3. Embedding Generation Pipeline
- Background worker for embedding generation
- Batch processing for existing documents
- Real-time embedding for new documents

### Worker Thread Integration for Phase 2

#### Parallel Embedding Generation
```typescript
// Use worker threads for embedding generation
const embeddingWorkers = new WorkerPool(2); // 2 workers for ML tasks

// Parallel embedding generation for different content types
const [titleEmbedding, descriptionEmbedding] = await Promise.all([
  embeddingWorkers.execute('generateEmbedding', document.title),
  embeddingWorkers.execute('generateEmbedding', document.description)
]);
```

#### Background Index Updates
- Process embedding updates in background
- Batch vector operations
- Cache frequently accessed embeddings

### Implementation Tasks

#### Task 2.1: pgvector Setup
- [ ] Add pgvector extension to PostgreSQL
- [ ] Create embedding storage tables
- [ ] Implement vector similarity functions
- [ ] Add migration scripts

#### Task 2.2: Embedding Generation
- [ ] Create EmbeddingService
- [ ] Implement sentence transformer integration
- [ ] Add background worker for embedding generation
- [ ] Batch processing for existing documents

#### Task 2.3: Hybrid Search Engine
- [ ] Enhance PostgreSQLSearchEngine with semantic search
- [ ] Implement RRF result combination
- [ ] Add query complexity detection
- [ ] Performance optimization for hybrid queries

## Phase 3: Advanced Ranking (Weeks 5-6)

### Goal
Multi-signal ranking with location, freshness, and business-specific factors

### Core Components

#### 1. Multi-Signal Scoring
- Text relevance (existing BM25)
- Semantic similarity (new)
- Location proximity (new)
- Content freshness (new)
- Business popularity (new)

#### 2. Dynamic Weight Adjustment
- Query-aware weight distribution
- User preference learning
- A/B testing framework
- Performance monitoring

#### 3. Real-time Ranking Updates
- Background popularity scoring
- Freshness decay calculations
- Location-based adjustments

### Worker Thread Integration for Phase 3

#### Parallel Score Calculation
```typescript
// Use worker threads for parallel score calculation
const scoringWorkers = new WorkerPool(3); // 3 workers for different scoring types

// Parallel calculation of different score components
const [textScore, semanticScore, locationScore] = await Promise.all([
  scoringWorkers.execute('calculateTextScore', { document, query }),
  scoringWorkers.execute('calculateSemanticScore', { document, query }),
  scoringWorkers.execute('calculateLocationScore', { document, userLocation })
]);
```

#### Background Ranking Updates
- Update popularity scores in background
- Process freshness decay
- Maintain ranking caches

### Implementation Tasks

#### Task 3.1: Enhanced Scoring System
- [ ] Implement multi-signal scoring
- [ ] Add location-based ranking
- [ ] Create freshness scoring
- [ ] Integrate business popularity metrics

#### Task 3.2: Dynamic Weight Management
- [ ] Create WeightManagerService
- [ ] Implement query-aware weight distribution
- [ ] Add A/B testing framework
- [ ] Performance monitoring integration

#### Task 3.3: Real-time Updates
- [ ] Background popularity tracking
- [ ] Freshness decay calculations
- [ ] Location-based adjustments
- [ ] Cache invalidation strategies

## Performance Considerations

### Worker Thread Strategy
1. **Entity Extraction**: 4 workers for parallel processing
2. **Embedding Generation**: 2 workers for ML tasks
3. **Score Calculation**: 3 workers for different scoring types
4. **Background Tasks**: 2 workers for maintenance tasks

### Caching Strategy
1. **Query Results**: Redis with 5-minute TTL
2. **Entity Extraction**: Redis with 1-hour TTL
3. **Embeddings**: PostgreSQL with materialized views
4. **Ranking Scores**: Redis with 30-minute TTL

### Performance Targets
- Maintain 200ms response times
- 95% cache hit rate for common queries
- Sub-50ms entity extraction
- Sub-100ms semantic search
- Sub-150ms hybrid search

## Implementation Guidelines

### Code Organization
- Keep existing architecture intact
- Add new services as modules
- Use dependency injection for new components
- Maintain generic index-agnostic design

### Testing Strategy
- Unit tests for each new service
- Integration tests for hybrid search
- Performance benchmarks for each phase
- A/B testing for ranking improvements

### Deployment Strategy
- Phase-by-phase deployment
- Feature flags for gradual rollout
- Rollback capabilities for each phase
- Monitoring and alerting for each component

## Success Metrics

### Phase 1 Success Criteria
- Handle "restaurants near me" queries correctly
- Entity extraction accuracy > 90%
- Query expansion improves recall by 15%
- Maintain 200ms response times

### Phase 2 Success Criteria
- Semantic search improves precision by 20%
- Hybrid search maintains 200ms response times
- Embedding generation < 100ms per document
- 95% cache hit rate for embeddings

### Phase 3 Success Criteria
- Multi-signal ranking improves relevance by 25%
- Dynamic weight adjustment improves user satisfaction
- Background updates complete within 5 minutes
- Overall search quality score > 0.85

## Risk Mitigation

### Technical Risks
- **Performance degradation**: Implement performance monitoring and rollback
- **Worker thread overhead**: Monitor CPU usage and adjust worker count
- **Embedding generation cost**: Implement lazy loading and caching
- **Database load**: Use read replicas and connection pooling

### Business Risks
- **User experience disruption**: Gradual rollout with feature flags
- **Data consistency**: Implement proper transaction handling
- **Scalability concerns**: Monitor resource usage and plan scaling
- **Maintenance overhead**: Automate background tasks and monitoring

## Next Steps

1. **Immediate**: Start Phase 1 implementation
2. **Week 1**: Complete entity extraction and location processing
3. **Week 2**: Implement query expansion and worker thread integration
4. **Week 3**: Begin Phase 2 with pgvector setup
5. **Week 4**: Complete hybrid search implementation
6. **Week 5**: Start Phase 3 with multi-signal scoring
7. **Week 6**: Complete advanced ranking system

This plan provides a structured approach to implementing intelligent search while maintaining our current performance and leveraging existing infrastructure. 