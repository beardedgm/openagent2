import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function connectDb(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  logger.info('mongo connected');
}
