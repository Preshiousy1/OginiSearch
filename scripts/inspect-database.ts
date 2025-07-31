import { Client } from 'pg';

async function inspectDatabase() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ogini_search_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    await client.connect();
    console.log('Connected to database successfully');

    // Check if tables exist
    console.log('\n=== Checking Tables ===');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log(
      'Tables found:',
      tablesResult.rows.map(row => row.table_name),
    );

    // Check documents table schema
    console.log('\n=== Documents Table Schema ===');
    const documentsSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      ORDER BY ordinal_position
    `);
    console.table(documentsSchema.rows);

    // Check indices table schema
    console.log('\n=== Indices Table Schema ===');
    const indicesSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'indices' 
      ORDER BY ordinal_position
    `);
    console.table(indicesSchema.rows);

    // Check search_documents table schema
    console.log('\n=== Search Documents Table Schema ===');
    const searchDocumentsSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'search_documents' 
      ORDER BY ordinal_position
    `);
    console.table(searchDocumentsSchema.rows);

    // Check document counts
    console.log('\n=== Document Counts ===');
    const documentCounts = await client.query(`
      SELECT 
        i.index_name,
        i.document_count as metadata_count,
        COUNT(d.document_id) as actual_count
      FROM indices i
      LEFT JOIN documents d ON i.index_name = d.index_name
      GROUP BY i.index_name, i.document_count
      ORDER BY i.index_name
    `);
    console.table(documentCounts.rows);

    // Check for any status columns
    console.log('\n=== Checking for Status Columns ===');
    const statusColumns = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns 
      WHERE column_name = 'status' 
      AND table_schema = 'public'
    `);
    console.log('Tables with status columns:', statusColumns.rows);
  } catch (error) {
    console.error('Database inspection error:', error);
  } finally {
    await client.end();
  }
}

inspectDatabase();
