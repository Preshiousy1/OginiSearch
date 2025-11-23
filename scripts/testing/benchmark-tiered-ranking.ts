/**
 * Performance Benchmark for Tiered Ranking Algorithm
 *
 * This script measures the performance characteristics of the tiered ranking
 * algorithm to ensure it meets speed requirements:
 * - < 10ms for small result sets (1-20)
 * - < 25ms for medium result sets (20-100)
 * - < 60ms for large result sets (100-500)
 * - < 150ms for very large result sets (500+)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/testing/benchmark-tiered-ranking.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { TieredRankingService } from '../../src/search/services/tiered-ranking.service';

interface PerformanceMetrics {
  resultSetSize: number;
  iterations: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p50Time: number;
  p95Time: number;
  p99Time: number;
  target: number;
  passed: boolean;
}

/**
 * Generate mock search results for performance testing
 */
function generateMockResults(count: number): any[] {
  const results = [];
  const businessNames = [
    'Pencil Store',
    'The Pencil Shop',
    'Office Pencil Supply',
    'Pensil Store',
    'Pencils and Pens',
    'Stationery Store',
    'Office Supplies',
    'Business Center',
    'School Supplies',
    'Art Supply Store',
  ];

  for (let i = 0; i < count; i++) {
    const nameIndex = i % businessNames.length;
    const variation = Math.floor(i / businessNames.length);

    results.push({
      id: `business-${i}`,
      score: Math.random() * 10 + 1, // BM25 score 1-11
      source: {
        name: businessNames[nameIndex] + (variation > 0 ? ` ${variation}` : ''),
        health: Math.floor(Math.random() * 100),
        rating: Math.random() * 5,
        average_rating: Math.random() * 5,
        is_verified: Math.random() > 0.5,
        verified_at: Math.random() > 0.5 ? new Date() : null,
        is_featured: Math.random() > 0.9,
        updatedAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
      },
    });
  }

  return results;
}

/**
 * Run performance benchmark for a specific result set size
 */
async function benchmarkSize(
  service: TieredRankingService,
  size: number,
  iterations: number,
  target: number,
): Promise<PerformanceMetrics> {
  const times: number[] = [];
  const mockResults = generateMockResults(size);
  const query = 'pencil';

  console.log(`   Running ${iterations} iterations for size ${size}...`);

  // Warm-up run (not counted)
  await service.rankResults(mockResults, query);

  // Actual benchmark runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await service.rankResults(mockResults, query);
    const end = performance.now();
    times.push(end - start);
  }

  // Calculate statistics
  times.sort((a, b) => a - b);
  const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const p50Time = times[Math.floor(times.length * 0.5)];
  const p95Time = times[Math.floor(times.length * 0.95)];
  const p99Time = times[Math.floor(times.length * 0.99)];

  return {
    resultSetSize: size,
    iterations,
    avgTime: Math.round(avgTime * 100) / 100,
    minTime: Math.round(minTime * 100) / 100,
    maxTime: Math.round(maxTime * 100) / 100,
    p50Time: Math.round(p50Time * 100) / 100,
    p95Time: Math.round(p95Time * 100) / 100,
    p99Time: Math.round(p99Time * 100) / 100,
    target,
    passed: p95Time <= target,
  };
}

async function bootstrap() {
  console.log('🚀 Initializing NestJS application...\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const tieredRankingService = app.get(TieredRankingService);

  console.log('✅ Application initialized successfully!\n');
  console.log('='.repeat(90));
  console.log('⚡ TIERED RANKING ALGORITHM - PERFORMANCE BENCHMARK');
  console.log('='.repeat(90));
  console.log();

  const benchmarks = [
    { size: 10, iterations: 1000, target: 10 },
    { size: 20, iterations: 1000, target: 10 },
    { size: 50, iterations: 500, target: 25 },
    { size: 100, iterations: 500, target: 25 },
    { size: 200, iterations: 200, target: 60 },
    { size: 500, iterations: 100, target: 60 },
    { size: 1000, iterations: 50, target: 150 },
  ];

  const results: PerformanceMetrics[] = [];

  for (const benchmark of benchmarks) {
    console.log(
      `\n📊 Benchmarking ${benchmark.size} results (${benchmark.iterations} iterations)...`,
    );
    const metrics = await benchmarkSize(
      tieredRankingService,
      benchmark.size,
      benchmark.iterations,
      benchmark.target,
    );
    results.push(metrics);
    console.log(`   ✅ Complete`);
  }

  // Display results
  console.log('\n' + '='.repeat(90));
  console.log('📈 PERFORMANCE RESULTS');
  console.log('='.repeat(90));
  console.log();
  console.log(
    'Size  | Iterations | Avg    | Min    | P50    | P95    | P99    | Max    | Target | Pass',
  );
  console.log('-'.repeat(90));

  let allPassed = true;
  for (const metric of results) {
    const status = metric.passed ? '✅' : '❌';
    const highlight = metric.passed ? '' : '⚠️ ';
    console.log(
      `${highlight}${metric.resultSetSize.toString().padStart(5)} | ` +
        `${metric.iterations.toString().padStart(10)} | ` +
        `${metric.avgTime.toFixed(2).padStart(6)}ms | ` +
        `${metric.minTime.toFixed(2).padStart(6)}ms | ` +
        `${metric.p50Time.toFixed(2).padStart(6)}ms | ` +
        `${metric.p95Time.toFixed(2).padStart(6)}ms | ` +
        `${metric.p99Time.toFixed(2).padStart(6)}ms | ` +
        `${metric.maxTime.toFixed(2).padStart(6)}ms | ` +
        `${metric.target.toString().padStart(6)}ms | ` +
        status,
    );

    if (!metric.passed) {
      allPassed = false;
    }
  }

  console.log('-'.repeat(90));
  console.log();

  // Summary
  console.log('='.repeat(90));
  console.log('📋 SUMMARY');
  console.log('='.repeat(90));

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  console.log(`\n   Performance Tests: ${passedCount}/${totalCount} passed`);

  if (allPassed) {
    console.log('   ✅ All performance targets met!');
    console.log('   🎉 Tiered ranking algorithm is production-ready for speed requirements');
  } else {
    console.log('   ⚠️  Some performance targets not met');
    console.log('   💡 Consider optimizations for larger result sets');
  }

  // Performance insights
  console.log('\n   📊 Key Insights:');
  const size10 = results.find(r => r.resultSetSize === 10);
  const size100 = results.find(r => r.resultSetSize === 100);
  const size1000 = results.find(r => r.resultSetSize === 1000);

  if (size10) {
    console.log(`      • Small sets (10 results): ${size10.avgTime.toFixed(2)}ms average`);
  }
  if (size100) {
    console.log(`      • Medium sets (100 results): ${size100.avgTime.toFixed(2)}ms average`);
  }
  if (size1000) {
    console.log(`      • Large sets (1000 results): ${size1000.avgTime.toFixed(2)}ms average`);
  }

  const avgOverhead = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;
  console.log(`      • Overall average latency: ${avgOverhead.toFixed(2)}ms`);

  console.log('\n' + '='.repeat(90));
  console.log();

  await app.close();
  process.exit(allPassed ? 0 : 1);
}

// Run the benchmark
bootstrap().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
