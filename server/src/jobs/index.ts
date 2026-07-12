import type { Agenda, Job } from 'agenda';
import { publishPostSideEffects } from '../services/postService.js';
import { sweepEventReminders } from './eventReminders.js';
import { pollAllFeeds } from './pollRss.js';
import { sweepRetention } from './retentionSweep.js';
import { sweepTasks } from './taskSweep.js';

export function registerJobs(agenda: Agenda): void {
  agenda.define('publish-post', async (job: Job) => {
    const { postId } = (job.attrs.data ?? {}) as { postId?: string };
    if (postId) await publishPostSideEffects(postId);
  });
  agenda.define('poll-rss', async () => {
    await pollAllFeeds();
  });
  agenda.define('event-reminders', async () => {
    await sweepEventReminders();
  });
  agenda.define('task-sweep', async () => {
    await sweepTasks();
  });
  agenda.define('retention-sweep', async () => {
    await sweepRetention();
  });
}
