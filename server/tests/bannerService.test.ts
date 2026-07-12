import { describe, expect, it } from 'vitest';
import { Banner, toPublicBanner } from '../src/models/Banner.js';
import { User } from '../src/models/User.js';
import { activeBannersFor, createBanner, duplicateBanner, updateBanner } from '../src/services/bannerService.js';

async function makeUser(email: string, role = 'broker', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

const DAY = 24 * 60 * 60 * 1000;

describe('bannerService', () => {
  it('sanitizes rich-text bodies and validates schedule order', async () => {
    const broker = await makeUser('b1@x.com');
    const banner = await createBanner(
      {
        kind: 'text',
        title: 'Q3 kickoff',
        bodyHtml: '<p>Join us <script>alert(1)</script><strong>Friday</strong></p>',
        ctaLabel: 'RSVP',
        ctaUrl: 'https://example.com/rsvp',
        startAt: new Date(Date.now() - DAY),
        endAt: new Date(Date.now() + DAY),
      },
      broker,
    );
    expect(banner.bodyHtml).toBe('<p>Join us <strong>Friday</strong></p>');
    await expect(
      createBanner(
        { kind: 'text', title: 'Bad', bodyHtml: '<p>x</p>', startAt: new Date(Date.now() + DAY), endAt: new Date() },
        broker,
      ),
    ).rejects.toThrow(/end/i);
    await expect(
      createBanner(
        { kind: 'text', title: 'NoBody', startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY) },
        broker,
      ),
    ).rejects.toThrow(/content/i);
    await expect(
      createBanner(
        { kind: 'image', title: 'NoImage', startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY) },
        broker,
      ),
    ).rejects.toThrow(/image/i);
  });

  it('strips links from banner bodies — the CTA is the banner\'s only action', async () => {
    const broker = await makeUser('b6@x.com');
    const banner = await createBanner(
      {
        kind: 'text',
        title: 'Linky',
        bodyHtml: '<p>Hi <a href="https://evil.example.com">click</a></p>',
        startAt: new Date(Date.now() - DAY),
        endAt: new Date(Date.now() + DAY),
      },
      broker,
    );
    expect(banner.bodyHtml).toBe('<p>Hi click</p>');
    const updated = await updateBanner(banner.id, {
      bodyHtml: '<p>Also <a href="https://evil.example.com">here</a> <strong>bold</strong></p>',
    });
    expect(updated.bodyHtml).toBe('<p>Also here <strong>bold</strong></p>');
  });

  it('activeBannersFor: schedule window + office targeting', async () => {
    const officeA = '64b000000000000000000001';
    const broker = await makeUser('b2@x.com');
    const agentA = await makeUser('b3@x.com', 'agent', officeA);
    const mk = (title: string, offset: [number, number], officeId: string | null = null) =>
      createBanner(
        { kind: 'text', title, bodyHtml: '<p>x</p>', startAt: new Date(Date.now() + offset[0] * DAY), endAt: new Date(Date.now() + offset[1] * DAY), officeId },
        broker,
      );
    await mk('live-everyone', [-1, 1]);
    await mk('live-officeA', [-1, 1], officeA);
    await mk('live-otherOffice', [-1, 1], '64b000000000000000000002');
    await mk('expired', [-3, -1]);
    await mk('future', [1, 3]);

    const forAgent = await activeBannersFor(agentA);
    expect(forAgent.map((b) => b.title).sort()).toEqual(['live-everyone', 'live-officeA']);
    // The homepage slot is office-personal even for admins; the admin LIST route
    // (Task 8) is where everything is visible.
    const forBroker = await activeBannersFor(broker);
    expect(forBroker.map((b) => b.title)).toEqual(['live-everyone']);
  });

  it('duplicate copies fields, resets clicks, suffixes the title', async () => {
    const broker = await makeUser('b4@x.com');
    const original = await createBanner(
      { kind: 'text', title: 'Original', bodyHtml: '<p>x</p>', startAt: new Date(), endAt: new Date(Date.now() + DAY) },
      broker,
    );
    original.clickCount = 42;
    await original.save();
    const copy = await duplicateBanner(original.id, broker);
    expect(copy.title).toBe('Original (copy)');
    expect(copy.clickCount).toBe(0);
    expect(copy.bodyHtml).toBe('<p>x</p>');
    expect(await Banner.countDocuments()).toBe(2);
    expect(toPublicBanner(copy).id).not.toBe(original.id);
  });

  it('update re-checks the schedule and content invariants and sanitizes the patch', async () => {
    const broker = await makeUser('b5@x.com');
    const banner = await createBanner(
      { kind: 'text', title: 'Editable', bodyHtml: '<p>v1</p>', startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY) },
      broker,
    );
    await expect(updateBanner(banner.id, { endAt: new Date(Date.now() - 2 * DAY) })).rejects.toThrow(/end/i);
    await expect(updateBanner(banner.id, { bodyHtml: '' })).rejects.toThrow(/content/i);
    const updated = await updateBanner(banner.id, {
      title: 'Edited',
      bodyHtml: '<p>v2 <script>alert(1)</script><em>ok</em></p>',
    });
    expect(updated.title).toBe('Edited');
    expect(updated.bodyHtml).toBe('<p>v2 <em>ok</em></p>');
    const fresh = await Banner.findById(banner.id);
    expect(fresh?.bodyHtml).toBe('<p>v2 <em>ok</em></p>');
  });
});
