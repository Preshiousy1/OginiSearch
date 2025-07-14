import { config } from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '../.env.test'),
});

const TEST_DB_NAME = `test_db_${uuidv4().replace(/-/g, '_')}`;

let client: Client;

beforeAll(async () => {
  // Connect to default postgres database to create test database
  client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
  });

  await client.connect();

  // Create test database
  await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await client.end();

  // Set environment variables for test database
  process.env.POSTGRES_DB = TEST_DB_NAME;
});

afterAll(async () => {
  // Connect to default postgres database to drop test database
  client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: 'postgres',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
  });

  await client.connect();

  // Terminate all connections to the test database
  await client.query(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '${TEST_DB_NAME}'
    AND pid <> pg_backend_pid()`);

  // Drop test database
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
  await client.end();
});
