/**
 * Comprehensive Integration Test for Tiered Ranking
 *
 * This test validates that:
 * 1. TieredRankingService is properly injected and used
 * 2. Search results are correctly classified into tiers
 * 3. Results are ordered according to specification
 * 4. Ranking metadata is present in responses
 * 5. Performance is acceptable
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/testing/test-tiered-ranking-integration.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { SearchService } from '../../src/search/search.service';
import { TieredRankingService } from '../../src/search/services/tiered-ranking.service';
import { MatchQualityClassifierService } from '../../src/search/services/match-quality-classifier.service';
import { SearchQueryDto } from '../../src/api/dtos/search.dto';

interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  timing?: number;
}

async function bootstrap() {
  console.log('🚀 Starting Tiered Ranking Integration Test...\n');
  console.log('='.repeat(80));
  console.log('🧪 TIERED RANKING - COMPREHENSIVE INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const results: TestResult[] = [];

  // ========================================================================
  // TEST 1: Verify Services Are Registered
  // ========================================================================
  console.log('📋 TEST 1: Verifying service registration...');
  try {
    const searchService = app.get(SearchService);
    const tieredRankingService = app.get(TieredRankingService);
    const classifierService = app.get(MatchQualityClassifierService);

    if (!searchService) throw new Error('SearchService not registered');
    if (!tieredRankingService) throw new Error('TieredRankingService not registered');
    if (!classifierService) throw new Error('MatchQualityClassifierService not registered');

    results.push({
      testName: 'Service Registration',
      passed: true,
      details: 'All services properly registered in DI container',
    });
    console.log('   ✅ PASS: All services registered correctly\n');
  } catch (error) {
    results.push({
      testName: 'Service Registration',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ❌ FAIL: ${error.message}\n`);
  }

  // ========================================================================
  // TEST 2: Verify SearchService Uses TieredRankingService
  // ========================================================================
  console.log('📋 TEST 2: Verifying SearchService uses TieredRankingService...');
  try {
    const searchService = app.get(SearchService) as any;

    // Check if tieredRankingService is injected
    if (!searchService.tieredRankingService) {
      throw new Error('TieredRankingService not injected into SearchService');
    }

    results.push({
      testName: 'Service Injection',
      passed: true,
      details: 'TieredRankingService properly injected into SearchService',
    });
    console.log('   ✅ PASS: TieredRankingService is injected and accessible\n');
  } catch (error) {
    results.push({
      testName: 'Service Injection',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ❌ FAIL: ${error.message}\n`);
  }

  // ========================================================================
  // TEST 3: Test Match Quality Classification
  // ========================================================================
  console.log('📋 TEST 3: Testing match quality classification...');
  try {
    const classifierService = app.get(MatchQualityClassifierService);

    // Test exact match
    const exactResult = {
      source: { name: 'Pencil Store' },
      score: 5.0,
    };
    const exactClassification = classifierService.classifyMatchQuality(exactResult, 'pencil');

    if (exactClassification.tier !== 3) {
      // MatchQualityTier.EXACT_MATCH = 3
      throw new Error(`Expected EXACT tier (3), got ${exactClassification.tier}`);
    }

    // Test close match (typo)
    const closeResult = {
      source: { name: 'Pensil Store' },
      score: 3.0,
    };
    const closeClassification = classifierService.classifyMatchQuality(closeResult, 'pencil');

    if (closeClassification.tier !== 2) {
      // MatchQualityTier.CLOSE_MATCH = 2
      throw new Error(`Expected CLOSE tier (2), got ${closeClassification.tier}`);
    }

    // Test other match
    const otherResult = {
      source: { name: 'Office Supplies' },
      score: 1.5,
    };
    const otherClassification = classifierService.classifyMatchQuality(otherResult, 'pencil');

    if (otherClassification.tier !== 1) {
      // MatchQualityTier.OTHER_MATCH = 1
      throw new Error(`Expected OTHER tier (1), got ${otherClassification.tier}`);
    }

    results.push({
      testName: 'Match Quality Classification',
      passed: true,
      details: 'All match types classified correctly (EXACT/CLOSE/OTHER)',
    });
    console.log('   ✅ PASS: Classification working correctly');
    console.log('      • EXACT: "Pencil Store" for query "pencil"');
    console.log('      • CLOSE: "Pensil Store" for query "pencil"');
    console.log('      • OTHER: "Office Supplies" for query "pencil"\n');
  } catch (error) {
    results.push({
      testName: 'Match Quality Classification',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ❌ FAIL: ${error.message}\n`);
  }

  // ========================================================================
  // TEST 4: Test Tiered Ranking Order
  // ========================================================================
  console.log('📋 TEST 4: Testing tiered ranking order...');
  try {
    const tieredRankingService = app.get(TieredRankingService);

    const mockResults = [
      // Should rank 3rd (EXACT, unconfirmed, health 98)
      {
        id: 'b3',
        source: {
          name: 'Office Pencil',
          health: 98,
          rating: 5.0,
          is_verified: false,
          updatedAt: new Date(),
        },
        score: 5.0,
      },
      // Should rank 5th (OTHER, confirmed, health 100)
      {
        id: 'b5',
        source: {
          name: 'Office Supplies',
          health: 100,
          rating: 5.0,
          is_verified: true,
          verified_at: new Date(),
          updatedAt: new Date(),
        },
        score: 1.5,
      },
      // Should rank 4th (CLOSE, confirmed, health 100)
      {
        id: 'b4',
        source: {
          name: 'Pensil Store',
          health: 100,
          rating: 5.0,
          is_verified: true,
          verified_at: new Date(),
          updatedAt: new Date(),
        },
        score: 3.5,
      },
      // Should rank 1st (EXACT, confirmed, health 90)
      {
        id: 'b1',
        source: {
          name: 'Pencil Store',
          health: 90,
          rating: 4.0,
          is_verified: true,
          verified_at: new Date(),
          updatedAt: new Date(),
        },
        score: 5.5,
      },
      // Should rank 2nd (EXACT, confirmed, health 85)
      {
        id: 'b2',
        source: {
          name: 'The Pencil Shop',
          health: 85,
          rating: 3.5,
          is_verified: true,
          verified_at: new Date(),
          updatedAt: new Date(),
        },
        score: 5.2,
      },
    ];

    const rankedResults = await tieredRankingService.rankResults(mockResults, 'pencil');

    // Verify order
    const expectedOrder = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const actualOrder = rankedResults.map(r => r.id);

    let orderCorrect = true;
    for (let i = 0; i < expectedOrder.length; i++) {
      if (expectedOrder[i] !== actualOrder[i]) {
        orderCorrect = false;
        break;
      }
    }

    if (!orderCorrect) {
      throw new Error(
        `Order incorrect. Expected: ${expectedOrder.join(', ')}. Got: ${actualOrder.join(', ')}`,
      );
    }

    // Verify ranking metadata is present
    for (const result of rankedResults) {
      if (!result.rankingScores) {
        throw new Error('Ranking metadata missing from results');
      }
      if (result.rankingScores.finalScore === undefined) {
        throw new Error('finalScore missing from ranking metadata');
      }
      if (result.rankingScores.matchQuality === undefined) {
        throw new Error('matchQuality missing from ranking metadata');
      }
    }

    results.push({
      testName: 'Tiered Ranking Order',
      passed: true,
      details: 'Results correctly ordered by tier → confirmation → health',
    });
    console.log('   ✅ PASS: Ranking order is correct');
    console.log('      Order: b1 → b2 → b3 → b4 → b5');
    console.log('      1. Pencil Store (EXACT, confirmed, health 90)');
    console.log('      2. The Pencil Shop (EXACT, confirmed, health 85)');
    console.log('      3. Office Pencil (EXACT, unconfirmed, health 98)');
    console.log('      4. Pensil Store (CLOSE, confirmed, health 100)');
    console.log('      5. Office Supplies (OTHER, confirmed, health 100)\n');
  } catch (error) {
    results.push({
      testName: 'Tiered Ranking Order',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ❌ FAIL: ${error.message}\n`);
  }

  // ========================================================================
  // TEST 5: Test Real Search Integration (if data available)
  // ========================================================================
  console.log('📋 TEST 5: Testing real search integration...');
  try {
    const searchService = app.get(SearchService);
    const startTime = Date.now();

    const searchQuery: SearchQueryDto = {
      query: 'hotel',
      size: 10,
    };

    let searchResult;
    try {
      searchResult = await searchService.search('businesses', searchQuery);
    } catch (error) {
      // If search fails (no data, no index), that's okay for this test
      throw new Error(`Search execution failed: ${error.message}`);
    }

    const timing = Date.now() - startTime;

    // Verify ranking metadata is present in real results
    if (searchResult.data.hits.length > 0) {
      const firstHit = searchResult.data.hits[0];

      if (!firstHit.rankingScores) {
        throw new Error('Real search results missing ranking metadata');
      }

      if (firstHit.rankingScores.matchQuality === undefined) {
        throw new Error('Real search results missing matchQuality');
      }

      if (firstHit.rankingScores.tier === undefined) {
        throw new Error('Real search results missing tier information');
      }

      // Log tier distribution
      const tiers = { exact: 0, close: 0, other: 0 };
      for (const hit of searchResult.data.hits) {
        const tier = hit.rankingScores?.tier;
        if (tier) {
          const tierName = tier.toLowerCase();
          if (tierName.includes('exact')) tiers.exact++;
          else if (tierName.includes('close')) tiers.close++;
          else tiers.other++;
        }
      }

      results.push({
        testName: 'Real Search Integration',
        passed: true,
        details: `Found ${searchResult.data.hits.length} results with correct metadata. Tiers: Exact=${tiers.exact}, Close=${tiers.close}, Other=${tiers.other}`,
        timing,
      });
      console.log('   ✅ PASS: Real search working with tiered ranking');
      console.log(`      • Found ${searchResult.data.hits.length} results in ${timing}ms`);
      console.log(
        `      • Tier distribution: Exact=${tiers.exact}, Close=${tiers.close}, Other=${tiers.other}`,
      );

      if (searchResult.data.hits.length >= 3) {
        console.log('      • Top 3 results:');
        for (let i = 0; i < 3; i++) {
          const hit = searchResult.data.hits[i];
          const name = hit.source?.name || 'Unknown';
          const tier = hit.rankingScores?.tier || 'Unknown';
          const health = hit.rankingScores?.health || 0;
          console.log(`        ${i + 1}. ${name} (${tier}, health: ${health})`);
        }
      }
      console.log();
    } else {
      results.push({
        testName: 'Real Search Integration',
        passed: true,
        details: 'Search executed successfully but no results found (empty index)',
        timing,
      });
      console.log('   ✅ PASS: Search executed (no results - empty index)');
      console.log(`      • Search completed in ${timing}ms\n`);
    }
  } catch (error) {
    results.push({
      testName: 'Real Search Integration',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ⚠️  SKIP: ${error.message}`);
    console.log('      (This is OK if index is empty or not created yet)\n');
  }

  // ========================================================================
  // TEST 6: Test Performance
  // ========================================================================
  console.log('📋 TEST 6: Testing performance...');
  try {
    const tieredRankingService = app.get(TieredRankingService);

    // Generate 100 mock results
    const mockResults = [];
    for (let i = 0; i < 100; i++) {
      mockResults.push({
        id: `business-${i}`,
        source: {
          name: i % 10 === 0 ? `Pencil Store ${i}` : `Business ${i}`,
          health: Math.floor(Math.random() * 100),
          rating: Math.random() * 5,
          is_verified: Math.random() > 0.5,
          verified_at: Math.random() > 0.5 ? new Date() : null,
          updatedAt: new Date(),
        },
        score: Math.random() * 10,
      });
    }

    const startTime = Date.now();
    await tieredRankingService.rankResults(mockResults, 'pencil');
    const timing = Date.now() - startTime;

    if (timing > 25) {
      throw new Error(`Performance too slow: ${timing}ms (target: < 25ms for 100 results)`);
    }

    results.push({
      testName: 'Performance',
      passed: true,
      details: `Ranked 100 results in ${timing}ms (target: < 25ms)`,
      timing,
    });
    console.log(`   ✅ PASS: Performance acceptable (${timing}ms for 100 results)\n`);
  } catch (error) {
    results.push({
      testName: 'Performance',
      passed: false,
      details: `Failed: ${error.message}`,
    });
    console.log(`   ❌ FAIL: ${error.message}\n`);
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();

  const passedTests = results.filter(r => r.passed).length;
  const totalTests = results.length;

  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}`);
  console.log();

  for (const result of results) {
    const status = result.passed ? '✅' : '❌';
    const timing = result.timing ? ` (${result.timing}ms)` : '';
    console.log(`${status} ${result.testName}${timing}`);
    console.log(`   ${result.details}`);
  }

  console.log();
  console.log('='.repeat(80));

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED! Tiered ranking is fully integrated and working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please review the failures above.');
  }

  console.log('='.repeat(80));
  console.log();

  await app.close();
  process.exit(passedTests === totalTests ? 0 : 1);
}

bootstrap().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
