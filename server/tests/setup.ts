process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
process.env.MONGODB_URI = 'mongodb://placeholder:27017/test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  // Let any fire-and-forget driver work queued by app.ts (e.g. connect-mongo's
  // background TTL index creation) settle before closing the client; otherwise
  // it surfaces as an unhandled MongoClientClosedError rejection.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await mongoose.disconnect();
  await mongod.stop();
});
