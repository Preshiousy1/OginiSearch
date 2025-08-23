import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PostgreSQLSearchEngine } from '../../src/storage/postgresql/postgresql-search-engine';
import { PostgreSQLService } from '../../src/storage/postgresql/postgresql.service';

async function measureBulkIndexing() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const searchEngine = app.get(PostgreSQLSearchEngine);
  const postgresService = app.get(PostgreSQLService);

  try {
    console.log('🚀 Starting bulk indexing performance measurement...\n');

    const testSizes = [100, 500, 1000, 5000, 10000];
    const results: Array<{
      documentCount: number;
      indexingTime: number;
      documentsPerSecond: number;
      memoryUsage: number;
    }> = [];

    for (const size of testSizes) {
      console.log(`📊 Testing with ${size} documents...`);

      // Generate test data
      const documents = [];
      for (let i = 0; i < size; i++) {
        documents.push({
          id: `test-doc-${i}`,
          content: {
            title: `Test Business ${i}`,
            description: `This is a test business description for business ${i}. It provides various services and products.`,
            name: `Business ${i}`,
            category: `Category ${i % 10}`,
            tags: [`tag${i}`, `business${i}`, `test${i}`],
          },
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }

      // Measure indexing performance
      const startTime = Date.now();
      const startMemory = process.memoryUsage().heapUsed;

      // Index documents in batches
      const batchSize = 100;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await Promise.all(
          batch.map(doc =>
            searchEngine.indexDocument('businesses', doc.id, {
              ...doc.content,
              ...doc.metadata,
            }),
          ),
        );
      }

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      const indexingTime = endTime - startTime;
      const memoryUsage = endMemory - startMemory;
      const documentsPerSecond = Math.round((size / indexingTime) * 1000);

      results.push({
        documentCount: size,
        indexingTime,
        documentsPerSecond,
        memoryUsage: Math.round(memoryUsage / 1024 / 1024), // MB
      });

      console.log(
        `✅ ${size} documents indexed in ${indexingTime}ms (${documentsPerSecond} docs/sec)`,
      );
      console.log(`💾 Memory usage: ${Math.round(memoryUsage / 1024 / 1024)}MB\n`);
    }

    // Print summary
    console.log('📈 BULK INDEXING PERFORMANCE SUMMARY');
    console.log('=====================================');
    console.log('Documents | Time (ms) | Docs/sec | Memory (MB)');
    console.log('----------|-----------|----------|------------');

    results.forEach(result => {
      console.log(
        `${result.documentCount.toString().padStart(9)} | ${result.indexingTime
          .toString()
          .padStart(9)} | ${result.documentsPerSecond.toString().padStart(8)} | ${result.memoryUsage
          .toString()
          .padStart(10)}`,
      );
    });

    // Calculate averages
    const avgDocsPerSecond = Math.round(
      results.reduce((sum, r) => sum + r.documentsPerSecond, 0) / results.length,
    );
    const avgMemoryUsage = Math.round(
      results.reduce((sum, r) => sum + r.memoryUsage, 0) / results.length,
    );

    console.log('\n📊 AVERAGES:');
    console.log(`Average documents per second: ${avgDocsPerSecond}`);
    console.log(`Average memory usage: ${avgMemoryUsage}MB`);

    // Performance recommendations
    console.log('\n💡 PERFORMANCE RECOMMENDATIONS:');
    if (avgDocsPerSecond < 100) {
      console.log('⚠️  Indexing speed is slow. Consider:');
      console.log('   - Increasing batch sizes');
      console.log('   - Optimizing database indexes');
      console.log('   - Using connection pooling');
    } else if (avgDocsPerSecond > 500) {
      console.log('✅ Indexing speed is excellent!');
    } else {
      console.log('👍 Indexing speed is good. Room for optimization.');
    }

    if (avgMemoryUsage > 100) {
      console.log('⚠️  High memory usage. Consider:');
      console.log('   - Reducing batch sizes');
      console.log('   - Implementing garbage collection');
      console.log('   - Monitoring memory leaks');
    } else {
      console.log('✅ Memory usage is acceptable.');
    }
  } catch (error) {
    console.error('❌ Error during bulk indexing measurement:', error);
  } finally {
    await app.close();
  }
}

// Run the measurement
measureBulkIndexing().catch(console.error);
