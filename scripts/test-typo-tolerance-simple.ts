#!/usr/bin/env ts-node

import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function testTypoToleranceSimple() {
  console.log('🧪 Testing Typo Tolerance - Simple Test\n');

  try {
    // Test 1: Check if the service is responding
    console.log('1️⃣ Testing basic search with typo...');
    const searchResults = await axios.post(`${BASE_URL}/api/indices/businesses/_search`, {
      query: 'resturant', // Typo: should find results and suggest correction
      size: 5,
    });

    console.log('✅ Search results:');
    console.log(`   Total results: ${searchResults.data.data.total}`);
    console.log(`   Time taken: ${searchResults.data.took}ms`);
    console.log(`   Typo tolerance: ${JSON.stringify(searchResults.data.typoTolerance, null, 2)}`);
    console.log('');

    // Test 2: Test with a different typo
    console.log('2️⃣ Testing with different typo...');
    const searchResults2 = await axios.post(`${BASE_URL}/api/indices/businesses/_search`, {
      query: 'hotl', // Typo: should suggest "hotel"
      size: 5,
    });

    console.log('✅ Search results for "hotl":');
    console.log(`   Total results: ${searchResults2.data.data.total}`);
    console.log(`   Time taken: ${searchResults2.data.took}ms`);
    console.log(`   Typo tolerance: ${JSON.stringify(searchResults2.data.typoTolerance, null, 2)}`);
    console.log('');

    // Test 3: Test with a clear typo that should be corrected
    console.log('3️⃣ Testing with clear typo...');
    const searchResults3 = await axios.post(`${BASE_URL}/api/indices/businesses/_search`, {
      query: 'clinik', // Typo: should suggest "clinic"
      size: 5,
    });

    console.log('✅ Search results for "clinik":');
    console.log(`   Total results: ${searchResults3.data.data.total}`);
    console.log(`   Time taken: ${searchResults3.data.took}ms`);
    console.log(`   Typo tolerance: ${JSON.stringify(searchResults3.data.typoTolerance, null, 2)}`);
    console.log('');

    console.log('🎉 Typo tolerance test completed!');
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the tests
testTypoToleranceSimple().catch(console.error);
