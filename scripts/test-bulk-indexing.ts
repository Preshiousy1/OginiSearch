import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DocumentStorageService } from '../src/storage/document-storage/document-storage.service';
import { BulkIndexingService } from '../src/indexing/services/bulk-indexing.service';
import { Logger } from '@nestjs/common';
import { faker } from '@faker-js/faker';

const logger = new Logger('BulkIndexingTest');

async function generateTestDocuments(count: number) {
  const documents = [];
  for (let i = 0; i < count; i++) {
    documents.push({
      documentId: faker.string.uuid(),
      content: {
        title: faker.lorem.sentence(),
        description: faker.lorem.paragraph(),
        tags: Array.from({ length: 3 }, () => faker.lorem.word()),
        price: faker.number.float({ min: 10, max: 1000 }),
        category: faker.commerce.department(),
        createdAt: faker.date.past().toISOString(),
      },
      metadata: {
        source: 'test',
        version: '1.0',
      },
    });
  }
  return documents;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const documentStorageService = app.get(DocumentStorageService);
  const bulkIndexingService = app.get(BulkIndexingService);

  try {
    const testIndexName = 'bulk-test-index';
    const documentCount = 100000;
    logger.log(`Generating ${documentCount} test documents...`);
    const documents = await generateTestDocuments(documentCount);

    logger.log('Starting bulk indexing test...');
    const startTime = Date.now();

    // Queue documents for bulk indexing
    const result = await bulkIndexingService.queueBulkIndexing(
      testIndexName,
      documents.map(doc => ({
        id: doc.documentId,
        document: doc.content,
      })),
      {
        batchSize: 2000,
        skipDuplicates: true,
        enableProgress: true,
      },
    );

    logger.log(`Bulk indexing queued: ${JSON.stringify(result)}`);

    // Monitor progress
    let completed = false;
    while (!completed) {
      const progress = await bulkIndexingService.getBatchProgress(result.batchId);
      if (!progress) {
        logger.warn('No progress information available');
        break;
      }

      const percentComplete = ((progress.processedDocuments || 0) / documentCount) * 100;
      logger.log(
        `Progress: ${percentComplete.toFixed(2)}% (${
          progress.processedDocuments
        }/${documentCount}) - Status: ${progress.status}`,
      );

      if (progress.status === 'completed' || progress.status === 'failed') {
        completed = true;
        const duration = Date.now() - startTime;
        const docsPerSecond = (progress.processedDocuments / duration) * 1000;

        logger.log('Bulk indexing completed!');
        logger.log(`Total time: ${(duration / 1000).toFixed(2)} seconds`);
        logger.log(`Documents per second: ${docsPerSecond.toFixed(2)}`);
        logger.log(`Failed documents: ${progress.failedDocuments}`);

        if (progress.error) {
          logger.error(`Error encountered: ${progress.error}`);
        }
      }

      if (!completed) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before checking again
      }
    }

    await bulkIndexingService.cleanupBatchProgress(result.batchId);
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await app.close();
  }
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
}); 