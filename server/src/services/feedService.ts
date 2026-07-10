import { ActivityEvent, type ActivityEventDoc } from '../models/ActivityEvent.js';
import { RssItem, type RssItemDoc } from '../models/RssItem.js';
import type { UserDoc } from '../models/User.js';

const PAGE_SIZE = 20;

export type FeedFilter = 'all' | 'internal' | 'external';

export interface FeedItem {
  id: string;
  kind: 'internal' | 'external';
  title: string;
  link: string;
  source?: string;
  pinnedUntil?: Date | null;
  date: Date;
}

function toInternalItem(e: ActivityEventDoc): FeedItem {
  return {
    id: e.id as string,
    kind: 'internal',
    title: e.message,
    link: e.link,
    pinnedUntil: e.pinnedUntil,
    date: e.get('createdAt') as Date,
  };
}

function toExternalItem(r: RssItemDoc): FeedItem {
  return {
    id: r.id as string,
    kind: 'external',
    title: r.title,
    link: r.link,
    source: r.sourceTitle,
    date: r.publishedAt,
  };
}

export async function getFeed(
  user: UserDoc,
  filter: FeedFilter,
  before: Date | null,
): Promise<{ pinned: FeedItem[]; items: FeedItem[]; nextCursor: string | null }> {
  const now = new Date();
  const isAdmin = user.role === 'broker' || user.role === 'officeAdmin';
  const officeScope = isAdmin ? {} : { $or: [{ officeId: null }, { officeId: user.officeId }] };

  const internalFilter: Record<string, unknown> = {
    $and: [officeScope, { $or: [{ pinnedUntil: null }, { pinnedUntil: { $lte: now } }] }],
  };
  if (before) internalFilter.createdAt = { $lt: before };

  const [internal, external, pinnedDocs] = await Promise.all([
    filter === 'external'
      ? []
      : ActivityEvent.find(internalFilter).sort({ createdAt: -1 }).limit(PAGE_SIZE),
    filter === 'internal'
      ? []
      : RssItem.find(before ? { publishedAt: { $lt: before } } : {})
          .sort({ publishedAt: -1 })
          .limit(PAGE_SIZE),
    // Pinned block appears on the first page only.
    before || filter === 'external'
      ? []
      : ActivityEvent.find({ $and: [officeScope, { pinnedUntil: { $gt: now } }] }).sort({ createdAt: -1 }),
  ]);

  const items = [...internal.map(toInternalItem), ...external.map(toExternalItem)]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, PAGE_SIZE);

  return {
    pinned: pinnedDocs.map(toInternalItem),
    items,
    nextCursor: items.length === PAGE_SIZE ? items[items.length - 1].date.toISOString() : null,
  };
}
