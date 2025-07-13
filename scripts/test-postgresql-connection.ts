#!/usr/bin/env ts-node

/**
 * Simple PostgreSQL Connection Test
 * Tests the basic PostgreSQL connection and table structure
 */

import { DataSource } from 'typeorm';

async function testPostgreSQLConnection() {
  console.log('🔍 Testing PostgreSQL Connection...\n');

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

    console.log('\n🏗️  Checking database structure...');
    
    // Check if search_documents table exists
    const tableExists = await dataSource.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'search_documents'
      );
    `);

    if (tableExists[0].exists) {
      console.log('✅ search_documents table exists');

      // Get table info
      const tableInfo = await dataSource.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'search_documents' 
        ORDER BY ordinal_position;
      `);

      console.log('\n📋 Table Structure:');
      tableInfo.forEach((col: any) => {
        console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
      });

      // Check indexes
      const indexes = await dataSource.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'search_documents';
      `);

      console.log('\n🔗 Indexes:');
      indexes.forEach((idx: any) => {
        console.log(`   ${idx.indexname}`);
      });

      // Check extensions
      const extensions = await dataSource.query(`
        SELECT extname FROM pg_extension 
        WHERE extname IN ('pg_trgm', 'unaccent');
      `);

      console.log('\n🧩 Extensions:');
      extensions.forEach((ext: any) => {
        console.log(`   ✅ ${ext.extname}`);
      });

      // Count existing documents
      const documentCount = await dataSource.query(`
        SELECT 
          COUNT(*) as total_documents,
          COUNT(DISTINCT index_name) as total_indices
        FROM search_documents;
      `);

      console.log('\n📊 Current Data:');
      console.log(`   Documents: ${documentCount[0].total_documents}`);
      console.log(`   Indices: ${documentCount[0].total_indices}`);

    } else {
      console.log('❌ search_documents table does not exist');
      console.log('💡 Run: npm run setup:postgresql');
    }

    console.log('\n🎉 PostgreSQL is ready for Ogini Search Engine!');

  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Make sure PostgreSQL is running');
    console.log('   2. Check your environment variables');
    console.log('   3. Run: npm run setup:postgresql');
    
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// Run the test
testPostgreSQLConnection().catch(console.error);
