import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from 'dotenv';
import * as path from 'path';

let mongod: MongoMemoryServer;

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '../.env.test'),
});

export const setupTestEnvironment = async (): Promise<void> => {
  // Start MongoDB memory server
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
};

export const teardownTestEnvironment = async (): Promise<void> => {
  // Stop MongoDB memory server
  if (mongod) {
    await mongod.stop();
  }
};
