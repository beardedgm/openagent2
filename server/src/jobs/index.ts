import type { Agenda, Job } from 'agenda';
import { publishPostSideEffects } from '../services/postService.js';
import { pollAllFeeds } from './pollRss.js';

export function registerJobs(agenda: Agenda): void {
  agenda.define('publish-post', async (job: Job) => {
    const { postId } = (job.attrs.data ?? {}) as { postId?: string };
    if (postId) await publishPostSideEffects(postId);
  });
  agenda.define('poll-rss', async () => {
    await pollAllFeeds();
  });
}
