#!/usr/bin/env ts-node

/**
 * Examine Document Structure
 * Analyzes the actual structure of documents in the database
 */

import { DataSource } from 'typeorm';

async function examineDocumentStructure() {
  console.log('🔍 Examining Document Structure...\n');

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'ogini_search_dev',
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    logging: false,
  });

  try {
    console.log('📡 Connecting to PostgreSQL...');
    await dataSource.initialize();
    console.log('✅ Connected successfully!');

    // Examine listings documents
    console.log('\n📋 Examining listings documents...');

    const listingsDocs = await dataSource.query(`
      SELECT 
        document_id,
        content,
        metadata,
        created_at
      FROM documents 
      WHERE index_name = 'listings' 
      LIMIT 3;
    `);

    console.log(`Found ${listingsDocs.length} listings documents`);

    listingsDocs.forEach((doc: any, index: number) => {
      console.log(`\n📄 Document ${index + 1}:`);
      console.log(`   ID: ${doc.document_id}`);
      console.log(`   Created: ${doc.created_at}`);
      console.log(`   Content Keys: ${Object.keys(doc.content || {}).join(', ')}`);
      console.log(`   Metadata Keys: ${Object.keys(doc.metadata || {}).join(', ')}`);

      if (doc.content) {
        console.log('\n   Content Structure:');
        Object.entries(doc.content).forEach(([key, value]) => {
          console.log(
            `     ${key}: ${typeof value} = ${JSON.stringify(value).substring(0, 100)}${
              JSON.stringify(value).length > 100 ? '...' : ''
            }`,
          );
        });
      }

      if (doc.metadata) {
        console.log('\n   Metadata Structure:');
        Object.entries(doc.metadata).forEach(([key, value]) => {
          console.log(`     ${key}: ${typeof value} = ${JSON.stringify(value)}`);
        });
      }
    });

    // Check for documents with 'man' in the name
    console.log('\n🔍 Searching for documents with "man" in name...');

    const manDocs = await dataSource.query(`
      SELECT 
        document_id,
        content->>'name' as name,
        content->>'category_name' as category_name,
        metadata->>'is_active' as is_active,
        metadata->>'is_verified' as is_verified,
        metadata->>'is_blocked' as is_blocked
      FROM documents 
      WHERE index_name = 'listings' 
        AND content->>'name' ILIKE '%man%'
      LIMIT 5;
    `);

    console.log(`Found ${manDocs.length} documents with "man" in name:`);
    manDocs.forEach((doc: any, index: number) => {
      console.log(
        `   ${index + 1}. ${doc.name} (${doc.category_name}) - Active: ${
          doc.is_active
        }, Verified: ${doc.is_verified}, Blocked: ${doc.is_blocked}`,
      );
    });

    // Check category distribution
    console.log('\n📊 Category Distribution:');

    const categories = await dataSource.query(`
      SELECT 
        content->>'category_name' as category_name,
        COUNT(*) as count
      FROM documents 
      WHERE index_name = 'listings'
      GROUP BY content->>'category_name'
      ORDER BY count DESC;
    `);

    categories.forEach((cat: any) => {
      console.log(`   ${cat.category_name}: ${cat.count} documents`);
    });

    // Test the exact query we're generating
    console.log('\n🧪 Testing our search query...');

    const testQuery = await dataSource.query(
      `
      SELECT 
        d.document_id,
        d.content->>'name' as name,
        d.content->>'category_name' as category_name,
        d.metadata->>'is_active' as is_active,
        d.metadata->>'is_verified' as is_verified,
        d.metadata->>'is_blocked' as is_blocked
      FROM search_documents sd
      JOIN documents d ON d.document_id = sd.document_id AND d.index_name = sd.index_name
      WHERE sd.index_name = $1
        AND d.content->>'name' ILIKE $2
        AND d.content->>'category_name' = $3
        AND d.metadata->>'is_active' = $4
        AND d.metadata->>'is_verified' = $5
        AND d.metadata->>'is_blocked' = $6
      LIMIT 5;
    `,
      ['listings', 'man%', 'Deals', 'true', 'true', 'false'],
    );

    console.log(`Query returned ${testQuery.length} results:`);
    testQuery.forEach((doc: any, index: number) => {
      console.log(`   ${index + 1}. ${doc.name} (${doc.category_name})`);
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// Run the examination
examineDocumentStructure().catch(console.error);
