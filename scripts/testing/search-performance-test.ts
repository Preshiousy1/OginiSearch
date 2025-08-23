import axios from 'axios';

const API_BASE = 'http://localhost:3000';

interface SearchTest {
  name: string;
  query: string;
  description: string;
  size?: number;
  from?: number;
}

const searchTests: SearchTest[] = [
  {
    name: 'Wildcard Query - house* (Page 1)',
    query: 'house*',
    description: 'Wildcard search for businesses containing "house" - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Wildcard Query - house* (Page 2)',
    query: 'house*',
    description: 'Wildcard search for businesses containing "house" - second page',
    size: 10,
    from: 10,
  },
  {
    name: 'Wildcard Query - tech* (Large Page)',
    query: 'tech*',
    description: 'Wildcard search with larger page size',
    size: 50,
    from: 0,
  },
  {
    name: 'Wildcard Query - *limited (Page 1)',
    query: '*limited',
    description: 'Wildcard search for businesses ending with "limited" - first page',
    size: 20,
    from: 0,
  },
  {
    name: 'Wildcard Query - *limited (Page 10)',
    query: '*limited',
    description: 'Wildcard search for businesses ending with "limited" - page 10',
    size: 20,
    from: 200,
  },
  {
    name: 'Simple Text Search - hotel (Page 1)',
    query: 'hotel',
    description: 'Simple text search for "hotel" - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Simple Text Search - hotel (Page 5)',
    query: 'hotel',
    description: 'Simple text search for "hotel" - page 5',
    size: 10,
    from: 50,
  },
  {
    name: 'Match All Query (Page 1)',
    query: '*',
    description: 'Return all documents - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Match All Query (Page 100)',
    query: '*',
    description: 'Return all documents - page 100',
    size: 10,
    from: 1000,
  },
  {
    name: 'Business Name Search - restaurant (Page 1)',
    query: 'restaurant',
    description: 'Search for "restaurant" in business names - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Complex Wildcard - *services* (Page 1)',
    query: '*services*',
    description: 'Wildcard search containing "services" - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Business Name Search - limited (Page 1)',
    query: 'limited',
    description: 'Search for "limited" in business names - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Category Search - hospitality (Page 1)',
    query: 'hospitality',
    description: 'Search for "hospitality" category - first page',
    size: 10,
    from: 0,
  },
  {
    name: 'Profile Search - beauty (Page 1)',
    query: 'beauty',
    description: 'Search for "beauty" in profiles - first page',
    size: 10,
    from: 0,
  },
];

async function runSearchTest(test: SearchTest, indexName = 'businesses') {
  const startTime = Date.now();

  try {
    const response = await axios.post(`${API_BASE}/api/indices/${indexName}/_search`, {
      query: test.query,
      size: test.size || 10,
      from: test.from || 0,
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    const result = {
      test: test.name,
      description: test.description,
      duration: `${duration}ms`,
      totalHits: response.data.data?.total || 0,
      hitsReturned: response.data.data?.hits?.length || 0,
      pageSize: test.size || 10,
      pageOffset: test.from || 0,
      currentPage: response.data.pagination?.currentPage || 1,
      totalPages: response.data.pagination?.totalPages || 0,
      success: true,
      sampleResults:
        response.data.data?.hits?.slice(0, 3).map((hit: any) => ({
          id: hit.id,
          name: hit.source?.name || 'N/A',
          score: hit.score,
        })) || [],
    };

    console.log(`✅ ${test.name}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Total Hits: ${result.totalHits}`);
    console.log(
      `   Results: ${result.hitsReturned} (Page ${result.currentPage}/${result.totalPages})`,
    );
    console.log(`   Sample: ${result.sampleResults.map(r => r.name).join(', ')}`);
    console.log('');

    return result;
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`❌ ${test.name}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Error: ${error.response?.data?.message || error.message}`);
    console.log('');

    return {
      test: test.name,
      description: test.description,
      duration: `${duration}ms`,
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

async function runPerformanceTest() {
  console.log('🚀 Starting Search Performance Test with Pagination');
  console.log('==================================================\n');

  const results = [];

  for (const test of searchTests) {
    const result = await runSearchTest(test);
    results.push(result);

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Summary
  console.log('📊 PERFORMANCE SUMMARY');
  console.log('======================');

  const successfulTests = results.filter(r => r.success);
  const failedTests = results.filter(r => !r.success);

  console.log(`✅ Successful Tests: ${successfulTests.length}/${results.length}`);
  console.log(`❌ Failed Tests: ${failedTests.length}/${results.length}`);

  if (successfulTests.length > 0) {
    const avgDuration =
      successfulTests.reduce((sum, test) => {
        const duration = parseInt(test.duration.replace('ms', ''));
        return sum + duration;
      }, 0) / successfulTests.length;

    console.log(`📈 Average Response Time: ${Math.round(avgDuration)}ms`);

    const fastest = successfulTests.reduce((min, test) => {
      const duration = parseInt(test.duration.replace('ms', ''));
      return duration < min ? duration : min;
    }, Infinity);

    const slowest = successfulTests.reduce((max, test) => {
      const duration = parseInt(test.duration.replace('ms', ''));
      return duration > max ? duration : max;
    }, 0);

    console.log(`⚡ Fastest Query: ${fastest}ms`);
    console.log(`🐌 Slowest Query: ${slowest}ms`);

    // Performance analysis by query type
    console.log('\n📋 PERFORMANCE ANALYSIS BY QUERY TYPE:');
    console.log('=====================================');

    const wildcardTests = successfulTests.filter(t => t.test.includes('Wildcard'));
    const simpleTests = successfulTests.filter(
      t => !t.test.includes('Wildcard') && !t.test.includes('Match All'),
    );
    const matchAllTests = successfulTests.filter(t => t.test.includes('Match All'));

    if (wildcardTests.length > 0) {
      const wildcardAvg =
        wildcardTests.reduce((sum, test) => {
          const duration = parseInt(test.duration.replace('ms', ''));
          return sum + duration;
        }, 0) / wildcardTests.length;
      console.log(`🔍 Wildcard Queries Avg: ${Math.round(wildcardAvg)}ms`);
    }

    if (simpleTests.length > 0) {
      const simpleAvg =
        simpleTests.reduce((sum, test) => {
          const duration = parseInt(test.duration.replace('ms', ''));
          return sum + duration;
        }, 0) / simpleTests.length;
      console.log(`📝 Simple Queries Avg: ${Math.round(simpleAvg)}ms`);
    }

    if (matchAllTests.length > 0) {
      const matchAllAvg =
        matchAllTests.reduce((sum, test) => {
          const duration = parseInt(test.duration.replace('ms', ''));
          return sum + duration;
        }, 0) / matchAllTests.length;
      console.log(`🌐 Match All Queries Avg: ${Math.round(matchAllAvg)}ms`);
    }

    // Pagination performance analysis
    console.log('\n📄 PAGINATION PERFORMANCE ANALYSIS:');
    console.log('===================================');

    const firstPageTests = successfulTests.filter(t => t.pageOffset === 0);
    const laterPageTests = successfulTests.filter(t => t.pageOffset > 0);

    if (firstPageTests.length > 0) {
      const firstPageAvg =
        firstPageTests.reduce((sum, test) => {
          const duration = parseInt(test.duration.replace('ms', ''));
          return sum + duration;
        }, 0) / firstPageTests.length;
      console.log(`📄 First Page Queries Avg: ${Math.round(firstPageAvg)}ms`);
    }

    if (laterPageTests.length > 0) {
      const laterPageAvg =
        laterPageTests.reduce((sum, test) => {
          const duration = parseInt(test.duration.replace('ms', ''));
          return sum + duration;
        }, 0) / laterPageTests.length;
      console.log(`📄 Later Page Queries Avg: ${Math.round(laterPageAvg)}ms`);
    }

    // Performance targets analysis
    console.log('\n🎯 PERFORMANCE TARGETS ANALYSIS:');
    console.log('================================');

    const under50ms = successfulTests.filter(t => parseInt(t.duration.replace('ms', '')) < 50);
    const under100ms = successfulTests.filter(t => parseInt(t.duration.replace('ms', '')) < 100);
    const under500ms = successfulTests.filter(t => parseInt(t.duration.replace('ms', '')) < 500);

    console.log(
      `🎯 Under 50ms: ${under50ms.length}/${successfulTests.length} (${Math.round(
        (under50ms.length / successfulTests.length) * 100,
      )}%)`,
    );
    console.log(
      `🎯 Under 100ms: ${under100ms.length}/${successfulTests.length} (${Math.round(
        (under100ms.length / successfulTests.length) * 100,
      )}%)`,
    );
    console.log(
      `🎯 Under 500ms: ${under500ms.length}/${successfulTests.length} (${Math.round(
        (under500ms.length / successfulTests.length) * 100,
      )}%)`,
    );

    if (under50ms.length === 0) {
      console.log('\n⚠️  WARNING: No queries are meeting the 50ms target!');
      console.log('   Consider implementing the optimization plan.');
    }
  }

  if (failedTests.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    failedTests.forEach(test => {
      console.log(`   - ${test.test}: ${test.error}`);
    });
  }

  console.log('\n🎯 Test completed!');
}

// Run the test
runPerformanceTest().catch(console.error);
