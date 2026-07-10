import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start(): Promise<void> {
  await connectDb();
  const app = createApp();
  app.listen(env.PORT, () => logger.info(`listening on :${env.PORT}`));
}

void start();
