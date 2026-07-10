import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start(): Promise<void> {
  await connectDb();
  if (env.NODE_ENV === 'production' && !env.TURNSTILE_SECRET_KEY)
    logger.warn('TURNSTILE_SECRET_KEY not set — bot protection is disabled in production');
  const app = createApp();
  app.listen(env.PORT, () => logger.info(`listening on :${env.PORT}`));
}

start().catch((err) => {
  logger.error(err, 'fatal: server failed to start');
  process.exit(1);
});
