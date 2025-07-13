import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB = 'ogini_search_test';

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let inDollarQuote = false;
  let dollarQuoteTag = '';

  // Split the SQL into lines and trim whitespace while preserving newlines
  const lines = sql.split('\n').map(line => line.trim());

  for (const line of lines) {
    if (!line || line.startsWith('--')) continue; // Skip empty lines and comments

    // Add the line to the current statement
    currentStatement += line + '\n';

    // Handle dollar-quoted strings (e.g., $$ or $function$)
    const dollarQuotes = line.match(/\$\w*\$/g) || [];
    for (const quote of dollarQuotes) {
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarQuoteTag = quote;
      } else if (quote === dollarQuoteTag) {
        inDollarQuote = false;
        dollarQuoteTag = '';
      }
    }

    // Only look for statement terminators if we're not in a dollar-quoted string
    if (!inDollarQuote && line.endsWith(';')) {
      statements.push(currentStatement.trim());
      currentStatement = '';
    }
  }

  // Add any remaining statement
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  return statements;
}

async function setupTestDatabase() {
  // Connect to default postgres database to create/drop test database
  const adminClient = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: 'postgres',
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL admin database');

    // Drop test database if it exists
    await adminClient.query(`
      DROP DATABASE IF EXISTS ${TEST_DB};
    `);
    console.log('Dropped existing test database');

    // Create fresh test database
    await adminClient.query(`
      CREATE DATABASE ${TEST_DB};
    `);
    console.log('Created fresh test database');

    // Connect to test database for migrations
    const testClient = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: TEST_DB,
    });

    await testClient.connect();
    console.log('Connected to test database');

    // Run migrations
    const migrationFiles = ['init-postgres.sql'];

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migration = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const statements = splitSqlStatements(migration);

      for (const statement of statements) {
        try {
          await testClient.query(statement);
        } catch (error) {
          console.error(`Error executing statement: ${statement}`);
          throw error;
        }
      }
    }

    // Create pg_trgm extension if not exists
    await testClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

    console.log('Test database setup complete');
    await testClient.end();
  } catch (error) {
    console.error('Error setting up test database:', error);
    throw error;
  } finally {
    await adminClient.end();
  }
}

async function teardownTestDatabase() {
  const adminClient = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: 'postgres',
  });

  try {
    await adminClient.connect();

    // Force disconnect all other connections
    await adminClient.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${TEST_DB}'
        AND pid <> pg_backend_pid();
    `);

    // Drop the database
    await adminClient.query(`
      DROP DATABASE IF EXISTS ${TEST_DB};
    `);
    console.log('Test database cleanup complete');
  } catch (error) {
    console.error('Error cleaning up test database:', error);
    throw error;
  } finally {
    await adminClient.end();
  }
}

export { setupTestDatabase, teardownTestDatabase, TEST_DB };
