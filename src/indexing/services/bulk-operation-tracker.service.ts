import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BulkOperation } from '../interfaces/bulk-operation.interface';

/**
 * Tracks multi-batch bulk indexing operations and coordinates their completion.
 * Provides event-driven coordination between indexing and persistence workers.
 *
 * NEW: Uses Redis for persistent state (via Bull queue client) to survive restarts.
 * Falls back to in-memory Map for non-critical operations.
 */
@Injectable()
export class BulkOperationTrackerService implements OnModuleInit {
  private readonly logger = new Logger(BulkOperationTrackerService.name);
  private operations: Map<string, BulkOperation> = new Map(); // In-memory cache
  private readonly MAX_ARCHIVED_OPERATIONS = 100; // Keep last 100 for debugging
  private readonly REDIS_KEY_PREFIX = 'bulk-op:';
  private readonly DIRTY_LIST_PREFIX = 'bulk-op:dirty:';
  private redisClient: any; // Redis client from Bull queue

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('indexing') private readonly indexingQueue: Queue,
    @InjectQueue('term-persistence') private readonly persistenceQueue: Queue,
  ) {}

  async onModuleInit() {
    // Get Redis client from Bull queue for persistent storage
    this.redisClient = await this.indexingQueue.client;
    this.logger.log('BulkOperationTrackerService initialized with Redis backing');

    // Restore active operations from Redis on startup
    await this.restoreOperationsFromRedis();
  }

  /**
   * Restore active operations from Redis on startup
   */
  private async restoreOperationsFromRedis(): Promise<void> {
    try {
      const keys = await this.redisClient.keys(`${this.REDIS_KEY_PREFIX}*`);
      let restored = 0;

      for (const key of keys) {
        const data = await this.redisClient.get(key);
        if (data) {
          const operation: BulkOperation = JSON.parse(data);
          // Only restore active operations
          if (operation.status === 'indexing' || operation.status === 'persisting') {
            this.operations.set(operation.id, operation);
            restored++;
          }
        }
      }

      if (restored > 0) {
        this.logger.log(`Restored ${restored} active bulk operations from Redis`);
        for (const op of this.operations.values()) {
          if (op.status === 'indexing' || op.status === 'persisting') {
            await this.persistenceQueue.add(
              'drain-dirty-list',
              { bulkOpId: op.id, indexName: op.indexName },
              { priority: 10, removeOnComplete: 50, removeOnFail: false },
            );
            this.logger.log(`Re-queued drain job for restored bulk op ${op.id}`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to restore operations from Redis: ${error.message}`);
    }
  }

  /**
   * Save operation to Redis for persistence across restarts
   */
  private async saveToRedis(operation: BulkOperation): Promise<void> {
    try {
      const key = `${this.REDIS_KEY_PREFIX}${operation.id}`;
      await this.redisClient.setex(
        key,
        86400 * 7, // 7 days TTL
        JSON.stringify(operation),
      );
    } catch (error) {
      this.logger.warn(`Failed to save operation to Redis: ${error.message}`);
      // Don't throw - in-memory tracking still works
    }
  }

  /**
   * Create a new bulk operation and start tracking it.
   *
   * @param indexName The target index
   * @param totalBatches Total number of batches to process
   * @param batchIds Array of batch job IDs
   * @param totalDocuments Optional total document count
   * @returns Unique bulk operation ID
   */
  createOperation(
    indexName: string,
    totalBatches: number,
    batchIds: string[],
    totalDocuments?: number,
  ): string {
    const bulkOpId = `bulk:${indexName}:${Date.now()}:${this.generateRandomId()}`;

    const operation: BulkOperation = {
      id: bulkOpId,
      indexName,
      totalBatches,
      completedBatches: 0,
      persistedBatches: 0,
      batchIds,
      createdAt: new Date(),
      status: 'indexing',
      totalDocuments,
      updatedAt: new Date(),
    };

    this.operations.set(bulkOpId, operation);

    this.logger.log(
      `Created bulk operation ${bulkOpId}: ${totalBatches} batches, ${
        totalDocuments || '?'
      } documents, index: ${indexName}`,
    );

    return bulkOpId;
  }

  /** Redis list key for dirty terms: indexers push to right, persistence worker pops from left */
  private dirtyListKey(bulkOpId: string): string {
    return `${this.DIRTY_LIST_PREFIX}${bulkOpId}`;
  }

  /**
   * Push dirty terms to the right of the shared list (called by indexing workers).
   * Dedicated persistence worker pops from the left in batches.
   */
  async pushDirtyTerms(bulkOpId: string, terms: string[]): Promise<void> {
    if (terms.length === 0) return;
    const key = this.dirtyListKey(bulkOpId);
    try {
      await this.redisClient.rpush(key, ...terms);
      await this.redisClient.expire(key, 86400 * 7); // 7 days TTL
    } catch (error) {
      this.logger.warn(`Failed to push dirty terms for ${bulkOpId}: ${error.message}`);
    }
  }

  /**
   * Pop up to `size` terms from the left of the list (called by dedicated persistence worker).
   * Returns empty array if list is empty.
   */
  async popDirtyTermsBatch(bulkOpId: string, size: number): Promise<string[]> {
    const key = this.dirtyListKey(bulkOpId);
    try {
      const items = await this.redisClient.lrange(key, 0, size - 1);
      if (items.length > 0) {
        await this.redisClient.ltrim(key, items.length, -1);
      }
      return items;
    } catch (error) {
      this.logger.warn(`Failed to pop dirty terms batch for ${bulkOpId}: ${error.message}`);
      return [];
    }
  }

  async getDirtyListLength(bulkOpId: string): Promise<number> {
    try {
      return await this.redisClient.llen(this.dirtyListKey(bulkOpId));
    } catch {
      return 0;
    }
  }

  async deleteDirtyList(bulkOpId: string): Promise<void> {
    try {
      await this.redisClient.del(this.dirtyListKey(bulkOpId));
    } catch (error) {
      this.logger.warn(`Failed to delete dirty list for ${bulkOpId}: ${error.message}`);
    }
  }

  /**
   * Mark a batch as completed (indexing finished).
   * When all batches are indexed, emits 'all-batches-indexed' for logging only.
   * Persistence worker runs concurrently and drains the dirty list; it does not wait for this.
   */
  markBatchIndexed(bulkOpId: string, batchId: string): BulkOperation {
    const op = this.operations.get(bulkOpId);
    if (!op) {
      throw new Error(`Bulk operation ${bulkOpId} not found`);
    }

    op.completedBatches++;
    op.updatedAt = new Date();
    this.saveToRedis(op);

    this.logger.debug(
      `Batch ${batchId} indexed: ${op.completedBatches}/${op.totalBatches} batches complete (${bulkOpId})`,
    );

    if (op.completedBatches === op.totalBatches) {
      op.status = 'persisting';
      const indexingDuration = Date.now() - op.createdAt.getTime();
      this.saveToRedis(op);
      this.logger.log(
        `All ${op.totalBatches} batches indexed for ${op.indexName} (${bulkOpId}) in ${indexingDuration}ms. Persistence worker continues draining dirty list.`,
      );
      this.eventEmitter.emit('all-batches-indexed', {
        bulkOpId: op.id,
        indexName: op.indexName,
        totalBatches: op.totalBatches,
        totalDocuments: op.totalDocuments || 0,
        indexingDuration,
        dirtyTerms: [], // No longer used; drain job consumes from Redis list
      });
    }

    return op;
  }

  /**
   * Mark a batch as persisted (MongoDB writes completed).
   * If all batches are persisted, emits 'bulk-operation-completed' event.
   */
  markBatchPersisted(bulkOpId: string, batchId: string): BulkOperation {
    const op = this.operations.get(bulkOpId);
    if (!op) {
      throw new Error(`Bulk operation ${bulkOpId} not found`);
    }

    // Already completed (e.g. from a previous run or duplicate event) – don't increment past total
    if (op.status === 'completed') {
      this.logger.debug(`Batch ${batchId} persisted: bulk already completed (${bulkOpId})`);
      return op;
    }

    op.persistedBatches = Math.min(op.persistedBatches + 1, op.totalBatches);
    op.updatedAt = new Date();
    this.saveToRedis(op);

    this.logger.debug(
      `Batch ${batchId} persisted: ${op.persistedBatches}/${op.totalBatches} batches persisted (${bulkOpId})`,
    );

    if (op.persistedBatches === op.totalBatches) {
      op.status = 'completed';
      this.saveToRedis(op);
      this.emitBulkOperationCompleted(op);
    }

    return op;
  }

  /**
   * Mark the entire bulk operation as persisted (used when a single persistence job completes).
   * Call this from the persistence worker when the one "persist all terms" job finishes.
   */
  markPersistenceComplete(bulkOpId: string): BulkOperation | null {
    const op = this.operations.get(bulkOpId);
    if (!op) return null;

    op.persistedBatches = op.totalBatches;
    op.status = 'completed';
    op.updatedAt = new Date();
    this.saveToRedis(op);

    this.emitBulkOperationCompleted(op);
    return op;
  }

  private emitBulkOperationCompleted(op: BulkOperation): void {
    const totalDuration = Date.now() - op.createdAt.getTime();
    this.logger.log(
      `🎉 Bulk operation ${op.id} COMPLETED: ${op.totalBatches} batches, ` +
        `${op.totalDocuments || '?'} documents, index: ${
          op.indexName
        }, duration: ${totalDuration}ms`,
    );
    this.eventEmitter.emit('bulk-operation-completed', {
      bulkOpId: op.id,
      indexName: op.indexName,
      totalBatches: op.totalBatches,
      totalDocuments: op.totalDocuments || 0,
      indexingDuration: totalDuration,
      persistenceDuration: 0,
      totalDuration,
    });
  }

  /**
   * Mark a bulk operation as failed.
   *
   * @param bulkOpId The bulk operation ID
   * @param error Error message
   */
  markOperationFailed(bulkOpId: string, error: string): void {
    const op = this.operations.get(bulkOpId);
    if (!op) {
      this.logger.warn(`Attempted to mark non-existent operation ${bulkOpId} as failed`);
      return;
    }

    op.status = 'failed';
    op.error = error;
    op.updatedAt = new Date();

    // Persist failure to Redis
    this.saveToRedis(op);

    this.logger.error(`Bulk operation ${bulkOpId} FAILED: ${error}`);

    this.eventEmitter.emit('bulk-operation-failed', {
      bulkOpId: op.id,
      indexName: op.indexName,
      error,
    });
  }

  /**
   * Get a bulk operation by ID
   */
  getOperation(bulkOpId: string): BulkOperation | undefined {
    return this.operations.get(bulkOpId);
  }

  /**
   * Get all active operations (not completed or failed)
   */
  getActiveOperations(): BulkOperation[] {
    return Array.from(this.operations.values()).filter(
      op => op.status === 'indexing' || op.status === 'persisting',
    );
  }

  /**
   * Archive old operations to prevent memory growth.
   * Keeps last MAX_ARCHIVED_OPERATIONS for debugging.
   */
  async archiveOperation(bulkOpId: string): Promise<void> {
    const op = this.operations.get(bulkOpId);
    if (!op || (op.status !== 'completed' && op.status !== 'failed')) {
      this.logger.debug(`Cannot archive operation ${bulkOpId} (not completed/failed or not found)`);
      return;
    }

    // Simple cleanup: delete from memory if too many operations
    if (this.operations.size > this.MAX_ARCHIVED_OPERATIONS) {
      this.operations.delete(bulkOpId);
      this.logger.debug(`Archived bulk operation ${bulkOpId} from memory`);
    }

    // Keep in Redis for longer (7 days TTL already set)
    // Redis will auto-expire after TTL
  }

  /**
   * Clean up old completed operations (called periodically)
   */
  async cleanupOldOperations(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, op] of this.operations.entries()) {
      if (
        (op.status === 'completed' || op.status === 'failed') &&
        now - op.createdAt.getTime() > maxAgeMs
      ) {
        this.operations.delete(id);

        // Also remove from Redis
        try {
          await this.redisClient.del(`${this.REDIS_KEY_PREFIX}${id}`);
        } catch (error) {
          this.logger.warn(`Failed to delete operation ${id} from Redis: ${error.message}`);
        }

        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} old bulk operations from memory and Redis`);
    }

    return cleaned;
  }

  private generateRandomId(): string {
    return Math.random().toString(36).substring(2, 8);
  }
}
