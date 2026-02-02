import * as fs from 'fs';
import * as path from 'path';

// Configuration: override with BULK_DOC_COUNT env (e.g. BULK_DOC_COUNT=50000)
const NUM_DOCUMENTS = Number(process.env.BULK_DOC_COUNT) || 10000;
const OUTPUT_FILE = path.join(__dirname, '../../data/bulk-test-data.json');

// Ensure data directory exists
const dataDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Generate random text
function generateRandomText(wordCount: number): string {
  const words = [
    'smart',
    'search',
    'engine',
    'fast',
    'efficient',
    'scalable',
    'reliable',
    'document',
    'index',
    'query',
    'analyze',
    'process',
    'data',
    'information',
    'system',
    'performance',
    'optimize',
    'concurrent',
    'worker',
    'thread',
    'memory',
    'storage',
    'database',
    'cache',
    'queue',
    'stream',
    'batch',
    'bulk',
    'real-time',
    'distributed',
    'cluster',
    'node',
    'service',
    'api',
    'rest',
    'http',
    'json',
    'protocol',
    'network',
    'client',
    'server',
    'request',
    'response',
    'latency',
    'throughput',
    'capacity',
    'load',
    'test',
    'monitor',
    'log',
    'debug',
    'error',
    'success',
    'fail',
  ];

  return Array.from(
    { length: wordCount },
    () => words[Math.floor(Math.random() * words.length)],
  ).join(' ');
}

// Generate a test document
function generateDocument(id: number) {
  return {
    id: `doc${id}`,
    document: {
      title: generateRandomText(5),
      content: generateRandomText(50),
      tags: Array.from({ length: 3 }, () => generateRandomText(1)),
      metadata: {
        author: `user${Math.floor(Math.random() * 10)}`,
        createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        views: Math.floor(Math.random() * 1000),
        score: Math.random() * 100,
      },
    },
  };
}

// Generate documents
console.log(`Generating ${NUM_DOCUMENTS} test documents...`);
const documents = Array.from({ length: NUM_DOCUMENTS }, (_, i) => generateDocument(i));

// Write to file in the correct format for bulk indexing
fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ documents }, null, 2));
console.log(`Test data written to ${OUTPUT_FILE} (${NUM_DOCUMENTS} documents)`);
