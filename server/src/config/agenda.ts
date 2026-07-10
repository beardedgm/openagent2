import { Agenda } from 'agenda';
import { env } from './env.js';
import { logger } from './logger.js';

// Module-level so schedule/cancel helpers can reach the running instance.
// Stays null in tests and scripts — helpers then no-op (immediate posts publish
// inline; missed one-off jobs catch up on next boot because Agenda runs anything
// whose nextRunAt is already in the past).
let agenda: Agenda | null = null;

export async function startAgenda(registerJobs: (a: Agenda) => void): Promise<void> {
  // Own connection on purpose: agenda 5 bundles mongodb v4 and must not share
  // mongoose 8's mongodb-6 Db handle (findOneAndUpdate return-shape mismatch
  // would break job claiming silently).
  agenda = new Agenda({ db: { address: env.MONGODB_URI, collection: 'agendaJobs' }, processEvery: '1 minute' });
  registerJobs(agenda);
  await agenda.start();
  await agenda.every('60 minutes', 'poll-rss');
  logger.info('agenda started (poll-rss hourly)');
}

export async function stopAgenda(): Promise<void> {
  if (!agenda) return;
  // drain() waits for in-flight jobs to finish (stop() would unlock them
  // immediately and process.exit would abort them mid-run); race a timeout so
  // shutdown can't hang past Render's SIGKILL window.
  await Promise.race([agenda.drain(), new Promise((r) => setTimeout(r, 25_000))]);
  agenda = null;
}

export async function schedulePostPublish(postId: string, when: Date): Promise<void> {
  if (!agenda) return;
  // Cancel-then-schedule: repeated post edits replace the job, never accumulate.
  await agenda.cancel({ name: 'publish-post', 'data.postId': postId });
  await agenda.schedule(when, 'publish-post', { postId });
}

export async function cancelPostPublish(postId: string): Promise<void> {
  if (!agenda) return;
  await agenda.cancel({ name: 'publish-post', 'data.postId': postId });
}
