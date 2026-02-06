#!/usr/bin/env ts-node
/**
 * Script to rebuild document count for an index
 * This fixes discrepancies between actual document count in MongoDB and the reported count
 *
 * Usage:
 *   INDEX_NAME=bulk-test-20000 npm run rebuild-doc-count
 *   or
 *   ts-node scripts/diagnostics/rebuild-document-count.ts bulk-test-20000
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { IndexService } from '../../src/index/index.service';
import { Logger } from '@nestjs/common';

async function rebuildDocumentCount(indexName: string) {
  const logger = new Logger('RebuildDocumentCount');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const indexService = app.get(IndexService);

    logger.log(`Rebuilding document count for index: ${indexName}`);

    // Get current count before rebuild
    const indexBefore = await indexService.getIndex(indexName);
    const countBefore = indexBefore?.documentCount || 0;

    logger.log(`Current reported count: ${countBefore}`);

    // Rebuild the count
    await indexService.rebuildDocumentCount(indexName);

    // Get count after rebuild
    const indexAfter = await indexService.getIndex(indexName);
    const countAfter = indexAfter?.documentCount || 0;

    logger.log(`New count after rebuild: ${countAfter}`);
    logger.log(`Difference: ${countAfter - countBefore} documents`);

    if (countAfter !== countBefore) {
      logger.warn(
        `Document count was corrected: ${countBefore} → ${countAfter} (${
          countAfter - countBefore > 0 ? '+' : ''
        }${countAfter - countBefore})`,
      );
    } else {
      logger.log('Document count was already correct');
    }

    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error(`Failed to rebuild document count: ${error.message}`);
    logger.error(error.stack);
    await app.close();
    process.exit(1);
  }
}

// Get index name from command line args or environment variable
const indexName = process.argv[2] || process.env.INDEX_NAME;

if (!indexName) {
  console.error('Usage: INDEX_NAME=index-name npm run rebuild-doc-count');
  console.error('   or: ts-node scripts/diagnostics/rebuild-document-count.ts index-name');
  process.exit(1);
}

rebuildDocumentCount(indexName);
