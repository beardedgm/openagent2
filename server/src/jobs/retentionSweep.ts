import { logger } from '../config/logger.js';
import { ActivityEvent } from '../models/ActivityEvent.js';
import { RssItem } from '../models/RssItem.js';
import { Task } from '../models/Task.js';

const DAY = 24 * 60 * 60 * 1000;

/** PRD retention: internal activity 90d, RSS items 30d, task history 2y (5.2/5.7).
 * The job is the single retention mechanism — no TTL indexes — so deletions are
 * observable in logs and testable. Pinned feed items and actively recurring tasks
 * are never deleted. */
export async function sweepRetention(now = new Date()): Promise<{ activity: number; rss: number; tasks: number }> {
  const activity = await ActivityEvent.deleteMany({
    createdAt: { $lt: new Date(now.getTime() - 90 * DAY) },
    $or: [{ pinnedUntil: null }, { pinnedUntil: { $lte: now } }],
  });
  const rss = await RssItem.deleteMany({ createdAt: { $lt: new Date(now.getTime() - 30 * DAY) } });
  const tasks = await Task.deleteMany({
    createdAt: { $lt: new Date(now.getTime() - 2 * 365 * DAY) },
    nextRecurrenceAt: null,
  });
  const counts = { activity: activity.deletedCount, rss: rss.deletedCount, tasks: tasks.deletedCount };
  logger.info(counts, 'retention sweep complete');
  return counts;
}
