import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RssItem } from '../src/models/RssItem.js';
import { getSettings } from '../src/models/Settings.js';

const { parseURL } = vi.hoisted(() => ({ parseURL: vi.fn() }));
vi.mock('rss-parser', () => ({
  default: class {
    parseURL = parseURL;
  },
}));

import { pollAllFeeds } from '../src/jobs/pollRss.js';

describe('pollAllFeeds', () => {
  beforeEach(() => parseURL.mockReset());

  it('caches items per feed and is idempotent across polls', async () => {
    const settings = await getSettings();
    settings.rssFeeds = ['https://a.com/rss'];
    await settings.save();
    parseURL.mockResolvedValue({
      title: 'A News',
      items: [
        { guid: 'g1', title: 'One', link: 'https://a.com/1', isoDate: '2026-07-01T00:00:00.000Z' },
        { title: 'Two', link: 'https://a.com/2' }, // no guid → link used
        { title: 'No link or guid' }, // skipped
      ],
    });
    await pollAllFeeds();
    await pollAllFeeds(); // second poll must not duplicate
    const items = await RssItem.find().sort({ title: 1 });
    expect(items).toHaveLength(2);
    expect(items[0].guid).toBe('g1');
    expect(items[0].sourceTitle).toBe('A News');
    expect(items[0].publishedAt.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(items[1].guid).toBe('https://a.com/2');
  });

  it('one failing feed does not block the others', async () => {
    const settings = await getSettings();
    settings.rssFeeds = ['https://dead.com/rss', 'https://ok.com/rss'];
    await settings.save();
    parseURL.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      title: 'OK',
      items: [{ guid: 'x', title: 'Works', link: 'https://ok.com/1' }],
    });
    await expect(pollAllFeeds()).resolves.toBeUndefined();
    expect(await RssItem.countDocuments()).toBe(1);
  });

  it('guards unsafe link schemes and caps stored string sizes', async () => {
    const settings = await getSettings();
    settings.rssFeeds = ['https://a.com/rss'];
    await settings.save();
    parseURL.mockResolvedValue({
      title: 'A News',
      items: [
        { guid: 'evil', title: 'XSS attempt', link: 'javascript:alert(1)' },
        { guid: 'long', title: 'x'.repeat(10_000), link: 'https://a.com/long' },
      ],
    });
    await pollAllFeeds();
    const evil = await RssItem.findOne({ guid: 'evil' });
    expect(evil).not.toBeNull();
    expect(evil!.link).toBe('');
    const long = await RssItem.findOne({ guid: 'long' });
    expect(long!.title).toHaveLength(300);
  });

  it('does nothing with no feeds configured', async () => {
    await pollAllFeeds();
    expect(parseURL).not.toHaveBeenCalled();
  });
});
