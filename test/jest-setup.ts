import { config } from 'dotenv';
import * as path from 'path';
import {
  setupTestDatabase,
  teardownTestDatabase,
  TEST_DB,
} from '../scripts/testing/setup-test-database';

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '../.env.test'),
});

// Setup hook
beforeAll(async () => {
  // Set PostgreSQL test environment variables
  process.env.POSTGRES_HOST = 'localhost';
  process.env.POSTGRES_PORT = '5432';
  process.env.POSTGRES_DB = TEST_DB;
  process.env.POSTGRES_USER = 'postgres';
  process.env.POSTGRES_PASSWORD = 'postgres';
  process.env.POSTGRES_SSL = 'false';

  // Setup test database with migrations
  await setupTestDatabase();
});

// Teardown hook
afterAll(async () => {
  // Cleanup test database
  await teardownTestDatabase();
});
