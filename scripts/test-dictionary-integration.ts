import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SearchService } from '../src/search/search.service';
import { DictionaryService } from '../src/search/services/dictionary.service';

async function testDictionaryIntegration() {
  console.log('🚀 Starting Dictionary Integration Test...\n');

  // Create NestJS application
  const app = await NestFactory.createApplicationContext(AppModule);
  const searchService = app.get(SearchService);
  const dictionaryService = app.get(DictionaryService);

  try {
    // Test 1: Dictionary Service Direct Tests
    console.log('📚 Testing Dictionary Service Directly...');
    const stats = await dictionaryService.getDictionaryStats();
    console.log(
      `Dictionary loaded: ${stats.wordCount} words, initialized: ${stats.isInitialized}\n`,
    );

    // Test correct words
    const correctWords = [
      'property',
      'hello',
      'world',
      'business',
      'restaurant',
      'hotel',
      'service',
    ];
    console.log('✅ Testing correct words:');
    for (const word of correctWords) {
      const isValid = await dictionaryService.isWordValid(word);
      console.log(`  "${word}" is valid: ${isValid}`);
    }

    // Test typo words
    const typoWords = ['helo', 'proprty', 'wrold', 'bussiness', 'resturant', 'hotle', 'servce'];
    console.log('\n❌ Testing typo words:');
    for (const word of typoWords) {
      const isValid = await dictionaryService.isWordValid(word);
      console.log(`  "${word}" is valid: ${isValid}`);
    }

    // Test query validation
    const testQueries = [
      'hello world', // Correct multi-word
      'helo wrold', // Typo multi-word
      'Business Restaurant', // Correct proper noun
      'Bussiness Resturant', // Typo proper noun
      'xyzabc', // Nonsense word
      'test', // Short word
    ];

    console.log('\n🔍 Testing query validation:');
    for (const query of testQueries) {
      const isCorrect = await dictionaryService.isQueryLikelyCorrect(query);
      console.log(`  "${query}" is likely correct: ${isCorrect}`);
    }

    // Test 2: Search Service Integration Tests
    console.log('\n\n🔍 Testing Search Service Integration...');

    // First, let's ensure we have some test data
    const testIndex = 'test-dictionary-index';

    // Test correct word searches
    console.log('\n✅ Testing searches with correct words:');
    const correctSearches = ['restaurant', 'hotel business', 'service provider'];

    for (const query of correctSearches) {
      try {
        console.log(`\n  Searching for: "${query}"`);
        const result = await searchService.search(testIndex, {
          query,
          size: 5,
        });
        console.log(`    Results: ${result.data.total} documents`);
        console.log(`    Typo correction: ${result.typoTolerance ? 'Applied' : 'Not needed'}`);
        if (result.typoTolerance) {
          console.log(`    Original: "${result.typoTolerance.originalQuery}"`);
          console.log(`    Corrected: "${result.typoTolerance.correctedQuery}"`);
        }
      } catch (error) {
        console.log(`    Error: ${error.message}`);
      }
    }

    // Test typo word searches
    console.log('\n❌ Testing searches with typo words:');
    const typoSearches = [
      'resturant', // restaurant typo
      'hotle bussiness', // hotel business typos
      'servce provder', // service provider typos
    ];

    for (const query of typoSearches) {
      try {
        console.log(`\n  Searching for: "${query}"`);
        const result = await searchService.search(testIndex, {
          query,
          size: 5,
        });
        console.log(`    Results: ${result.data.total} documents`);
        console.log(`    Typo correction: ${result.typoTolerance ? 'Applied' : 'Not needed'}`);
        if (result.typoTolerance) {
          console.log(`    Original: "${result.typoTolerance.originalQuery}"`);
          console.log(`    Corrected: "${result.typoTolerance.correctedQuery}"`);
          console.log(`    Confidence: ${result.typoTolerance.confidence}`);
        }
      } catch (error) {
        console.log(`    Error: ${error.message}`);
      }
    }

    // Test 3: Edge Cases
    console.log('\n\n🧪 Testing Edge Cases...');

    const edgeCases = [
      'a', // Very short
      'ab', // Very short
      'abc', // Minimum length
      '123', // Numbers
      'hello@world.com', // Email-like
      'www.example.com', // URL-like
      'Coca-Cola', // Brand name with hyphen
      "McDonald's", // Brand name with apostrophe
    ];

    for (const query of edgeCases) {
      try {
        const isCorrect = await dictionaryService.isQueryLikelyCorrect(query);
        console.log(`  "${query}" is likely correct: ${isCorrect}`);
      } catch (error) {
        console.log(`  "${query}" error: ${error.message}`);
      }
    }

    console.log('\n✅ Dictionary Integration Test Complete!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await app.close();
  }
}

// Run the test
testDictionaryIntegration().catch(console.error);
