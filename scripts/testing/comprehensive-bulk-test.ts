import axios from 'axios';
import { generateBusinessDocuments } from './generate-business-data';
import { generateTestDocuments } from './generate-bulk-data';

const API_BASE = 'http://localhost:3000';

async function createIndex(indexName: string) {
  try {
    const response = await axios.post(`${API_BASE}/api/indices`, {
      name: indexName,
      settings: {},
      mappings: {
        properties: {},
      },
    });
    console.log(`✅ Created index: ${indexName}`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`ℹ️  Index ${indexName} already exists`);
      return { name: indexName };
    }
    throw error;
  }
}

async function bulkIndexDocuments(indexName: string, documents: any[], batchSize = 100) {
  console.log(`📊 Starting bulk indexing for ${documents.length} documents...`);

  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;

  // Process in batches
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(documents.length / batchSize);

    try {
      const response = await axios.post(`${API_BASE}/api/indices/${indexName}/documents/_bulk`, {
        documents: batch,
      });

      successCount += response.data.successCount || batch.length;
      console.log(`✅ Batch ${batchNumber}/${totalBatches}: ${batch.length} documents indexed`);

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      errorCount += batch.length;
      console.log(
        `❌ Batch ${batchNumber}/${totalBatches} failed: ${
          error.response?.data?.message || error.message
        }`,
      );
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  const rate = (successCount / (duration / 1000)).toFixed(2);

  console.log(`\n📈 Bulk indexing completed:`);
  console.log(`   ✅ Success: ${successCount} documents`);
  console.log(`   ❌ Errors: ${errorCount} documents`);
  console.log(`   ⏱️  Duration: ${duration}ms`);
  console.log(`   🚀 Rate: ${rate} docs/sec`);

  return { successCount, errorCount, duration, rate };
}

async function testAllQueryTypes(indexName: string) {
  console.log(`\n🔍 Testing all query types for index: ${indexName}`);

  const testQueries = [
    // Simple string queries
    { name: 'Simple String Query', query: 'business' },
    { name: 'Simple String Query (performance)', query: 'performance' },

    // Match queries
    { name: 'Match Query', query: { match: { value: 'business' } } },
    { name: 'Match Query with Field', query: { match: { field: 'name', value: 'business' } } },
    { name: 'Match Query (performance)', query: { match: { value: 'performance' } } },

    // Wildcard queries
    { name: 'Wildcard Prefix', query: { wildcard: { field: 'name', value: 'business*' } } },
    {
      name: 'Wildcard Contains',
      query: { wildcard: { field: 'description', value: '*performance*' } },
    },
    { name: 'Wildcard Suffix', query: { wildcard: { field: 'name', value: '*business' } } },
    { name: 'Wildcard Single Char', query: { wildcard: { field: 'name', value: 'bus?ness' } } },

    // Match all queries
    { name: 'Match All', query: { match_all: {} } },
    { name: 'Match All with Boost', query: { match_all: { boost: 2.0 } } },

    // String wildcard queries
    { name: 'String Wildcard Prefix', query: 'business*' },
    { name: 'String Wildcard Contains', query: '*performance*' },
    { name: 'String Wildcard Suffix', query: '*business' },

    // Empty and special queries
    { name: 'Empty String', query: '' },
    { name: 'Single Asterisk', query: '*' },
    { name: 'Match Empty', query: { match: { value: '' } } },
    { name: 'Match Asterisk', query: { match: { value: '*' } } },
  ];

  const results = [];

  for (const testQuery of testQueries) {
    try {
      const startTime = Date.now();
      const response = await axios.post(`${API_BASE}/api/indices/${indexName}/_search`, {
        query: testQuery.query,
        size: 10,
      });
      const duration = Date.now() - startTime;

      const result = {
        name: testQuery.name,
        query: testQuery.query,
        total: response.data.data.total,
        took: duration,
        success: true,
      };

      console.log(`✅ ${testQuery.name}: ${response.data.data.total} results in ${duration}ms`);
      results.push(result);
    } catch (error) {
      console.log(`❌ ${testQuery.name}: ${error.response?.data?.message || error.message}`);
      results.push({
        name: testQuery.name,
        query: testQuery.query,
        error: error.response?.data?.message || error.message,
        success: false,
      });
    }
  }

  return results;
}

async function runComprehensiveTest() {
  console.log('🚀 Starting comprehensive bulk indexing and search test...\n');

  try {
    // Step 1: Create businesses index
    await createIndex('businesses');

    // Step 2: Generate and index business documents
    console.log('\n📊 Generating business documents...');
    const businessDocuments = generateBusinessDocuments(10000, 1);
    console.log(`Generated ${businessDocuments.length} business documents`);

    // Convert to the expected format
    const formattedBusinessDocs = businessDocuments.map(doc => ({
      id: doc.id,
      document: doc.source,
    }));

    await bulkIndexDocuments('businesses', formattedBusinessDocs, 100);

    // Step 3: Test all query types
    const queryResults = await testAllQueryTypes('businesses');

    // Step 4: Summary
    console.log('\n📋 Test Summary:');
    console.log('================');

    const successfulQueries = queryResults.filter(r => r.success);
    const failedQueries = queryResults.filter(r => !r.success);

    console.log(`✅ Successful queries: ${successfulQueries.length}`);
    console.log(`❌ Failed queries: ${failedQueries.length}`);

    if (failedQueries.length > 0) {
      console.log('\n❌ Failed queries:');
      failedQueries.forEach(q => {
        console.log(`   - ${q.name}: ${q.error}`);
      });
    }

    // Performance summary
    const avgResponseTime =
      successfulQueries.reduce((sum, q) => sum + q.took, 0) / successfulQueries.length;
    console.log(`\n⚡ Average response time: ${avgResponseTime.toFixed(2)}ms`);

    // Test pagination
    console.log('\n📄 Testing pagination...');
    const paginationTest = await axios.post(`${API_BASE}/api/indices/businesses/_search`, {
      query: 'business',
      size: 5,
      from: 0,
    });

    console.log(`✅ Pagination test: ${paginationTest.data.data.total} total results`);
    console.log(`   Current page: ${paginationTest.data.data.pagination.currentPage}`);
    console.log(`   Total pages: ${paginationTest.data.data.pagination.totalPages}`);
    console.log(`   Has next: ${paginationTest.data.data.pagination.hasNext}`);

    console.log('\n🎉 Comprehensive test completed successfully!');
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    if (error.response?.data) {
      console.log(`📋 Response:`, JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the test
runComprehensiveTest().catch(console.error);
