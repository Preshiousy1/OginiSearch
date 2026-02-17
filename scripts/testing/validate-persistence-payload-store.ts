#!/usr/bin/env ts-node
/**
 * Validates the MongoDB-backed persistence payload store used by the term-persistence queue.
 * Run before re-indexing to ensure persistence_payloads collection works (MongoDB creates
 * the collection automatically on first insert).
 *
 * Usage: npm run test:persistence-payload-store
 *    or: npx ts-node -r tsconfig-paths/register scripts/testing/validate-persistence-payload-store.ts
 */

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoDBModule } from '../../src/storage/mongodb/mongodb.module';
import { PersistencePayloadRepository } from '../../src/storage/mongodb/repositories/persistence-payload.repository';
import { PERSIST_PAYLOAD_REDIS_PREFIX } from '../../src/indexing/interfaces/persistence-job.interface';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MongoDBModule],
})
class ValidatePersistencePayloadModule {}

const TEST_KEY = `${PERSIST_PAYLOAD_REDIS_PREFIX}validate:test:${Date.now()}`;
const TEST_PAYLOAD = {
  indexName: 'bulk-test-20000',
  batchId: `batch:test:${Date.now()}`,
  bulkOpId: 'validate-test',
  dirtyTerms: ['bulk-test-20000:title:hello', 'bulk-test-20000:body:world'],
  termPostings: [],
  persistenceId: 'persist:validate-test:batch',
  indexedAt: new Date(),
};

function log(msg: string) {
  console.log(msg);
}

async function validate() {
  const app = await NestFactory.createApplicationContext(ValidatePersistencePayloadModule, {
    logger: false,
  });

  try {
    const repo = app.get(PersistencePayloadRepository);

    log('1. Writing payload to MongoDB (collection created on first insert)...');
    await repo.set(TEST_KEY, JSON.stringify(TEST_PAYLOAD));
    log('   OK - set() succeeded');

    log('2. Reading payload back...');
    const stored = await repo.get(TEST_KEY);
    if (!stored) {
      throw new Error('get() returned null after set()');
    }
    const parsed = JSON.parse(stored);
    if (parsed.indexName !== TEST_PAYLOAD.indexName || parsed.batchId !== TEST_PAYLOAD.batchId) {
      throw new Error(
        `Payload mismatch: got indexName=${parsed.indexName}, batchId=${parsed.batchId}`,
      );
    }
    log('   OK - get() returned correct payload');

    log('3. Deleting payload...');
    const deleted = await repo.delete(TEST_KEY);
    if (!deleted) {
      throw new Error('delete() returned false');
    }
    log('   OK - delete() succeeded');

    log('4. Verifying key is gone...');
    const afterDelete = await repo.get(TEST_KEY);
    if (afterDelete !== null) {
      throw new Error(`Expected null after delete, got ${afterDelete.length} chars`);
    }
    log('   OK - get() returns null after delete');

    log('');
    log('Persistence payload store validation passed. Safe to run bulk indexing.');
    await app.close();
    process.exit(0);
  } catch (err: any) {
    console.error('Validation failed:', err?.message);
    if (err?.stack) console.error(err.stack);
    await app.close();
    process.exit(1);
  }
}

validate();
