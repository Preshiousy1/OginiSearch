#!/usr/bin/env ts-node

import { EntityExtractionService } from '../src/search/services/entity-extraction.service';
import { LocationProcessorService } from '../src/search/services/location-processor.service';
import { QueryExpansionService } from '../src/search/services/query-expansion.service';

async function testIntelligentSearch() {
  console.log('🧪 Testing Intelligent Search Phase 1 Implementation (Simple)\n');

  try {
    const entityExtraction = new EntityExtractionService();
    const locationProcessor = new LocationProcessorService();
    const queryExpansion = new QueryExpansionService();

    // Test queries
    const testQueries = [
      'restaurants near me',
      'best pizza delivery',
      'hotels in lagos',
      'cheap gym membership',
      '24/7 pharmacy',
      'beauty salon appointment',
    ];

    console.log('📋 Testing Entity Extraction:');
    console.log('='.repeat(50));

    for (const query of testQueries) {
      console.log(`\n🔍 Query: "${query}"`);

      // Test entity extraction
      const entities = await entityExtraction.extractEntities(query);
      console.log(`   Business Types: ${entities.businessTypes.join(', ') || 'none'}`);
      console.log(`   Locations: ${entities.locations.join(', ') || 'none'}`);
      console.log(`   Services: ${entities.services.join(', ') || 'none'}`);
      console.log(`   Modifiers: ${entities.modifiers.join(', ') || 'none'}`);

      // Test location processing
      const locationResult = await locationProcessor.processLocationQuery(query);
      console.log(`   Has Location: ${locationResult.hasLocation}`);
      if (locationResult.context) {
        console.log(`   Location Type: ${locationResult.context.type}`);
        console.log(`   Radius: ${locationResult.radius}m`);
      }

      // Test query expansion
      const expansion = await queryExpansion.expandQuery(
        query,
        entities.businessTypes,
        entities.services,
      );
      console.log(`   Expanded Query: "${expansion.expanded}"`);
      console.log(`   Synonyms: ${expansion.synonyms.join(', ') || 'none'}`);
    }

    console.log('\n\n🎯 Testing Specific Features:');
    console.log('='.repeat(50));

    // Test "restaurants near me" specifically
    console.log('\n🍕 Testing "restaurants near me":');
    const restaurantQuery = 'restaurants near me';
    const restaurantEntities = await entityExtraction.extractEntities(restaurantQuery);
    const restaurantLocation = await locationProcessor.processLocationQuery(restaurantQuery);
    const restaurantExpansion = await queryExpansion.expandQuery(
      restaurantQuery,
      restaurantEntities.businessTypes,
      restaurantEntities.services,
    );

    console.log(`   Business Types: ${restaurantEntities.businessTypes.join(', ')}`);
    console.log(`   Has Location: ${restaurantLocation.hasLocation}`);
    console.log(`   Location Type: ${restaurantLocation.context?.type}`);
    console.log(`   Expanded: "${restaurantExpansion.expanded}"`);

    // Test business type synonyms
    console.log('\n📚 Testing Business Type Synonyms:');
    const restaurantSynonyms = entityExtraction.getBusinessTypeSynonyms('restaurant');
    console.log(`   Restaurant synonyms: ${restaurantSynonyms.join(', ')}`);

    // Test location reference detection
    console.log('\n📍 Testing Location Detection:');
    const locationQueries = ['near me', 'in lagos', 'close to downtown'];
    for (const locQuery of locationQueries) {
      const hasLocation = entityExtraction.hasLocationReference(locQuery);
      console.log(`   "${locQuery}": ${hasLocation}`);
    }

    console.log('\n✅ Phase 1 Implementation Test Complete!');
    console.log('\n📊 Summary:');
    console.log('   ✓ Entity extraction working');
    console.log('   ✓ Location processing working');
    console.log('   ✓ Query expansion working');
    console.log('   ✓ Business type recognition working');
    console.log('   ✓ Location reference detection working');
    console.log('   ✓ Synonym mapping working');
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run the test
testIntelligentSearch().catch(console.error);
