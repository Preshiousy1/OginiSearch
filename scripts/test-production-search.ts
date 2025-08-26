#!/usr/bin/env ts-node

import axios from 'axios';

interface TestQuery {
  query: string;
  expected: string;
  userLocation?: { lat: number; lng: number };
  size?: number;
}

interface TestScenario {
  name: string;
  queries: TestQuery[];
}

/**
 * Production-ready test script for intelligent search
 */
async function testProductionSearch() {
  console.log('🚀 Production Search System Test\n');

  const baseUrl = 'http://localhost:3000';
  const indices = ['businesses', 'listings'];

  // Test scenarios
  const testScenarios: TestScenario[] = [
    {
      name: 'Basic Search',
      queries: [
        { query: 'restaurant', expected: 'Basic business type search' },
        { query: 'apartment', expected: 'Basic property type search' },
        { query: 'hotel', expected: 'Basic accommodation search' },
      ],
    },
    {
      name: 'Location-Based Search',
      queries: [
        { query: 'restaurants in lagos', expected: 'Location-specific search' },
        { query: 'apartments in abuja', expected: 'Location-specific property search' },
        {
          query: 'near me',
          userLocation: { lat: 6.5244, lng: 3.3792 },
          expected: 'Proximity search',
        },
      ],
    },
    {
      name: 'Complex Queries',
      queries: [
        { query: 'restaurant with delivery', expected: 'Service-based search' },
        { query: 'apartment with pool', expected: 'Amenity-based search' },
        { query: 'hotel with parking', expected: 'Feature-based search' },
      ],
    },
    {
      name: 'Performance Test',
      queries: [
        { query: 'restaurant', size: 100, expected: 'Large result set' },
        { query: 'apartment', size: 50, expected: 'Medium result set' },
        { query: 'hotel', size: 10, expected: 'Small result set' },
      ],
    },
  ];

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const scenario of testScenarios) {
    console.log(`📋 ${scenario.name}:`);
    console.log('─'.repeat(50));

    for (const { query, userLocation, size, expected } of scenario.queries) {
      for (const indexName of indices) {
        totalTests++;

        try {
          const startTime = Date.now();

          const response = await axios.post(`${baseUrl}/api/indices/${indexName}/_search`, {
            query,
            size: size || 5,
            userLocation,
          });

          const endTime = Date.now();
          const responseTime = endTime - startTime;
          const results = response.data;

          // Validate response
          const isValid =
            results.data &&
            typeof results.data.total === 'string' &&
            Array.isArray(results.data.hits) &&
            responseTime < 2000; // 2 second timeout

          if (isValid) {
            console.log(
              `✅ ${indexName}: "${query}" → ${results.data.total} results (${responseTime}ms)`,
            );
            passedTests++;
          } else {
            console.log(`❌ ${indexName}: "${query}" → Invalid response (${responseTime}ms)`);
            failedTests++;
          }
        } catch (error) {
          console.log(
            `❌ ${indexName}: "${query}" → Error: ${
              error.response?.data?.message || error.message
            }`,
          );
          failedTests++;
        }
      }
    }
    console.log('');
  }

  // Cache performance test
  console.log('💾 Cache Performance Test:');
  console.log('─'.repeat(50));

  const cacheTestQuery = 'restaurant';
  const cacheTestIndex = 'businesses';

  for (let i = 1; i <= 3; i++) {
    try {
      const startTime = Date.now();

      const response = await axios.post(`${baseUrl}/api/indices/${cacheTestIndex}/_search`, {
        query: cacheTestQuery,
        size: 5,
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      const results = response.data;

      console.log(`Cache Test ${i}: ${results.data.total} results in ${responseTime}ms`);

      if (i === 1) {
        console.log('   (First request - cache miss)');
      } else {
        console.log('   (Subsequent requests - should be cached)');
      }
    } catch (error) {
      console.log(`Cache Test ${i}: Error - ${error.response?.data?.message || error.message}`);
    }
  }

  // Summary
  console.log('\n📊 Test Summary:');
  console.log('─'.repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  if (failedTests === 0) {
    console.log('\n🎉 All tests passed! System is production-ready.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review before production deployment.');
  }
}

// Run the test
testProductionSearch().catch(console.error);
