/**
 * Migration: Ensure term_postings uses chunked model (chunkIndex, max 5000 postings per doc).
 * 1) Set chunkIndex: 0 on any doc missing it.
 * 2) Split any single doc with >5000 postings into multiple chunk docs.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/migrate-term-postings-to-chunked.ts
 * Requires MONGODB_URI.
 */
import { config } from 'dotenv';
import * as path from 'path';
import { connect, connection, model, Schema } from 'mongoose';

config({ path: path.resolve(__dirname, '../.env') });

const MAX_POSTINGS_PER_CHUNK = 5000;

const TermPostingsSchema = new Schema(
  {
    indexName: String,
    term: String,
    chunkIndex: { type: Number, default: 0 },
    postings: Object,
    documentCount: Number,
    lastUpdated: Date,
  },
  { collection: 'term_postings', strict: false },
);

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Set MONGODB_URI');
    process.exit(1);
  }
  await connect(uri);
  const TermPostings = model('TermPostings', TermPostingsSchema);

  // 1) Add chunkIndex: 0 where missing
  const withoutChunk = await TermPostings.updateMany(
    { chunkIndex: { $exists: false } },
    { $set: { chunkIndex: 0 } },
  );
  console.log(`Set chunkIndex: 0 on ${withoutChunk.modifiedCount} docs`);

  // 2) Find docs with > MAX_POSTINGS_PER_CHUNK postings (single doc that needs splitting)
  const cursor = TermPostings.find({}).cursor();
  let splitCount = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const postings = doc.postings as Record<string, unknown>;
    const keys = postings ? Object.keys(postings) : [];
    if (keys.length <= MAX_POSTINGS_PER_CHUNK) continue;

    const indexName = doc.indexName;
    const term = doc.term;
    const chunkIndex = typeof doc.chunkIndex === 'number' ? doc.chunkIndex : 0;
    const now = new Date();

    const entries = Object.entries(postings);
    const chunks: Record<string, unknown>[] = [];
    for (let i = 0; i < entries.length; i += MAX_POSTINGS_PER_CHUNK) {
      chunks.push(Object.fromEntries(entries.slice(i, i + MAX_POSTINGS_PER_CHUNK)));
    }

    // If this doc is already chunk 0 and we have multiple chunks, write chunks 1..n and replace chunk 0
    await TermPostings.deleteOne({ _id: doc._id });
    for (let c = 0; c < chunks.length; c++) {
      await TermPostings.create({
        indexName,
        term,
        chunkIndex: c,
        postings: chunks[c],
        documentCount: Object.keys(chunks[c]).length,
        lastUpdated: now,
      });
    }
    splitCount++;
    console.log(`Split term ${term} into ${chunks.length} chunks`);
  }

  console.log(`Split ${splitCount} terms into chunks`);
  await connection.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
