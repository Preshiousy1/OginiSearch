#!/usr/bin/env ts-node
/**
 * Drain stale pending persistence refs from MongoDB.
 * Processes refs that have a payload (merges terms); skips and removes refs with no payload.
 *
 * Usage: npm run drain-stale-pending
 *    or: npx ts-node -r tsconfig-paths/register scripts/diagnostics/drain-stale-pending-refs.ts
 *
 * Alternatively use the API: POST /bulk-indexing/persistence/drain-stale-pending
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { BulkIndexingService } from '../../src/indexing/services/bulk-indexing.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const bulkIndexing = app.get(BulkIndexingService);
    console.log('Draining stale pending refs from MongoDB...');
    const { processed, skipped } = await bulkIndexing.drainStalePendingRefs();
    console.log(`Done: ${processed} batches processed, ${skipped} stale refs skipped`);
    await app.close();
    process.exit(0);
  } catch (err: any) {
    console.error('Error:', err?.message);
    await app.close();
    process.exit(1);
  }
}

main();
