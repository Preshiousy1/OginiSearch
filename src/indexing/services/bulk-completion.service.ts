import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BulkOperationCompletedEvent,
  AllBatchesIndexedEvent,
} from '../interfaces/bulk-operation.interface';
import { IndexingService } from '../indexing.service';
import { IndexStorageService } from '../../storage/index-storage/index-storage.service';
import { BulkOperationTrackerService } from './bulk-operation-tracker.service';

/**
 * Handles cleanup and finalization after bulk operations complete.
 *
 * Persistence is handled by the drain job (started with batch jobs): it consumes
 * from the dirty list while indexers push; no job is queued here.
 */
@Injectable()
export class BulkCompletionService {
  private readonly logger = new Logger(BulkCompletionService.name);

  constructor(
    private readonly indexingService: IndexingService,
    private readonly indexStorageService: IndexStorageService,
    private readonly bulkOperationTracker: BulkOperationTrackerService,
  ) {}

  @OnEvent('all-batches-indexed')
  async handleAllBatchesIndexed(event: AllBatchesIndexedEvent) {
    const { bulkOpId, indexName, totalBatches, totalDocuments, indexingDuration } = event;
    this.logger.log(
      `🚀 All ${totalBatches} batches indexed for ${indexName} (${bulkOpId}): ` +
        `${totalDocuments} documents in ${indexingDuration}ms. Drain worker continues until list empty.`,
    );
  }

  /**
   * Handle event when bulk operation fully completes (all batches indexed AND persisted)
   */
  @OnEvent('bulk-operation-completed')
  async handleBulkOperationCompleted(event: BulkOperationCompletedEvent) {
    const { bulkOpId, indexName, totalBatches, totalDocuments, totalDuration } = event;

    this.logger.log(
      `🎉 Bulk operation ${bulkOpId} COMPLETED for ${indexName}: ` +
        `${totalBatches} batches, ${totalDocuments} documents in ${totalDuration}ms`,
    );

    try {
      // 1. Final cleanup: Clear global dirty set (all batch-specific terms already persisted)
      // Note: With batch-local tracking, global dirty set should be minimal/empty
      this.indexingService.cleanupDirtyTermsAfterBulkIndexing(indexName);
      this.logger.debug(`Cleared dirty terms for index: ${indexName}`);

      // 2. Verify document count accuracy
      const storedCount = await this.indexStorageService.getDocumentCount(indexName);
      this.logger.log(`Final document count for ${indexName}: ${storedCount}`);

      if (totalDocuments && storedCount !== totalDocuments) {
        this.logger.warn(
          `Document count mismatch: expected ${totalDocuments}, got ${storedCount}. ` +
            `This may indicate failures during indexing.`,
        );
      }

      // 3. Log completion metrics
      const avgBatchTime = totalDuration / totalBatches;
      const docsPerSecond = Math.round((totalDocuments / totalDuration) * 1000);
      this.logger.log(`Performance: ${avgBatchTime.toFixed(0)}ms/batch, ${docsPerSecond} docs/sec`);

      // 4. Archive operation from tracker (keep last N for debugging)
      this.bulkOperationTracker.archiveOperation(bulkOpId);

      // 5. Emit webhook/notification (if configured)
      // await this.notificationService.sendBulkIndexingCompleteWebhook({...});
    } catch (error) {
      this.logger.error(
        `Cleanup failed for bulk operation ${bulkOpId}: ${error.message}`,
        error.stack,
      );
      // Don't throw - cleanup errors shouldn't fail the operation
    }
  }

  /**
   * Handle event when bulk operation fails
   */
  @OnEvent('bulk-operation-failed')
  async handleBulkOperationFailed(event: { bulkOpId: string; indexName: string; error: string }) {
    const { bulkOpId, indexName, error } = event;

    this.logger.error(`❌ Bulk operation ${bulkOpId} FAILED for ${indexName}: ${error}`);

    // Could trigger error notifications/webhooks here
    // await this.notificationService.sendBulkIndexingFailedWebhook({...});

    // Archive the failed operation
    this.bulkOperationTracker.archiveOperation(bulkOpId);
  }

  /**
   * Periodic cleanup of old operations (run via cron/scheduler if needed)
   */
  async cleanupOldOperations() {
    const cleaned = await this.bulkOperationTracker.cleanupOldOperations(24 * 60 * 60 * 1000); // 24 hours
    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} old bulk operations`);
    }
  }
}
