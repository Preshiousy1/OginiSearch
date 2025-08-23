import axios from 'axios';

const API_BASE = 'http://localhost:3000';

async function generateTestDocuments(count: number) {
  const documents = [];
  for (let i = 1; i <= count; i++) {
    documents.push({
      id: `business-${i}`,
      document: {
        name: `Business ${i}`,
        title: `Business Title ${i}`,
        description: `This is business number ${i} for bulk indexing performance testing. It provides various services and products.`,
        tags: [`business-${i}`, 'bulk-test', 'performance'],
        category: `category-${i % 10}`,
        location: `location-${i % 20}`,
        profile: `Business profile for company ${i} with detailed information about services and offerings.`,
        slug: `business-${i}`,
        price: Math.floor(Math.random() * 1000) + 100,
        rating: (Math.random() * 5).toFixed(1),
        inStock: Math.random() > 0.3,
      },
    });
  }
  return documents;
}

async function testBulkIndexing() {
  console.log('🚀 Starting bulk indexing test with 10,000 documents...');

  const documents = await generateTestDocuments(10000);
  console.log(`📊 Generated ${documents.length} test documents`);

  const startTime = Date.now();

  try {
    // Queue the batch
    const queueResponse = await axios.post(`${API_BASE}/bulk-indexing/queue/batch`, {
      indexName: 'businesses',
      documents,
      batchSize: 100,
    });

    const batchId = queueResponse.data.batchId;
    console.log(`✅ Batch queued: ${batchId}`);
    console.log(`📋 Total documents: ${queueResponse.data.totalDocuments}`);

    // Wait for completion (poll every 5 seconds)
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes timeout

    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        const progressResponse = await axios.get(`${API_BASE}/bulk-indexing/progress/${batchId}`);
        const status = progressResponse.data.status;

        if (status === 'completed') {
          completed = true;
          console.log(`✅ Batch completed successfully`);
        } else if (status === 'failed') {
          console.log(`❌ Batch failed`);
          break;
        } else {
          console.log(`⏳ Status: ${status}`);
        }
      } catch (error) {
        console.log(`⚠️  Progress check failed: ${error.message}`);
      }

      attempts++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(
      `📈 Performance: ${documents.length} documents in ${duration}ms (${(
        documents.length /
        (duration / 1000)
      ).toFixed(2)} docs/sec)`,
    );

    // Test search after bulk indexing
    console.log('\n🔍 Testing search functionality...');

    // Test match query
    const searchResponse = await axios.post(`${API_BASE}/api/indices/businesses/_search`, {
      query: 'business',
      size: 10,
    });

    console.log(
      `✅ Search test: Found ${searchResponse.data.data.total} results in ${searchResponse.data.took}ms`,
    );

    // Test wildcard query
    const wildcardResponse = await axios.post(`${API_BASE}/api/indices/businesses/_search`, {
      query: {
        wildcard: {
          field: 'name',
          value: 'Business*',
        },
      },
      size: 10,
    });

    console.log(
      `✅ Wildcard test: Found ${wildcardResponse.data.data.total} results in ${wildcardResponse.data.took}ms`,
    );

    // Test match_all query
    const matchAllResponse = await axios.post(`${API_BASE}/api/indices/businesses/_search`, {
      query: {
        match_all: {},
      },
      size: 10,
    });

    console.log(
      `✅ Match-all test: Found ${matchAllResponse.data.data.total} results in ${matchAllResponse.data.took}ms`,
    );
  } catch (error) {
    console.log(`❌ Error: ${error.response?.data?.message || error.message}`);
    if (error.response?.data) {
      console.log(`📋 Response:`, JSON.stringify(error.response.data, null, 2));
    }
  }

  console.log('\n🎉 Bulk indexing test completed!');
}

// Run the test
testBulkIndexing().catch(console.error);
