import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from 'dotenv';
import * as path from 'path';

let mongod: MongoMemoryServer;

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '../.env.test'),
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
});

afterAll(async () => {
  if (mongod) {
    await mongod.stop();
  }
});
