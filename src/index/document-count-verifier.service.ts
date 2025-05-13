import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IndexService } from './index.service';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';

@Injectable()
export class DocumentCountVerifierService {
  private readonly logger = new Logger(DocumentCountVerifierService.name);

  constructor(
    private readonly indexService: IndexService,
    private readonly documentStorage: DocumentStorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async verifyAllIndicesDocumentCount() {
    this.logger.log('Starting periodic document count verification for all indices');
    try {
      const indices = await this.indexService.listIndices();
      for (const index of indices) {
        try {
          await this.verifyIndexDocumentCount(index.name);
        } catch (error) {
          this.logger.error(
            `Error verifying document count for index ${index.name}: ${error.message}`,
          );
        }
      }
      this.logger.log('Completed periodic document count verification');
    } catch (error) {
      this.logger.error(`Error during document count verification: ${error.message}`);
    }
  }

  async verifyIndexDocumentCount(indexName: string) {
    this.logger.debug(`Verifying document count for index ${indexName}`);

    // Get current index metadata
    const index = await this.indexService.getIndex(indexName);

    // Get actual document count from storage
    const { total: actualCount } = await this.documentStorage.getDocuments(indexName, { limit: 0 });

    // Compare counts
    if (index.documentCount !== actualCount) {
      this.logger.warn(
        `Document count mismatch in index ${indexName}. ` +
          `Metadata shows ${index.documentCount}, actual count is ${actualCount}. ` +
          `Correcting the count...`,
      );
      await this.indexService.rebuildDocumentCount(indexName);
      this.logger.log(
        `Successfully corrected document count for index ${indexName} to ${actualCount}`,
      );
    } else {
      this.logger.debug(`Document count verified for index ${indexName}: ${actualCount} documents`);
    }
  }
}
