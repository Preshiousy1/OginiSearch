import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BulkIndexingService } from '../src/indexing/services/bulk-indexing.service';
import { Logger } from '@nestjs/common';
import { faker } from '@faker-js/faker';

const logger = new Logger('BulkProductsTest');

// Generate realistic product data
function generateProducts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `product-${i + 3}`, // Start from 3 since we already have 1 and 2
    document: {
      title: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: faker.commerce.price(),
      categories: [
        faker.commerce.department(),
        faker.commerce.productAdjective(),
      ],
      brand: faker.company.name(),
      inStock: faker.datatype.boolean(),
      rating: faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
      reviews: faker.number.int({ min: 0, max: 1000 }),
      metadata: {
        createdAt: faker.date.past().toISOString(),
        updatedAt: faker.date.recent().toISOString(),
        supplier: faker.company.name(),
        origin: faker.location.country(),
      }
    }
  }));
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const bulkIndexingService = app.get(BulkIndexingService);

  try {
    const productCount = 100; // Add 100 products
    logger.log(`Generating ${productCount} test products...`);
    const products = generateProducts(productCount);

    logger.log('Starting bulk indexing...');
    const startTime = Date.now();

    // Queue products for bulk indexing
    const result = await bulkIndexingService.queueBulkIndexing(
      'test-products',
      products,
      {
        batchSize: 20,
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

      const percentComplete = ((progress.processedDocuments || 0) / productCount) * 100;
      logger.log(
        `Progress: ${percentComplete.toFixed(2)}% (${
          progress.processedDocuments
        }/${productCount}) - Status: ${progress.status}`,
      );

      if (progress.status === 'completed' || progress.status === 'failed') {
        completed = true;
        const duration = Date.now() - startTime;
        const docsPerSecond = (progress.processedDocuments / duration) * 1000;

        logger.log('Bulk indexing completed!');
        logger.log(`Total time: ${(duration / 1000).toFixed(2)} seconds`);
        logger.log(`Products per second: ${docsPerSecond.toFixed(2)}`);
        logger.log(`Failed products: ${progress.failedDocuments}`);

        if (progress.error) {
          logger.error(`Error encountered: ${progress.error}`);
        }
      }

      if (!completed) {
        await new Promise(resolve => setTimeout(resolve, 1000));
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