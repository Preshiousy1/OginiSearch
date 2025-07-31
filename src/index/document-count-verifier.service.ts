import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DocumentStorageService } from '../storage/document-storage/document-storage.service';
import { PostgreSQLService } from '../storage/postgresql/postgresql.service';

@Injectable()
export class DocumentCountVerifierService {
  private readonly logger = new Logger(DocumentCountVerifierService.name);

  constructor(
    private readonly postgresqlService: PostgreSQLService,
    private readonly documentStorage: DocumentStorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async verifyAllIndicesDocumentCount() {
    this.logger.log('Starting periodic document count verification for all indices');
    try {
      const result = await this.postgresqlService.query('SELECT index_name FROM indices');

      // Handle case where result is not an array or is empty
      if (!result || !Array.isArray(result) || result.length === 0) {
        this.logger.warn('No indices found or invalid query result structure');
        return;
      }

      // Extract index names from result rows
      const indices = result
        .map(row => ({
          index_name: row.index_name || row[0], // Handle both object and array results
        }))
        .filter(row => row.index_name); // Filter out any undefined/null values

      if (indices.length === 0) {
        this.logger.warn('No valid indices found after processing query result');
        return;
      }

      this.logger.debug(`Found ${indices.length} indices to verify`);

      for (const index of indices) {
        try {
          await this.verifyIndexDocumentCount(index.index_name);
        } catch (error) {
          this.logger.error(
            `Error verifying document count for index ${index.index_name}: ${error.message}`,
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

    try {
      // Get current index metadata
      const result = await this.postgresqlService.query(
        'SELECT document_count FROM indices WHERE index_name = $1',
        [indexName],
      );

      if (!result || result.length === 0) {
        this.logger.warn(`Index ${indexName} not found`);
        return;
      }

      const currentCount = parseInt(result[0]?.document_count || '0', 10);

      // Get actual document count from documents table
      const actualResult = await this.postgresqlService.query(
        'SELECT COUNT(*) as count FROM documents WHERE index_name = $1',
        [indexName],
      );
      const actualCount = parseInt(actualResult[0]?.count || '0', 10);

      // Compare counts
      if (currentCount !== actualCount) {
        this.logger.warn(
          `Document count mismatch in index ${indexName}. ` +
            `Metadata shows ${currentCount}, actual count is ${actualCount}. ` +
            `Correcting the count...`,
        );

        await this.postgresqlService.query(
          'UPDATE indices SET document_count = $2, updated_at = CURRENT_TIMESTAMP WHERE index_name = $1',
          [indexName, actualCount],
        );

        this.logger.log(
          `Successfully corrected document count for index ${indexName} to ${actualCount}`,
        );
      } else {
        this.logger.debug(
          `Document count verified for index ${indexName}: ${actualCount} documents`,
        );
      }
    } catch (error) {
      this.logger.error(`Error verifying document count for index ${indexName}: ${error.message}`);
      throw error;
    }
  }
}
