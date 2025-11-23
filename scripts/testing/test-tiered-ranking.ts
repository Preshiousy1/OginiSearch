/**
 * Test script for Tiered Ranking Algorithm
 *
 * This script validates that the tiered ranking algorithm correctly orders
 * search results according to the specification:
 *
 * 1. EXACT MATCH (Tier 1):
 *    a. Confirmed businesses (sorted by health)
 *    b. Unconfirmed businesses (sorted by health)
 *
 * 2. CLOSE MATCH (Tier 2):
 *    a. Confirmed businesses (sorted by health)
 *    b. Unconfirmed businesses (sorted by health)
 *
 * 3. OTHER MATCH (Tier 3):
 *    a. Confirmed businesses (sorted by health)
 *    b. Unconfirmed businesses (sorted by health)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/testing/test-tiered-ranking.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { SearchService } from '../../src/search/search.service';
import { SearchQueryDto } from '../../src/api/dtos/search.dto';

interface TestCase {
  name: string;
  query: string;
  indexName: string;
  expectedOrder: {
    tier: 'EXACT' | 'CLOSE' | 'OTHER';
    confirmed: boolean;
    minHealthRange?: [number, number];
  }[];
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Test 1: Exact word match "pencil"',
    query: 'pencil',
    indexName: 'businesses',
    expectedOrder: [
      { tier: 'EXACT', confirmed: true },
      { tier: 'EXACT', confirmed: false },
      { tier: 'CLOSE', confirmed: true },
      { tier: 'CLOSE', confirmed: false },
      { tier: 'OTHER', confirmed: true },
      { tier: 'OTHER', confirmed: false },
    ],
  },
  {
    name: 'Test 2: Close word match "pensil" (typo)',
    query: 'pensil',
    indexName: 'businesses',
    expectedOrder: [
      { tier: 'EXACT', confirmed: true },
      { tier: 'EXACT', confirmed: false },
      { tier: 'CLOSE', confirmed: true },
      { tier: 'CLOSE', confirmed: false },
      { tier: 'OTHER', confirmed: true },
      { tier: 'OTHER', confirmed: false },
    ],
  },
  {
    name: 'Test 3: Generic word "hotel"',
    query: 'hotel',
    indexName: 'businesses',
    expectedOrder: [
      { tier: 'EXACT', confirmed: true },
      { tier: 'EXACT', confirmed: false },
      { tier: 'CLOSE', confirmed: true },
      { tier: 'CLOSE', confirmed: false },
      { tier: 'OTHER', confirmed: true },
      { tier: 'OTHER', confirmed: false },
    ],
  },
  {
    name: 'Test 4: Multi-word "luxury hotel"',
    query: 'luxury hotel',
    indexName: 'businesses',
    expectedOrder: [
      { tier: 'EXACT', confirmed: true },
      { tier: 'EXACT', confirmed: false },
      { tier: 'CLOSE', confirmed: true },
      { tier: 'CLOSE', confirmed: false },
      { tier: 'OTHER', confirmed: true },
      { tier: 'OTHER', confirmed: false },
    ],
  },
];

async function bootstrap() {
  console.log('🚀 Initializing NestJS application...\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const searchService = app.get(SearchService);

  console.log('✅ Application initialized successfully!\n');
  console.log('='.repeat(80));
  console.log('🧪 TIERED RANKING ALGORITHM - TEST SUITE');
  console.log('='.repeat(80));
  console.log();

  let passedTests = 0;
  let failedTests = 0;

  for (const testCase of TEST_CASES) {
    console.log(`\n📋 ${testCase.name}`);
    console.log(`   Query: "${testCase.query}"`);
    console.log(`   Index: ${testCase.indexName}`);
    console.log('-'.repeat(80));

    try {
      const searchQuery: SearchQueryDto = {
        query: testCase.query,
        size: 50, // Get more results to see full tier distribution
      };

      const result = await searchService.search(testCase.indexName, searchQuery);

      if (!result.data?.hits || result.data.hits.length === 0) {
        console.log('   ⚠️  No results found - skipping validation');
        continue;
      }

      console.log(`   ✅ Found ${result.data.hits.length} results in ${result.took}ms\n`);

      // Analyze tier distribution
      const tierStats = {
        exact: { confirmed: 0, unconfirmed: 0 },
        close: { confirmed: 0, unconfirmed: 0 },
        other: { confirmed: 0, unconfirmed: 0 },
      };

      const topResults = result.data.hits.slice(0, 10);
      console.log('   🏆 Top 10 Results:');
      console.log('   ' + '-'.repeat(76));
      console.log('   Rank | Name                     | Tier  | Confirmed | Health | Score');
      console.log('   ' + '-'.repeat(76));

      for (let i = 0; i < topResults.length; i++) {
        const hit = topResults[i];
        const source = hit.source || hit;
        const rankings = hit.rankingScores || {};

        const name = (source.name || 'Unknown').substring(0, 24).padEnd(24);
        const tier = (rankings.tier || 'N/A').padEnd(5);
        const confirmed = rankings.isConfirmed ? 'Yes' : 'No ';
        const health = (rankings.health || 0).toFixed(0).padStart(6);
        const score = (rankings.finalScore || 0).toFixed(0).padStart(7);

        console.log(
          `   ${(i + 1).toString().padStart(4)} | ${name} | ${tier} | ${confirmed.padEnd(
            9,
          )} | ${health} | ${score}`,
        );

        // Collect stats
        const tierKey = rankings.tier?.toLowerCase() || 'other';
        const confirmedKey = rankings.isConfirmed ? 'confirmed' : 'unconfirmed';
        if (tierStats[tierKey]) {
          tierStats[tierKey][confirmedKey]++;
        }
      }

      console.log('   ' + '-'.repeat(76));
      console.log();
      console.log('   📊 Tier Distribution (all results):');

      for (const hit of result.data.hits) {
        const rankings = hit.rankingScores || {};
        const tierKey = rankings.tier?.toLowerCase() || 'other';
        const confirmedKey = rankings.isConfirmed ? 'confirmed' : 'unconfirmed';
        if (tierStats[tierKey]) {
          tierStats[tierKey][confirmedKey]++;
        }
      }

      console.log(
        `      EXACT:  Confirmed=${tierStats.exact.confirmed}, Unconfirmed=${tierStats.exact.unconfirmed}`,
      );
      console.log(
        `      CLOSE:  Confirmed=${tierStats.close.confirmed}, Unconfirmed=${tierStats.close.unconfirmed}`,
      );
      console.log(
        `      OTHER:  Confirmed=${tierStats.other.confirmed}, Unconfirmed=${tierStats.other.unconfirmed}`,
      );

      // Validate ordering
      console.log('\n   🔍 Validating ordering...');
      const orderingValid = validateOrdering(result.data.hits);

      if (orderingValid) {
        console.log('   ✅ PASS: Results are correctly ordered by tier → confirmation → health');
        passedTests++;
      } else {
        console.log('   ❌ FAIL: Ordering does not match expected pattern');
        failedTests++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL: ${error.message}`);
      failedTests++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📈 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`   Total Tests: ${passedTests + failedTests}`);
  console.log(`   ✅ Passed: ${passedTests}`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log('='.repeat(80));
  console.log();

  await app.close();
  process.exit(failedTests > 0 ? 1 : 0);
}

/**
 * Validate that results are correctly ordered
 */
function validateOrdering(hits: any[]): boolean {
  let currentTier = 3; // Start with EXACT (highest)
  let currentConfirmed = true; // Start with confirmed
  let previousHealth = 100; // Start with max health

  for (const hit of hits) {
    const rankings = hit.rankingScores || {};
    const tier = rankings.matchQuality || 1;
    const isConfirmed = rankings.isConfirmed || false;
    const health = rankings.health || 0;

    // Check tier ordering (EXACT=3 > CLOSE=2 > OTHER=1)
    if (tier > currentTier) {
      console.log(`      ❌ Tier violation: Found tier ${tier} after tier ${currentTier}`);
      return false;
    }

    if (tier < currentTier) {
      // Moving to lower tier - reset confirmation and health
      currentTier = tier;
      currentConfirmed = true;
      previousHealth = 100;
    }

    // Within same tier, check confirmation ordering
    if (tier === currentTier) {
      if (!isConfirmed && currentConfirmed) {
        // Moving from confirmed to unconfirmed - reset health
        currentConfirmed = false;
        previousHealth = 100;
      } else if (isConfirmed && !currentConfirmed) {
        console.log(
          `      ❌ Confirmation violation: Found confirmed after unconfirmed in same tier`,
        );
        return false;
      }

      // Within same confirmation status, check health ordering (descending)
      if (isConfirmed === currentConfirmed) {
        if (health > previousHealth + 1) {
          // Allow small tolerance for rounding
          console.log(
            `      ❌ Health violation: Health ${health} > ${previousHealth} within same tier/confirmation`,
          );
          return false;
        }
        previousHealth = health;
      }
    }
  }

  return true;
}

// Run the test suite
bootstrap().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
