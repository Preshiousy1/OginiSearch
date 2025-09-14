import { DictionaryService } from '../src/search/services/dictionary.service';

async function testDictionaryService() {
  console.log('🚀 Testing Dictionary Service Integration...\n');

  const dictionaryService = new DictionaryService();

  try {
    // Test 1: Dictionary Service Direct Tests
    console.log('📚 Testing Dictionary Service Directly...');
    const stats = await dictionaryService.getDictionaryStats();
    console.log(
      `Dictionary loaded: ${stats.wordCount} words, initialized: ${stats.isInitialized}\n`,
    );

    // Test correct words
    const correctWords = ['hello', 'world', 'business', 'restaurant', 'hotel', 'service', 'test'];
    console.log('✅ Testing correct words:');
    for (const word of correctWords) {
      const isValid = await dictionaryService.isWordValid(word);
      console.log(`  "${word}" is valid: ${isValid}`);
    }

    // Test typo words
    const typoWords = ['helo', 'wrold', 'bussiness', 'resturant', 'hotle', 'servce', 'tets'];
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
      'restaurant business', // Correct business terms
      'resturant bussiness', // Typo business terms
    ];

    console.log('\n🔍 Testing query validation:');
    for (const query of testQueries) {
      const isCorrect = await dictionaryService.isQueryLikelyCorrect(query);
      console.log(`  "${query}" is likely correct: ${isCorrect}`);
    }

    // Test 2: Edge Cases
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
      'iPhone', // Brand name with capital
      'eBay', // Brand name with mixed case
    ];

    for (const query of edgeCases) {
      try {
        const isCorrect = await dictionaryService.isQueryLikelyCorrect(query);
        console.log(`  "${query}" is likely correct: ${isCorrect}`);
      } catch (error) {
        console.log(`  "${query}" error: ${error.message}`);
      }
    }

    // Test 3: Performance Test
    console.log('\n\n⚡ Performance Test...');
    const performanceWords = [
      'restaurant',
      'hotel',
      'business',
      'service',
      'resturant',
      'hotle',
      'bussiness',
      'servce',
    ];

    const startTime = Date.now();
    for (const word of performanceWords) {
      await dictionaryService.isWordValid(word);
    }
    const endTime = Date.now();

    console.log(`  Processed ${performanceWords.length} words in ${endTime - startTime}ms`);
    console.log(`  Average: ${(endTime - startTime) / performanceWords.length}ms per word`);

    console.log('\n✅ Dictionary Service Test Complete!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testDictionaryService().catch(console.error);
