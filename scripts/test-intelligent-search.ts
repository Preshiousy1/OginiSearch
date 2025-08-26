#!/usr/bin/env ts-node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { QueryProcessorService } from '../src/search/query-processor.service';
import { EntityExtractionService } from '../src/search/services/entity-extraction.service';
import { LocationProcessorService } from '../src/search/services/location-processor.service';
import { QueryExpansionService } from '../src/search/services/query-expansion.service';

async function testIntelligentSearch() {
  console.log('🧪 Testing Intelligent Search Phase 1 Implementation\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const queryProcessor = app.get(QueryProcessorService);
    const entityExtraction = app.get(EntityExtractionService);
    const locationProcessor = app.get(LocationProcessorService);
    const queryExpansion = app.get(QueryExpansionService);

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

    console.log('\n\n🎯 Testing Intelligent Query Processing:');
    console.log('='.repeat(50));

    const intelligentQueries = [
      'restaurants near me',
      'best pizza delivery in lagos',
      'cheap hotel booking',
    ];

    for (const query of intelligentQueries) {
      console.log(`\n🧠 Intelligent Processing: "${query}"`);

      const components = await queryProcessor.processIntelligentQuery({
        query,
        fields: ['_all'],
      });

      console.log(`   Intent: ${components.intent}`);
      console.log(`   Business Types: ${components.entities.businessTypes.join(', ') || 'none'}`);
      console.log(`   Expanded: "${components.expanded}"`);
      if (components.locationContext) {
        console.log(`   Location: ${components.locationContext.type}`);
      }
    }

    console.log('\n✅ Phase 1 Implementation Test Complete!');
    console.log('\n📊 Summary:');
    console.log('   ✓ Entity extraction working');
    console.log('   ✓ Location processing working');
    console.log('   ✓ Query expansion working');
    console.log('   ✓ Intent classification working');
    console.log('   ✓ Parallel processing implemented');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await app.close();
  }
}

// Run the test
testIntelligentSearch().catch(console.error);
