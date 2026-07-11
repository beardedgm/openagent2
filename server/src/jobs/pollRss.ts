import Parser from 'rss-parser';
import { logger } from '../config/logger.js';
import { RssItem } from '../models/RssItem.js';
import { getSettings } from '../models/Settings.js';

const parser = new Parser({ timeout: 10_000 });
const MAX_FEEDS = 10;
const MAX_ITEMS_PER_FEED = 50;

export async function pollAllFeeds(): Promise<void> {
  const settings = await getSettings();
  for (const feedUrl of settings.rssFeeds.slice(0, MAX_FEEDS)) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const ops = (feed.items ?? []).slice(0, MAX_ITEMS_PER_FEED).flatMap((item) => {
        const guid = item.guid ?? item.link;
        if (!guid || !item.title) return [];
        // Feed items are untrusted third-party content; scheme-guarding here protects every future renderer.
        const safeLink = /^https?:\/\//i.test(item.link ?? '') ? item.link! : '';
        return [
          {
            updateOne: {
              filter: { feedUrl, guid },
              update: {
                $set: {
                  title: item.title.slice(0, 300),
                  link: safeLink,
                  sourceTitle: (feed.title ?? feedUrl).slice(0, 120),
                },
                $setOnInsert: { publishedAt: item.isoDate ? new Date(item.isoDate) : new Date() },
              },
              upsert: true,
            },
          },
        ];
      });
      // Unordered so a partial failure doesn't abort sibling upserts.
      if (ops.length > 0) await RssItem.bulkWrite(ops, { ordered: false });
    } catch (err) {
      logger.error({ err, feedUrl }, 'rss poll failed for feed');
    }
  }
}
