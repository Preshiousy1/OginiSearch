const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SearchService } = require('../dist/search/search.service');
const { DictionaryService } = require('../dist/search/services/dictionary.service');

async function testSearchIntegration() {
    console.log('🚀 Testing Search Service with Dictionary Integration...\n');

    // Create NestJS application
    const app = await NestFactory.createApplicationContext(AppModule);
    const searchService = app.get(SearchService);
    const dictionaryService = app.get(DictionaryService);

    try {
        // Test 1: Dictionary Service Stats
        console.log('📚 Dictionary Service Stats:');
        const stats = await dictionaryService.getDictionaryStats();
        console.log(`  Words loaded: ${stats.wordCount}`);
        console.log(`  Initialized: ${stats.isInitialized}\n`);

        // Test 2: Test Dictionary Word Validation
        console.log('🔍 Testing Dictionary Word Validation:');
        const testWords = [
            { word: 'restaurant', expected: true },
            { word: 'resturant', expected: false },
            { word: 'business', expected: true },
            { word: 'bussiness', expected: false },
            { word: 'hotel', expected: true },
            { word: 'hotle', expected: false },
        ];

        for (const { word, expected } of testWords) {
            const isValid = await dictionaryService.isWordValid(word);
            const status = isValid === expected ? '✅' : '❌';
            console.log(`  ${status} "${word}" is valid: ${isValid} (expected: ${expected})`);
        }

        // Test 3: Test Query Validation
        console.log('\n🔍 Testing Query Validation:');
        const testQueries = [
            { query: 'restaurant business', expected: true },
            { query: 'resturant bussiness', expected: true }, // Multi-word queries are always considered correct
            { query: 'xyzabc', expected: false },
            { query: 'test', expected: true },
        ];

        for (const { query, expected } of testQueries) {
            const isCorrect = await dictionaryService.isQueryLikelyCorrect(query);
            const status = isCorrect === expected ? '✅' : '❌';
            console.log(`  ${status} "${query}" is likely correct: ${isCorrect} (expected: ${expected})`);
        }

        // Test 4: Test Search Service Integration
        console.log('\n🔍 Testing Search Service Integration:');
        const testIndex = 'test-dictionary-index';

        const searchTests = [
            { query: 'restaurant', description: 'Correct word' },
            { query: 'resturant', description: 'Typo word' },
            { query: 'business hotel', description: 'Correct multi-word' },
            { query: 'bussiness hotle', description: 'Typo multi-word' },
        ];

        for (const { query, description } of searchTests) {
            try {
                console.log(`\n  Testing: "${query}" (${description})`);

                // Check if query would trigger typo tolerance
                const isLikelyCorrect = await dictionaryService.isQueryLikelyCorrect(query);
                console.log(`    Dictionary says likely correct: ${isLikelyCorrect}`);

                // Perform search
                const result = await searchService.search(testIndex, {
                    query,
                    size: 5,
                });

                console.log(`    Search results: ${result.data.total} documents`);
                console.log(`    Typo correction applied: ${result.typoTolerance ? 'Yes' : 'No'}`);

                if (result.typoTolerance) {
                    console.log(`    Original query: "${result.typoTolerance.originalQuery}"`);
                    console.log(`    Corrected query: "${result.typoTolerance.correctedQuery}"`);
                    console.log(`    Confidence: ${result.typoTolerance.confidence}`);
                }
            } catch (error) {
                console.log(`    Error: ${error.message}`);
            }
        }

        console.log('\n✅ Search Integration Test Complete!');
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await app.close();
    }
}

// Run the test
testSearchIntegration().catch(console.error);
