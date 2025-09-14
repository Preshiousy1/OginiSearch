#!/usr/bin/env ts-node

import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function testTypoTolerance() {
  console.log('🧪 Testing Typo Tolerance System\n');

  try {
    // Test 1: Basic suggestions with typos
    console.log('1️⃣ Testing basic suggestions with typos...');
    const suggestions = await axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
      text: 'saln', // Typo: should suggest "salon"
      field: 'name',
      size: 5,
    });

    console.log('✅ Suggestions for "saln":', suggestions.data);
    console.log('');

    // Test 2: Search with typo tolerance
    console.log('2️⃣ Testing search with typo tolerance...');
    const searchResults = await axios.post(`${BASE_URL}/api/indices/businesses/_search`, {
      query: 'saln', // Typo: should find "salon" results
      size: 5,
    });

    console.log('✅ Search results for "saln":');
    console.log(`   Total results: ${searchResults.data.data.total}`);
    console.log(`   Time taken: ${searchResults.data.took}ms`);

    if (searchResults.data.typoTolerance) {
      console.log('   Typo correction found:');
      console.log(`     Original: "${searchResults.data.typoTolerance.originalQuery}"`);
      console.log(`     Corrected: "${searchResults.data.typoTolerance.correctedQuery}"`);
      console.log(`     Confidence: ${searchResults.data.typoTolerance.confidence}`);
      console.log(`     Corrections: ${searchResults.data.typoTolerance.corrections.length}`);
    } else {
      console.log('   No typo correction needed');
    }
    console.log('');

    // Test 3: More complex typos
    console.log('3️⃣ Testing complex typos...');
    const complexSuggestions = await axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
      text: 'resturant', // Typo: should suggest "restaurant"
      field: 'name',
      size: 5,
    });

    console.log('✅ Suggestions for "resturant":', complexSuggestions.data);
    console.log('');

    // Test 4: Search with complex typo
    console.log('4️⃣ Testing search with complex typo...');
    const complexSearch = await axios.post(`${BASE_URL}/api/indices/businesses/_search`, {
      query: 'resturant', // Typo: should find "restaurant" results
      size: 5,
    });

    console.log('✅ Search results for "resturant":');
    console.log(`   Total results: ${complexSearch.data.data.total}`);
    console.log(`   Time taken: ${complexSearch.data.took}ms`);

    if (complexSearch.data.typoTolerance) {
      console.log('   Typo correction found:');
      console.log(`     Original: "${complexSearch.data.typoTolerance.originalQuery}"`);
      console.log(`     Corrected: "${complexSearch.data.typoTolerance.correctedQuery}"`);
      console.log(`     Confidence: ${complexSearch.data.typoTolerance.confidence}`);
    }
    console.log('');

    // Test 5: Performance test
    console.log('5️⃣ Testing performance with multiple typos...');
    const startTime = Date.now();

    const performancePromises = [
      axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
        text: 'hotl',
        field: 'name',
        size: 3,
      }),
      axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
        text: 'clinik',
        field: 'name',
        size: 3,
      }),
      axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
        text: 'universty',
        field: 'name',
        size: 3,
      }),
    ];

    const performanceResults = await Promise.all(performancePromises);
    const totalTime = Date.now() - startTime;

    console.log('✅ Performance test completed:');
    console.log(`   Total time for 3 parallel requests: ${totalTime}ms`);
    console.log(`   Average time per request: ${(totalTime / 3).toFixed(2)}ms`);
    console.log('');

    // Test 6: Edge cases
    console.log('6️⃣ Testing edge cases...');

    // Very short input
    const shortSuggestions = await axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
      text: 'a',
      field: 'name',
      size: 3,
    });
    console.log('✅ Very short input "a":', shortSuggestions.data);

    // Empty input
    const emptySuggestions = await axios.post(`${BASE_URL}/api/indices/businesses/_suggest`, {
      text: '',
      field: 'name',
      size: 3,
    });
    console.log('✅ Empty input:', emptySuggestions.data);
    console.log('');

    console.log('🎉 All typo tolerance tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the tests
testTypoTolerance().catch(console.error);
