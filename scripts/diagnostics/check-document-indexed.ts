#!/usr/bin/env ts-node
/**
 * Checks if a document is indexed in the term_postings for an index.
 * Useful to debug why a document doesn't appear in search results.
 *
 * Usage: npx ts-node -r tsconfig-paths/register scripts/diagnostics/check-document-indexed.ts [indexName] [documentId]
 * Example: npx ts-node -r tsconfig-paths/register scripts/diagnostics/check-document-indexed.ts listings 40654
 */

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { MongoDBModule } from '../../src/storage/mongodb/mongodb.module';
import { TermPostingsRepository } from '../../src/storage/mongodb/repositories/term-postings.repository';
import { TermPostings } from '../../src/storage/mongodb/schemas/term-postings.schema';

const INDEX_NAME = process.argv[2] || 'listings';
const DOCUMENT_ID = process.argv[3] || '40654';

function log(msg: string) {
  console.log(msg);
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MongoDBModule],
})
class CheckDocumentIndexedModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(CheckDocumentIndexedModule, {
    logger: false,
  });

  try {
    const termPostingsRepo = app.get(TermPostingsRepository);
    const termPostingsModel = app.get(getModelToken(TermPostings.name));

    log(`\n=== Checking if document ${DOCUMENT_ID} is indexed in index "${INDEX_NAME}" ===\n`);

    // 1. Find all terms that contain this documentId in their postings
    const termsWithDoc = await termPostingsModel
      .find({
        indexName: INDEX_NAME,
        [`postings.${DOCUMENT_ID}`]: { $exists: true },
      })
      .select('term chunkIndex documentCount')
      .lean()
      .exec();

    if (termsWithDoc.length === 0) {
      log(`❌ Document ${DOCUMENT_ID} is NOT in any term postings for index "${INDEX_NAME}".`);
      log(`   The document was either never indexed or its terms were never persisted to MongoDB.`);
    } else {
      log(`✅ Document ${DOCUMENT_ID} IS indexed. Found in ${termsWithDoc.length} term(s):`);
      for (const t of termsWithDoc) {
        log(`   - ${(t as any).term} (chunk ${(t as any).chunkIndex})`);
      }
    }

    // 2. For a wildcard like "test*", what terms would we get?
    log(`\n--- Terms matching "test*" for index "${INDEX_NAME}" ---`);
    const testTerms = await termPostingsRepo.findTermKeysByIndexAndValuePrefix(INDEX_NAME, 'test');
    log(`   Found ${testTerms.length} terms`);

    // 3. Is document in any of those test* terms?
    let foundInTestTerms = false;
    for (const term of testTerms) {
      const merged = await termPostingsRepo.findByIndexAwareTerm(term);
      if (merged && merged.postings[DOCUMENT_ID]) {
        log(`   ✅ Doc ${DOCUMENT_ID} is in term: ${term}`);
        foundInTestTerms = true;
      }
    }
    if (!foundInTestTerms && testTerms.length > 0) {
      log(
        `   ❌ Doc ${DOCUMENT_ID} is NOT in any of the ${testTerms.length} "test*" terms. ` +
          `A wildcard "test*" search will not return this document.`,
      );
    } else if (testTerms.length === 0) {
      log(`   No "test*" terms found for this index.`);
    }

    log('\n');
    await app.close();
    process.exit(0);
  } catch (err: any) {
    console.error('Error:', err.message);
    await app.close();
    process.exit(1);
  }
}

main();
