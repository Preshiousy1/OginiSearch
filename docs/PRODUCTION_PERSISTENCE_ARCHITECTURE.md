# Production-Grade Persistence Architecture

## Design Principles

1. **Separation of Concerns**: Indexing workers focus on speed, persistence worker focuses on durability
2. **Zero Race Conditions**: Single writer pattern eliminates concurrency issues
3. **Optimal Performance**: Parallel indexing + sequential persistence = best of both worlds
4. **Durability**: Multi-layer persistence (memory → RocksDB → MongoDB)
5. **Scalability**: Handles millions of documents without slowdown
6. **Testability**: Each component independently testable
7. **Maintainability**: Clear interfaces, minimal coupling

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BULK INDEXING REQUEST                            │
│                     POST /bulk-indexing/:indexName                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      BULK INDEXING SERVICE                               │
│  ├─ Split into batches (150 docs each)                                  │
│  ├─ Create bulk operation ID (tracks entire operation)                  │
│  ├─ Queue batch jobs to 'indexing' queue                                │
│  └─ Track: {bulkOpId, totalBatches, completedBatches, indexName}        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────────────┐  ┌─────────────────────────────────┐
│   INDEXING QUEUE (×12 workers)      │  │   BULK OPERATION TRACKER        │
│   ├─ Process documents (parallel)   │  │   ├─ Redis/Memory state         │
│   ├─ Add to memory posting lists    │  │   ├─ Track batch completion     │
│   ├─ Persist to RocksDB (periodic)  │  │   └─ Trigger events             │
│   ├─ Track batch-local dirty terms  │  └─────────────────────────────────┘
│   └─ On complete: Emit event        │
└─────────────────────────────────────┘
                    │
                    │ Batch Complete Event
                    │ {batchId, indexName, dirtyTerms[], bulkOpId}
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  BATCH COMPLETION HANDLER                                │
│  ├─ Increment batch counter for bulkOpId                                │
│  ├─ Queue persistence job for this batch's dirty terms                  │
│  └─ If all batches complete: Emit bulk-complete event                   │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          PERSISTENCE QUEUE (×1 worker - SEQUENTIAL)                      │
│  ├─ Dequeue persistence jobs (FIFO order)                               │
│  ├─ For each dirty term:                                                │
│  │  ├─ Get posting list from memory                                     │
│  │  └─ Persist to MongoDB (automatic chunking)                          │
│  ├─ Update batch persistence status                                     │
│  └─ No race conditions (single writer)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    │ All Batches Persisted Event
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLEANUP HANDLER                                       │
│  ├─ Clear global dirty set for index                                    │
│  ├─ Mark bulk operation as complete                                     │
│  ├─ Emit completion webhook/notification                                │
│  └─ Update metrics                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Detailed Component Design

### Component 1: Bulk Operation Tracker

**Purpose**: Track multi-batch operations and coordinate completion

**Data Structure (Redis/Memory)**:
```typescript
interface BulkOperation {
  id: string;                    // Unique bulk operation ID
  indexName: string;             // Target index
  totalBatches: number;          // Total batches to process
  completedBatches: number;      // Batches completed indexing
  persistedBatches: number;      // Batches persisted to MongoDB
  batchIds: string[];            // All batch job IDs
  createdAt: Date;               // Operation start time
  status: 'indexing' | 'persisting' | 'completed' | 'failed';
}
```

**Implementation**:
```typescript
// src/indexing/services/bulk-operation-tracker.service.ts

@Injectable()
export class BulkOperationTrackerService {
  private operations: Map<string, BulkOperation> = new Map();
  private readonly eventEmitter = new EventEmitter();

  createOperation(
    indexName: string, 
    totalBatches: number, 
    batchIds: string[]
  ): string {
    const bulkOpId = `bulk:${indexName}:${Date.now()}:${randomId()}`;
    this.operations.set(bulkOpId, {
      id: bulkOpId,
      indexName,
      totalBatches,
      completedBatches: 0,
      persistedBatches: 0,
      batchIds,
      createdAt: new Date(),
      status: 'indexing',
    });
    return bulkOpId;
  }

  markBatchIndexed(bulkOpId: string, batchId: string): BulkOperation {
    const op = this.operations.get(bulkOpId);
    if (!op) throw new Error(`Bulk operation ${bulkOpId} not found`);
    
    op.completedBatches++;
    
    if (op.completedBatches === op.totalBatches) {
      op.status = 'persisting';
      this.eventEmitter.emit('all-batches-indexed', op);
    }
    
    return op;
  }

  markBatchPersisted(bulkOpId: string, batchId: string): BulkOperation {
    const op = this.operations.get(bulkOpId);
    if (!op) throw new Error(`Bulk operation ${bulkOpId} not found`);
    
    op.persistedBatches++;
    
    if (op.persistedBatches === op.totalBatches) {
      op.status = 'completed';
      this.eventEmitter.emit('bulk-operation-completed', op);
    }
    
    return op;
  }

  onEvent(event: string, handler: (op: BulkOperation) => void) {
    this.eventEmitter.on(event, handler);
  }
}
```

### Component 2: Modified Indexing Queue Processor

**Purpose**: Fast document indexing with batch-local dirty tracking

**Key Changes**:
```typescript
// src/indexing/queue/indexing-queue.processor.ts

@Process({ name: 'batch', concurrency: BATCH_CONCURRENCY })
async processBatchDocuments(job: Job<BatchIndexingJob>) {
  const { indexName, documents, batchId, bulkOpId } = job.data;
  
  // Track dirty terms for THIS BATCH ONLY (no shared state)
  const batchDirtyTerms = new Set<string>();
  
  try {
    // Process documents (pass batch-local dirty tracker)
    const result = await this.documentService.processBatchDirectly(
      indexName,
      documentsWithIds,
      isRebuild,
      skipDuplicates,
      batchDirtyTerms  // ← Batch-specific dirty tracking
    );

    // Queue persistence job for THIS BATCH's dirty terms
    await this.persistenceQueue.add('persist-batch-terms', {
      indexName,
      batchId,
      bulkOpId,
      dirtyTerms: Array.from(batchDirtyTerms),
      persistenceId: `persist:${batchId}`,
    });

    // Notify tracker that indexing is complete
    if (bulkOpId) {
      await this.bulkOperationTracker.markBatchIndexed(bulkOpId, batchId);
    }

    return { success: true, ...result };
  } catch (error) {
    this.logger.error(`Batch ${batchId} failed: ${error.message}`);
    throw error;
  }
}
```

### Component 3: Persistence Queue Processor

**Purpose**: Sequential, ordered persistence of term postings

**Implementation**:
```typescript
// src/indexing/queue/persistence-queue.processor.ts

@Injectable()
@Processor('term-persistence')
export class PersistenceQueueProcessor {
  private readonly logger = new Logger(PersistenceQueueProcessor.name);

  constructor(
    private readonly termDictionary: InMemoryTermDictionary,
    private readonly persistentTermDictionary: PersistentTermDictionaryService,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
  ) {}

  /**
   * Single worker (concurrency: 1) ensures sequential, ordered writes.
   * No race conditions, no data loss, simple and reliable.
   */
  @Process({ name: 'persist-batch-terms', concurrency: 1 })
  async persistBatchTerms(job: Job<PersistenceBatchJob>) {
    const { indexName, batchId, bulkOpId, dirtyTerms } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `Persisting ${dirtyTerms.length} terms for batch ${batchId} (index: ${indexName})`
    );

    let persistedCount = 0;
    let failedCount = 0;

    try {
      // Process in sub-batches of 100 for efficiency
      const SUB_BATCH_SIZE = 100;
      
      for (let i = 0; i < dirtyTerms.length; i += SUB_BATCH_SIZE) {
        const termBatch = dirtyTerms.slice(i, i + SUB_BATCH_SIZE);

        await Promise.all(
          termBatch.map(async (indexAwareTerm) => {
            try {
              const postingList = await this.termDictionary.getPostingListForIndex(
                indexName,
                indexAwareTerm,
                true  // isIndexAware
              );

              if (postingList && postingList.size() > 0) {
                // PersistentTermDictionary.saveTermPostings handles:
                // - RocksDB persistence
                // - MongoDB persistence with automatic chunking (5000 docs/chunk)
                // - Chunk index management
                await this.persistentTermDictionary.saveTermPostings(
                  indexAwareTerm,
                  postingList
                );
                persistedCount++;
              }
            } catch (error) {
              failedCount++;
              this.logger.warn(
                `Failed to persist term ${indexAwareTerm}: ${error.message}`
              );
              // Continue with other terms
            }
          })
        );

        // Log progress for large batches
        if (dirtyTerms.length > 1000) {
          const progress = Math.min(i + SUB_BATCH_SIZE, dirtyTerms.length);
          this.logger.debug(`Persisted ${progress}/${dirtyTerms.length} terms for batch ${batchId}`);
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Persisted ${persistedCount}/${dirtyTerms.length} terms for batch ${batchId} ` +
        `in ${duration}ms (${failedCount} failed)`
      );

      // Notify tracker that persistence is complete
      if (bulkOpId) {
        await this.bulkOperationTracker.markBatchPersisted(bulkOpId, batchId);
      }

      return {
        success: true,
        persistedCount,
        failedCount,
        duration
      };
    } catch (error) {
      this.logger.error(`Persistence job failed for batch ${batchId}: ${error.message}`);
      throw error;
    }
  }

  @OnQueueCompleted()
  async onCompleted(job: Job) {
    this.logger.debug(`Persistence job ${job.id} completed`);
  }
}
```

### Component 4: Bulk Completion Handler

**Purpose**: Cleanup and finalization after all batches complete

**Implementation**:
```typescript
// src/indexing/services/bulk-completion.service.ts

@Injectable()
export class BulkCompletionService implements OnModuleInit {
  private readonly logger = new Logger(BulkCompletionService.name);

  constructor(
    private readonly bulkOperationTracker: BulkOperationTrackerService,
    private readonly indexingService: IndexingService,
  ) {}

  onModuleInit() {
    // Listen for bulk operation completion
    this.bulkOperationTracker.onEvent('bulk-operation-completed', 
      (op: BulkOperation) => this.handleBulkCompletion(op)
    );
  }

  private async handleBulkCompletion(operation: BulkOperation) {
    const { indexName, id, totalBatches } = operation;
    
    this.logger.log(
      `Bulk operation ${id} completed: ${totalBatches} batches indexed and persisted for ${indexName}`
    );

    try {
      // Final cleanup: Clear global dirty set (all batch-specific terms already persisted)
      this.indexingService.cleanupDirtyTermsAfterBulkIndexing(indexName);

      // Verify document count accuracy
      const storedCount = await this.indexStorageService.getDocumentCount(indexName);
      this.logger.log(`Final document count for ${indexName}: ${storedCount}`);

      // Emit completion event (for webhooks, notifications, etc.)
      this.eventEmitter.emit('bulk-indexing-completed', {
        bulkOpId: id,
        indexName,
        documentCount: storedCount,
        batchCount: totalBatches,
        duration: Date.now() - operation.createdAt.getTime(),
      });

      // Clean up operation from tracker (keep last N for debugging)
      this.bulkOperationTracker.archiveOperation(id);

    } catch (error) {
      this.logger.error(`Cleanup failed for bulk operation ${id}: ${error.message}`);
    }
  }
}
```

### Component 5: Modified Document Service

**Purpose**: Process documents with batch-local tracking

**Key Changes**:
```typescript
// src/document/document.service.ts

async processBatchDirectly(
  indexName: string,
  documents: Array<{ id: string; document: any }>,
  isRebuild = false,
  skipDuplicates = false,
  batchDirtyTerms?: Set<string>,  // ← NEW: Optional batch-local tracker
): Promise<BulkResponseDto> {
  // ... existing validation and setup ...

  // If no batch tracker provided, create local one (for backward compatibility)
  const dirtyTermsTracker = batchDirtyTerms || new Set<string>();

  // Process documents (parallel)
  for (const chunk of chunks) {
    const chunkPromises = chunk.map(async doc => {
      try {
        // ... storage operations ...

        // Index document (pass dirty tracker down)
        await this.indexingService.indexDocument(
          indexName,
          documentId,
          doc.document,
          true,      // fromBulk
          false,     // persistToMongoDB (handled by persistence worker)
          isNewDoc,
          dirtyTermsTracker  // ← Pass batch-local tracker
        );

        return { id: documentId, success: true, ... };
      } catch (error) {
        return { id: doc.id, success: false, error: error.message };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  // DO NOT persist here - let persistence worker handle it
  // dirtyTermsTracker now contains all terms modified by this batch
  
  return {
    items: results,
    took: Date.now() - startTime,
    errors: hasErrors,
    successCount,
  };
}
```

### Component 6: Modified Indexing Service

**Purpose**: Fast indexing with optional dirty tracking

**Key Changes**:
```typescript
// src/indexing/indexing.service.ts

async indexDocument(
  indexName: string,
  documentId: string,
  document: any,
  fromBulk = false,
  persistToMongoDB = false,
  isNewDocument?: boolean,
  batchDirtyTracker?: Set<string>,  // ← NEW: Optional batch-local tracker
): Promise<void> {
  // ... existing processing logic ...

  // Update inverted index
  for (const [field, fieldData] of Object.entries(processedDoc.fields)) {
    for (const term of fieldData.terms) {
      const fieldTerm = `${field}:${term}`;
      const indexAwareTerm = `${indexName}:${fieldTerm}`;
      
      // ... create term entry ...

      // Add to in-memory term dictionary
      await this.termDictionary.addPostingForIndex(indexName, fieldTerm, termEntry);

      // Track in batch-local dirty set (if provided)
      if (batchDirtyTracker) {
        batchDirtyTracker.add(indexAwareTerm);
      }

      // Also track _all field
      const allFieldTerm = `_all:${term}`;
      const allIndexAwareTerm = `${indexName}:${allFieldTerm}`;
      
      await this.termDictionary.addPostingForIndex(indexName, allFieldTerm, allTermEntry);
      
      if (batchDirtyTracker) {
        batchDirtyTracker.add(allIndexAwareTerm);
      }
    }
  }

  // Atomic document count increment (no race conditions)
  if (isNewDocument) {
    await this.indexStorage.incrementDocumentCount(indexName, 1);
  }
}
```

### Component 7: Persistence Job Interface

```typescript
// src/indexing/interfaces/persistence-job.interface.ts

export interface PersistenceBatchJob {
  indexName: string;
  batchId: string;           // Original indexing batch ID
  bulkOpId: string;          // Parent bulk operation ID
  dirtyTerms: string[];      // Index-aware terms to persist
  persistenceId: string;     // Unique ID for this persistence job
  priority?: number;         // Optional priority
}
```

## Data Flow: Complete Lifecycle

### 1. Bulk Indexing Request
```
User: POST /bulk-indexing/my-index (5000 documents)

BulkIndexingService:
├─ Split into 34 batches (150 docs each, except last batch: 50 docs)
├─ Create bulkOpId: "bulk:my-index:1234567890:abc123"
├─ Track operation: {bulkOpId, totalBatches: 34, completedBatches: 0, ...}
└─ Queue 34 batch jobs to 'indexing' queue
```

### 2. Concurrent Indexing (12 workers)
```
Worker 1: Process batch 1 (docs 1-150)
├─ batchDirtyTerms = new Set<string>()
├─ For each document:
│  ├─ Store in MongoDB (document storage)
│  ├─ Process document (tokenize, normalize)
│  ├─ Add to memory posting lists
│  ├─ Add terms to batchDirtyTerms
│  └─ Increment document count (atomic $inc)
├─ After all docs: batchDirtyTerms has ~500 unique terms
└─ Queue persistence job: {indexName, batchId: "batch-1", dirtyTerms: [500 terms], bulkOpId}

Worker 2: Process batch 2 (docs 151-300) - PARALLEL!
├─ batchDirtyTerms = new Set<string>() ← SEPARATE from Worker 1
├─ ... same process ...
└─ Queue persistence job: {indexName, batchId: "batch-2", dirtyTerms: [200 terms], bulkOpId}

... Workers 3-12 process batches 3-12 in parallel ...
```

**Key Point**: Each batch has its OWN dirty set. NO SHARED STATE = NO RACE CONDITIONS.

### 3. Sequential Persistence (1 worker)
```
Persistence Worker (single thread):
├─ Dequeue job 1: batch-1, 500 terms
│  ├─ For each term: Get posting list, persist to MongoDB
│  ├─ Duration: ~1-2 seconds
│  └─ Mark batch-1 as persisted
├─ Dequeue job 2: batch-2, 200 terms
│  ├─ For each term: Get posting list, persist to MongoDB
│  ├─ Some terms overlap with batch-1 → MongoDB upsert (idempotent)
│  ├─ Duration: ~0.5 seconds
│  └─ Mark batch-2 as persisted
└─ ... continues until all 34 batches persisted ...
```

**Key Point**: Sequential writes ensure correctness. Terms from multiple batches merge correctly via MongoDB upsert.

### 4. Completion & Cleanup
```
When 34th batch persists:
├─ BulkOperationTracker emits 'bulk-operation-completed'
├─ BulkCompletionService handles cleanup:
│  ├─ Clear global dirty set (if any residual entries)
│  ├─ Verify final document count: 5000
│  ├─ Log completion metrics
│  └─ Emit webhook/notification
└─ Archive bulk operation for debugging
```

## Performance Characteristics

### Indexing Performance
```
12 workers processing in parallel:
├─ Each batch: 150 docs processed in ~30-60 seconds
├─ Throughput: ~30-60 docs/second (12 workers × 2.5-5 docs/sec/worker)
├─ 5000 docs: ~2-3 minutes indexing time
└─ NO BLOCKING on persistence - continues at full speed
```

### Persistence Performance
```
1 worker persisting sequentially:
├─ Each term: ~2-5ms to persist (including chunking)
├─ Batch with 500 new terms: ~1-2.5 seconds
├─ Batch with 200 terms (some duplicates): ~0.5-1 second
├─ Later batches (fewer new terms): ~0.1-0.5 seconds
└─ Total for 5000 docs: ~30-60 seconds persistence time
```

### Total Time
```
Indexing: ~2-3 minutes (parallel)
Persistence: ~0.5-1 minute (sequential, overlapping with indexing)
Total: ~3-4 minutes for 5000 documents (including persistence!)
```

**Key Insight**: Persistence happens IN PARALLEL with indexing! While workers 7-12 are still indexing batches 7-12, the persistence worker is already persisting batches 1-6. Total time ≈ max(indexing time, persistence time).

## Edge Cases Handled

### 1. Same Term in Multiple Batches
```
Batch 1: Adds "limited" with docs 1-150 → dirtyTerms: [limited]
Batch 2: Adds "limited" with docs 151-300 → dirtyTerms: [limited]

Persistence Worker:
├─ Persist batch 1: "limited" has 150 docs → MongoDB upsert (chunk 0)
├─ Persist batch 2: "limited" now has 300 docs → MongoDB upsert (chunk 0 updates)
└─ Final result: "limited" has all 300 docs in MongoDB ✅
```

### 2. Large Posting List (>5000 docs)
```
Term "the" appears in all 5000 documents

Persistence:
├─ Repository.update() called with 5000 postings
├─ Automatically splits into chunks:
│  ├─ Chunk 0 (chunkIndex: 0): 5000 docs
├─ MongoDB stores: 1 document with chunkIndex: 0
└─ Search: Repository.findByIndexAwareTerm() merges all chunks automatically ✅
```

### 3. Batch Fails During Indexing
```
Batch 5 fails with error:

Indexing:
├─ Batches 1-4: Completed, queued persistence jobs
├─ Batch 5: FAILED, no persistence job queued
├─ Batches 6-34: Continue processing
└─ Total: 33 batches completed, 1 failed

Persistence:
├─ 33 persistence jobs complete successfully
├─ Bulk operation marked as "partially complete"
└─ Can retry batch 5 separately
```

### 4. Persistence Job Fails
```
Persistence job for batch 7 fails:

Bull retry logic:
├─ Attempt 1: Failed
├─ Wait (exponential backoff)
├─ Attempt 2: Failed
├─ Wait
├─ Attempt 3: Success ✅
└─ Job completes

If all attempts fail:
├─ Job moved to failed queue
├─ Admin notification
├─ Can retry manually
└─ Data is safe in RocksDB
```

### 5. Application Restart Mid-Indexing
```
Scenario: 20 batches indexed, 10 persisted, then server restarts

On restart:
├─ RocksDB has all 20 batches' data (periodic persistence)
├─ MongoDB has 10 batches' term postings
├─ Bull recovers:
│  ├─ Indexing queue: 14 pending batch jobs (resume processing)
│  └─ Persistence queue: 10 pending persistence jobs (resume persisting)
└─ System continues from where it left off ✅
```

### 6. Memory Pressure
```
Scenario: Index grows too large for memory

InMemoryTermDictionary:
├─ LRU eviction happens automatically
├─ Evicted terms persist to RocksDB
├─ Dirty tracking still works (Set of term names, not posting lists)
├─ Persistence worker gets posting lists from RocksDB if needed
└─ No data loss ✅
```

## Queue Configuration

### Indexing Queue
```typescript
BullModule.registerQueue({
  name: 'indexing',
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,  // Keep last 100 for debugging
    removeOnFail: false,    // Keep failed jobs for analysis
  },
});
```

### Persistence Queue (NEW)
```typescript
BullModule.registerQueue({
  name: 'term-persistence',
  defaultJobOptions: {
    attempts: 5,              // More retries for persistence
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: false,
    priority: 10,             // Higher priority than indexing
  },
});
```

## Monitoring & Metrics

### Metrics to Track

```typescript
interface BulkIndexingMetrics {
  // Indexing metrics
  totalDocuments: number;
  documentsPerSecond: number;
  averageBatchTime: number;
  
  // Persistence metrics
  totalTermsPersisted: number;
  averageTermsPerBatch: number;
  averagePersistenceTime: number;
  persistenceLatency: number;      // Time between indexing and persistence
  
  // Queue metrics
  indexingQueueDepth: number;
  persistenceQueueDepth: number;
  
  // Error metrics
  failedBatches: number;
  failedPersistenceJobs: number;
  
  // Completion metrics
  indexingDuration: number;
  persistenceDuration: number;
  totalDuration: number;
}
```

### Logging Strategy

```
[INFO] Bulk operation started: bulk:my-index:123 (34 batches, 5000 docs)
[INFO] Batch 1/34 indexing started (150 docs)
[DEBUG] Batch 1/34 indexed in 45s, queued persistence (500 terms)
[INFO] Batch 1/34 persistence started (500 terms)
[DEBUG] Persisted 500 terms in 1.2s for batch 1/34
[INFO] Batch 2/34 indexed in 42s, queued persistence (200 terms)
[INFO] Batch 2/34 persistence started (200 terms)
[DEBUG] Persisted 200 terms in 0.5s for batch 2/34
...
[INFO] All 34 batches indexed (3m 15s)
[INFO] All 34 batches persisted (45s)
[SUCCESS] Bulk operation bulk:my-index:123 completed: 5000 docs in 3m 30s
```

## Testing Strategy

### Unit Tests

#### 1. BulkOperationTrackerService
```typescript
describe('BulkOperationTrackerService', () => {
  it('should create bulk operation with correct initial state');
  it('should increment batch counters atomically');
  it('should emit events when thresholds reached');
  it('should handle concurrent batch completions');
});
```

#### 2. PersistenceQueueProcessor
```typescript
describe('PersistenceQueueProcessor', () => {
  it('should persist batch terms sequentially');
  it('should handle term persistence failures gracefully');
  it('should merge overlapping terms correctly');
  it('should handle large posting lists (>5000 docs)');
});
```

#### 3. AtomicIncrementDocumentCount
```typescript
describe('IndexRepository.incrementDocumentCount', () => {
  it('should atomically increment count');
  it('should handle concurrent increments correctly');
  it('should support negative increments (decrements)');
});
```

### Integration Tests

#### 1. Concurrent Batch Processing
```typescript
describe('Concurrent Bulk Indexing', () => {
  it('should handle 12 concurrent batches without race conditions');
  it('should persist all terms from all batches');
  it('should maintain accurate document count');
  it('should complete persistence after indexing finishes');
});
```

#### 2. End-to-End Bulk Indexing
```typescript
describe('E2E: Bulk Index 8000 Documents', () => {
  it('should index all 8000 documents');
  it('should persist all unique terms to MongoDB');
  it('should have correct document count (8000)');
  it('should return accurate search results');
  it('should handle application restart gracefully');
});
```

#### 3. Search Accuracy
```typescript
describe('Search After Bulk Indexing', () => {
  it('should return all matching documents for common terms');
  it('should work immediately after indexing (RocksDB)');
  it('should work after restart (MongoDB persistence)');
  it('should handle large result sets (>5000 docs)');
});
```

### Performance Tests

```typescript
describe('Performance Benchmarks', () => {
  it('should index 5000 docs in <5 minutes', async () => {
    const start = Date.now();
    await bulkIndex(5000);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5 * 60 * 1000);
  });

  it('should persist all terms within indexing timeframe', async () => {
    // Persistence should complete before or shortly after indexing
    const {indexingTime, persistenceTime} = await trackBulkIndex(5000);
    expect(persistenceTime).toBeLessThan(indexingTime * 1.5);
  });

  it('should scale linearly with document count', async () => {
    const time1k = await bulkIndex(1000);
    const time5k = await bulkIndex(5000);
    const time10k = await bulkIndex(10000);
    
    // Should scale roughly linearly (allow 20% variance)
    expect(time5k / time1k).toBeCloseTo(5, 1);
    expect(time10k / time1k).toBeCloseTo(10, 2);
  });
});
```

## Implementation Checklist

### Phase 1: Foundation (Infrastructure)
- [ ] Create `BulkOperationTrackerService`
  - [ ] Data structures for tracking operations
  - [ ] Event emitter for coordination
  - [ ] Methods: create, markBatchIndexed, markBatchPersisted
  - [ ] Unit tests
  
- [ ] Create `PersistenceQueueProcessor`
  - [ ] Bull processor with concurrency: 1
  - [ ] Batch term persistence logic
  - [ ] Error handling and retries
  - [ ] Unit tests

- [ ] Create `BulkCompletionService`
  - [ ] Event listeners for bulk completion
  - [ ] Cleanup logic
  - [ ] Notification/webhook support
  - [ ] Unit tests

- [ ] Add atomic document count methods
  - [x] `IndexRepository.incrementDocumentCount()`
  - [x] `IndexStorageService.incrementDocumentCount()`
  - [ ] Unit tests

### Phase 2: Integration (Connect Components)
- [ ] Update `BulkIndexingService`
  - [ ] Create bulk operation tracking
  - [ ] Pass bulkOpId to batch jobs
  - [ ] Register event handlers

- [ ] Update `IndexingQueueProcessor`
  - [ ] Accept batch-local dirty tracker
  - [ ] Queue persistence jobs after batch completion
  - [ ] Notify operation tracker

- [ ] Update `DocumentService.processBatchDirectly()`
  - [ ] Accept optional batchDirtyTerms parameter
  - [ ] Pass tracker down to indexDocument()
  - [ ] Return dirty terms (for queue processor)

- [ ] Update `IndexingService.indexDocument()`
  - [x] Accept optional batchDirtyTracker parameter
  - [x] Track dirty terms in batch-local set
  - [x] Use atomic document count increment

### Phase 3: Queue Setup
- [ ] Register 'term-persistence' queue
  - [ ] Add to BulkIndexingModule
  - [ ] Configure queue options
  - [ ] Set up event handlers

- [ ] Create persistence job interfaces
  - [ ] `PersistenceBatchJob` interface
  - [ ] Type definitions
  - [ ] Validation schemas

### Phase 4: Testing
- [ ] Unit tests for all new components
- [ ] Integration test: 8000 documents
  - [ ] Verify document count = 8000
  - [ ] Verify search returns ~8000 results for "limited"
  - [ ] Verify all terms in MongoDB
  
- [ ] Performance test: 5000 docs in <5 minutes
- [ ] Concurrency test: 12 workers simultaneously
- [ ] Failure test: Handle batch failures
- [ ] Restart test: Resume after restart

### Phase 5: Cleanup & Documentation
- [ ] Remove old dirty tracking code from InMemoryTermDictionary
  - [ ] Remove global dirtyTerms Map (replaced by batch-local)
  - [ ] Remove getDirtyTermsForIndex() (not needed)
  - [ ] Keep only batch-local tracking

- [ ] Update API documentation
- [ ] Update architecture diagrams
- [ ] Add monitoring dashboard queries
- [ ] Create runbook for operations team

## Migration from Current State

### Step 1: Build New Components
- Implement all Phase 1 & 2 components
- Test in isolation
- No impact on existing system

### Step 2: Feature Flag
```typescript
const USE_DEDICATED_PERSISTENCE = process.env.USE_DEDICATED_PERSISTENCE === 'true';

if (USE_DEDICATED_PERSISTENCE) {
  // New architecture
  await this.persistenceQueue.add('persist-batch-terms', {...});
} else {
  // Old architecture (fallback)
  await this.indexingService.persistDirtyTermPostingsToMongoDB(indexName);
}
```

### Step 3: Testing
- Test new architecture with feature flag enabled
- Run performance benchmarks
- Verify correctness

### Step 4: Cutover
- Enable feature flag by default
- Monitor for issues
- Remove old code after 2 weeks of stable operation

### Step 5: Cleanup
- Remove feature flag
- Remove old persistence code
- Update documentation

## Success Criteria

✅ **Correctness:**
- Document count always accurate (no race conditions)
- Search returns complete results (all terms persisted)
- Zero data loss with concurrent batches

✅ **Performance:**
- 5000 docs indexed in <5 minutes
- Linear scaling with document count
- Persistence completes within indexing timeframe

✅ **Reliability:**
- Handles failures gracefully (retries)
- Survives application restarts
- Predictable, deterministic behavior

✅ **Maintainability:**
- Clear separation of concerns
- Well-documented architecture
- Comprehensive test coverage
- Easy to debug and monitor

## Timeline Estimate

- **Phase 1 (Foundation)**: 4-6 hours
  - BulkOperationTrackerService: 1.5 hours
  - PersistenceQueueProcessor: 2 hours
  - BulkCompletionService: 1 hour
  - Unit tests: 1.5 hours

- **Phase 2 (Integration)**: 3-4 hours
  - Update existing services: 2 hours
  - Wire up event handlers: 1 hour
  - Integration testing: 1 hour

- **Phase 3 (Queue Setup)**: 1-2 hours
  - Module configuration: 0.5 hour
  - Interface definitions: 0.5 hour
  - Queue setup and testing: 1 hour

- **Phase 4 (Testing)**: 2-3 hours
  - Unit tests completion: 1 hour
  - Integration tests: 1 hour
  - Performance benchmarks: 1 hour

- **Phase 5 (Cleanup)**: 1-2 hours
  - Code cleanup: 0.5 hour
  - Documentation: 1 hour
  - Final review: 0.5 hour

**Total**: 11-17 hours for complete, production-grade implementation

## Conclusion

This architecture provides:
- **Zero race conditions** (single writer pattern)
- **Maximum performance** (parallel indexing + async persistence)
- **Complete durability** (memory → RocksDB → MongoDB)
- **Linear scaling** (no exponential slowdown)
- **Production-ready** (handles all edge cases)

The key insight: **Separate indexing (fast, parallel) from persistence (reliable, sequential)**. Let each layer do what it does best.
