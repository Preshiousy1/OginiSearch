import axios from 'axios';

const API_BASE = 'http://localhost:3000';

async function generateTestDocuments(count: number) {
  const documents = [];
  for (let i = 1; i <= count; i++) {
    documents.push({
      id: `business-${i}`,
      document: {
        name: `Test Business ${i}`,
        title: `Business Title ${i}`,
        description: `This is a test business number ${i} for bulk indexing performance testing. It provides various services and products.`,
        tags: [`business-${i}`, 'test', 'bulk-indexing'],
        category: `category-${i % 5}`,
        location: `location-${i % 10}`,
        profile: `Business profile for company ${i} with detailed information about services and offerings.`,
        slug: `test-business-${i}`,
      },
    });
  }
  return documents;
}

async function testBulkIndexing() {
  console.log('🚀 Starting bulk indexing performance test...');

  const testSizes = [10, 100, 1000];

  for (const size of testSizes) {
    console.log(`\n📊 Testing with ${size} documents...`);

    const documents = await generateTestDocuments(size);

    const startTime = Date.now();

    try {
      // Queue the batch
      const queueResponse = await axios.post(`${API_BASE}/bulk-indexing/queue/batch`, {
        indexName: 'businesses',
        documents,
        batchSize: 100,
      });

      const batchId = queueResponse.data.batchId;
      console.log(`   ✅ Batch queued: ${batchId}`);

      // Wait for completion (poll every 2 seconds)
      let completed = false;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes timeout

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
          const progressResponse = await axios.get(`${API_BASE}/bulk-indexing/progress/${batchId}`);
          const status = progressResponse.data.status;

          if (status === 'completed') {
            completed = true;
            console.log(`   ✅ Batch completed successfully`);
          } else if (status === 'failed') {
            console.log(`   ❌ Batch failed`);
            break;
          } else {
            console.log(`   ⏳ Status: ${status}`);
          }
        } catch (error) {
          console.log(`   ⚠️  Progress check failed: ${error.message}`);
        }

        attempts++;
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(
        `   📈 Performance: ${size} documents in ${duration}ms (${(
          size /
          (duration / 1000)
        ).toFixed(2)} docs/sec)`,
      );
    } catch (error) {
      console.log(`   ❌ Error: ${error.response?.data?.message || error.message}`);
      if (error.response?.data) {
        console.log(`   📋 Response:`, JSON.stringify(error.response.data, null, 2));
      }
    }
  }

  console.log('\n🎉 Bulk indexing test completed!');
}

// Run the test
testBulkIndexing().catch(console.error);
