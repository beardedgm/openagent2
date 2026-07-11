import { createApp } from './app.js';
import { startAgenda, stopAgenda } from './config/agenda.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { registerJobs } from './jobs/index.js';

async function start(): Promise<void> {
  await connectDb();
  await startAgenda(registerJobs);
  if (env.NODE_ENV === 'production' && !env.TURNSTILE_SECRET_KEY)
    logger.warn('TURNSTILE_SECRET_KEY not set — bot protection is disabled in production');
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'r2' && !env.R2_PRIVATE_BUCKET)
    logger.warn('R2_PRIVATE_BUCKET not set — protected files will live in the PUBLIC bucket and are fetchable by key');
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local')
    logger.warn('STORAGE_DRIVER=local in production — uploads are ephemeral on Render and served from local disk');
  const app = createApp();
  app.listen(env.PORT, () => logger.info(`listening on :${env.PORT}`));

  process.on('SIGTERM', () => {
    void stopAgenda().finally(() => process.exit(0));
  });
}

start().catch((err) => {
  logger.error(err, 'fatal: server failed to start');
  process.exit(1);
});
