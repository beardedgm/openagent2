# Stage 3 — Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the coordination layer: shared calendar (month/week/day, recurrence, RSVP, reservable resources with conflict check, reminders, mandatory events), task management (per-assignee completion, priorities, attachments, recurrence, templates, due/overdue notifications), and structured onboarding (auto-assigned template, homepage progress bar, admin status view).

**Architecture:** Everything extends Stage 1–2 machinery — new Mongoose models (`CalendarEvent`, `Task`, `TaskTemplate`), thin routes calling services, Zod validation, the Stage 2 `notify()`/`emitActivity()` fan-outs, and Agenda. Two design pillars: (1) **calendar recurrence is expanded at query time** by a pure, unit-tested function — no materialized instances, no spawner job; (2) **all time-driven task/event behavior runs through two idempotent 15-minute Agenda sweeper jobs** (`task-sweep`, `event-reminders`) that claim per-user latches with atomic updates, so a sleeping free host catches up safely on boot. Task attachments are protected files: an authenticated download route 302-redirects to a 15-minute presigned R2 URL in production and streams from disk in dev. All datetimes stored UTC, rendered in the viewer's browser timezone (spec decision #6).

**Tech Stack:** Adds `@aws-sdk/s3-request-presigner` (server) only. No client dependencies — the calendar month grid is a small pure utility, not a calendar library. Everything else is the existing stack (Express 4, Mongoose 8, Zod 3, Agenda 5, Vitest 2 + Supertest + mongodb-memory-server, React 18 + TanStack Query 5, TipTap via the existing `RichTextEditor`).

**Conventions for every task:**
- Run all commands from the repo root (`C:\Users\derri\OneDrive\Desktop\openagent`). Bash syntax.
- Server relative imports MUST use `.js` extensions (ESM + NodeNext) even in `.ts` source.
- Work on branch `feat/stage-3-coordination` (created in Task 1). Commit after each green task. Never commit `.env`. Never push — the controller pushes.
- Server tests: `npm -w server run test`. Client: `npm -w client run test`. The in-memory-Mongo test setup already exists; Agenda is never started in tests (job handlers are exported functions tested directly — the Stage 2 pattern).
- Rich text is ALWAYS sanitized server-side with the existing `sanitizePostHtml`/`htmlToText` (`server/src/utils/sanitizeHtml.ts`); client renders stored HTML only via the PostPage `dangerouslySetInnerHTML` pattern with the same safety comment.
- Match Stage 2 patterns: `toPublicX` mappers with populated authors, `visibilityFilter(req)` helpers, error surfacing via `role="alert"` + isAxiosError, 44px touch targets, aria-labels on icon buttons, mutations invalidating exact query-key prefixes.
- Baseline at branch time: server 102 tests, client 34. Each task states the expected totals after it.

**Stage-3 scope decisions (locked — do not relitigate during implementation):**
- Recurrence enum is `none | daily | weekly | monthly` (roadmap wording). The PRD's "custom" recurrence is deferred to Phase 2 — RRULE support is not worth the complexity for a single brokerage; documented here as the accepted delta.
- RSVP and the reminder opt-in apply to the event as a whole (all occurrences), not per-occurrence.
- Event reminders are **email-only** (PRD 5.4: "users opt into email reminders") and **opt-in** — the sweeper checks `emailPrefs.get('eventReminders') === true` explicitly (unlike other prefs, absent means OFF). "Attending" = RSVP'd Yes, or targeted by a mandatory event.
- Resource conflict checks expand recurrence over a 180-day horizon from the candidate event's start — a bounded, honest window (documented in code).
- `Task.relatedResourceId` field ships now (PRD field list) but has no UI until Stage 4's Resource Hub exists.
- Recurring tasks: the parent task carries `recurrence` + `nextRecurrenceAt`; the sweeper spawns plain (non-recurring) instances, re-resolving the audience fresh each time (new office members ARE picked up by later instances; the per-instance snapshot rule still holds).
- Attachment types allowlist: pdf, png, jpeg, webp, txt, csv, docx, xlsx. 25MB each, max 5 per task, upload after the task exists (from the task detail page).

**API surface added (all under `/api/v1`):**

| Method & path | Who | Purpose |
|---|---|---|
| `GET /events?from&to&filter` | any user | expanded occurrences in range (visibility-scoped) |
| `GET /events/:id` | any user (scoped) | event detail + own RSVP + creator summary |
| `POST /events` · `PATCH /events/:id` · `DELETE /events/:id` | personal: any; office: officeAdmin+ | CRUD (mandatory flag broker-only) |
| `POST /events/:id/rsvp` | targeted users | body `{response: 'yes'\|'no'\|'maybe'}` |
| `GET /tasks?scope=mine\|all` | mine: any; all: officeAdmin+ | task lists |
| `GET /tasks/:id` | assignee/creator/admin | detail incl. completions (matrix admin-only) |
| `POST /tasks` · `DELETE /tasks/:id` | officeAdmin+ | create (audience resolution) / delete |
| `POST /tasks/:id/complete` | assignee (or admin on behalf via `userId`) | body `{note?}` |
| `POST /tasks/:id/attachments` · `GET /tasks/:id/attachments/:index/download` | officeAdmin+ upload; assignee/creator/admin download | protected files |
| `GET /tasks/onboarding/status` | officeAdmin+ | per-user onboarding progress |
| `GET /tasks/onboarding/mine` | any user | own onboarding progress |
| `GET /task-templates` · `POST` · `PATCH /:id` · `DELETE /:id` | broker | template CRUD |

---

### Task 1: Branch, dependency, enum + activity-visibility groundwork

**Files:**
- Modify: `server/package.json` (via npm install)
- Modify: `server/src/models/Notification.ts:5` (extend enum)
- Modify: `server/src/models/ActivityEvent.ts` (extend enum; add `userId` visibility field)
- Modify: `server/src/services/feedService.ts` (internal filter honors `userId` visibility)
- Test: `server/tests/feed.test.ts` (append one test)

Stage 2 left forward-pointing comments on both enums — this task cashes them in, and adds the one cross-cutting schema change the feed needs: PRD 5.2 lists "task completed (**your own**)" as an internal feed event, which requires per-user visibility that `officeId` scoping can't express.

- [ ] **Step 1: Create branch and install the presigner**

```bash
git checkout main && git pull
git checkout -b feat/stage-3-coordination
npm -w server install @aws-sdk/s3-request-presigner@^3.716.0
```

- [ ] **Step 2: Extend the enums**

In `server/src/models/Notification.ts` replace the `NOTIFICATION_TYPES` line (keep the comment above it, trimming the now-implemented types from it):

```ts
export const NOTIFICATION_TYPES = [
  'invitationAccepted',
  'postPublished',
  'taskAssigned',
  'taskDueSoon',
  'taskOverdue',
  'mandatoryEvent',
] as const;
```

In `server/src/models/ActivityEvent.ts` replace the `ACTIVITY_TYPES` line (Stage 4 still appends `resourceUploaded`):

```ts
export const ACTIVITY_TYPES = [
  'agentJoined',
  'announcementPosted',
  'taskAssigned',
  'taskCompleted',
  'eventCreated',
] as const;
```

And add a visibility field to the schema, after `officeId`:

```ts
    // When set, the event is visible ONLY to this user (e.g. "you completed task X").
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
```

- [ ] **Step 3: Append a failing feed-visibility test**

Append to `server/tests/feed.test.ts` (inside the existing `describe('feed', …)`; `loginAs` and models are already imported there):

```ts
  it('user-scoped events show only to that user', async () => {
    const app = createApp();
    const alice = await loginAs(app, 'f7@x.com', 'agent');
    const bob = await loginAs(app, 'f8@x.com', 'agent');
    const aliceUser = (await User.findOne({ email: 'f7@x.com' }))!;
    await ActivityEvent.create({ type: 'taskCompleted', message: 'You completed: File taxes', userId: aliceUser.id });
    await ActivityEvent.create({ type: 'agentJoined', message: 'public event' });

    const aliceFeed = await alice.get('/api/v1/feed');
    expect(aliceFeed.body.items.map((i: { title: string }) => i.title).sort()).toEqual([
      'You completed: File taxes',
      'public event',
    ]);
    const bobFeed = await bob.get('/api/v1/feed');
    expect(bobFeed.body.items.map((i: { title: string }) => i.title)).toEqual(['public event']);
  });
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm -w server run test -- tests/feed.test.ts`
Expected: FAIL — alice's user-scoped event leaks to bob (no userId filter yet). (The `taskCompleted` enum value must already be in place from Step 2 or the create throws.)

- [ ] **Step 5: Add the visibility clause in `server/src/services/feedService.ts`**

In `getFeed`, the internal filter currently reads:

```ts
  const internalFilter: Record<string, unknown> = {
    $and: [officeScope, { $or: [{ pinnedUntil: null }, { pinnedUntil: { $lte: now } }] }],
  };
```

Change it to add the user-visibility clause (and mirror it in the pinned query's `$and` array two statements below):

```ts
  const userScope = { $or: [{ userId: null }, { userId: user.id }] };
  const internalFilter: Record<string, unknown> = {
    $and: [officeScope, userScope, { $or: [{ pinnedUntil: null }, { pinnedUntil: { $lte: now } }] }],
  };
```

Pinned query becomes:

```ts
      : ActivityEvent.find({ $and: [officeScope, userScope, { pinnedUntil: { $gt: now } }] }).sort({ createdAt: -1 }),
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 103 tests (102 + 1).

- [ ] **Step 7: Commit**

```bash
git add package-lock.json server/package.json server/src/models/Notification.ts server/src/models/ActivityEvent.ts server/src/services/feedService.ts server/tests/feed.test.ts
git commit -m "feat(server): stage 3 groundwork — enums, user-scoped activity visibility, presigner dep"
```

---

### Task 2: Settings — reservable resources

**Files:**
- Modify: `server/src/models/Settings.ts` (add subdoc array)
- Modify: `server/src/validators/settings.ts` (accept the new field)
- Test: `server/tests/settings.test.ts` (append)

PRD 5.4.2: "Broker/Owner defines reservable resources in Admin Panel." They live on the Settings singleton exactly like `officeLocations` (subdocs get `_id`s that events reference). `Settings.onboardingTaskTemplateId` already exists from Stage 1 — no change needed there.

- [ ] **Step 1: Append a failing test** to `server/tests/settings.test.ts` (inside the existing describe; `loginAs` exists there):

```ts
  it('broker manages reservable resources', async () => {
    const broker = await loginAs(app, 'b3@x.com', 'broker');
    const res = await broker
      .patch('/api/v1/admin/settings')
      .send({ reservableResources: [{ name: 'Conference Room A' }, { name: 'Training Room' }] });
    expect(res.status).toBe(200);
    expect(res.body.settings.reservableResources).toHaveLength(2);
    expect(res.body.settings.reservableResources[0].name).toBe('Conference Room A');
    expect(res.body.settings.reservableResources[0]._id).toBeTruthy(); // events reference this id
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w server run test -- tests/settings.test.ts`
Expected: FAIL — `reservableResources` stripped by the validator / absent from the response.

- [ ] **Step 3: Add the field to `server/src/models/Settings.ts`**

After the `officeSchema` definition add:

```ts
const reservableResourceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
});
```

And in `settingsSchema`, after `officeLocations`:

```ts
    reservableResources: { type: [reservableResourceSchema], default: [] },
```

- [ ] **Step 4: Extend `server/src/validators/settings.ts`**

Read the file first; it defines `updateSettingsSchema`. Add alongside the `officeLocations` entry, matching its optional-array style:

```ts
  reservableResources: z
    .array(z.object({ _id: z.string().optional(), name: z.string().trim().min(1).max(80) }))
    .max(50)
    .optional(),
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 104 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/models/Settings.ts server/src/validators/settings.ts server/tests/settings.test.ts
git commit -m "feat(server): reservable resources on brokerage settings"
```

---

### Task 3: Storage — private files + download resolution

**Files:**
- Modify: `server/src/services/storage.ts`
- Test: `server/tests/storage.test.ts` (new)

Task attachments are protected files (spec §3): public URLs are wrong for them. The port gains `putPrivate` (returns a storage KEY, not a URL) and `resolveDownload` (R2 → 15-minute presigned GET URL; local → absolute file path for streaming). The download ROUTE (Task 12) does authz and then either 302-redirects (R2) or streams (local).

- [ ] **Step 1: Write the failing tests** — create `server/tests/storage.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_UPLOAD_DIR, makeAttachmentKey, storage } from '../src/services/storage.js';

describe('private storage (local driver)', () => {
  it('putPrivate writes under the private prefix and returns the key', async () => {
    const key = makeAttachmentKey('tasks', 'report.pdf');
    expect(key).toMatch(/^private\/tasks\/[a-f0-9]{24}\/report\.pdf$/);
    const returned = await storage.putPrivate(key, Buffer.from('%PDF-fake'), 'application/pdf');
    expect(returned).toBe(key);
    expect(readFileSync(join(LOCAL_UPLOAD_DIR, key)).toString()).toBe('%PDF-fake');
  });

  it('resolveDownload returns a local file path in dev', async () => {
    const key = makeAttachmentKey('tasks', 'notes.txt');
    await storage.putPrivate(key, Buffer.from('hello'), 'text/plain');
    const dl = await storage.resolveDownload(key);
    expect(dl.kind).toBe('file');
    if (dl.kind === 'file') expect(readFileSync(dl.path).toString()).toBe('hello');
  });

  it('sanitizes hostile filenames in keys', () => {
    const key = makeAttachmentKey('tasks', '../../evil <script>.pdf');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^private\/tasks\/[a-f0-9]{24}\/[a-zA-Z0-9._-]+$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w server run test -- tests/storage.test.ts`
Expected: FAIL — `makeAttachmentKey`/`putPrivate` not exported.

- [ ] **Step 3: Extend `server/src/services/storage.ts`**

Replace the file's contents with (this preserves every existing export unchanged and adds the private-file surface):

```ts
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

/** Where a protected download lives: a presigned URL (R2) or a disk path to stream (local). */
export type DownloadTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string };

export interface StoragePort {
  putPublic(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Stores a protected file. Returns the storage key — protected files have no public URL. */
  putPrivate(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Resolves a protected key for download. R2: 15-minute presigned GET. Local: disk path. */
  resolveDownload(key: string): Promise<DownloadTarget>;
}

export const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');
const SIGNED_URL_TTL_SECONDS = 15 * 60; // spec §3: 15-minute expiry

class LocalStorage implements StoragePort {
  async putPublic(key: string, body: Buffer): Promise<string> {
    await this.write(key, body);
    return `/files/${key}`;
  }

  async putPrivate(key: string, body: Buffer): Promise<string> {
    await this.write(key, body);
    return key;
  }

  async resolveDownload(key: string): Promise<DownloadTarget> {
    return { kind: 'file', path: join(LOCAL_UPLOAD_DIR, key) };
  }

  private async write(key: string, body: Buffer): Promise<void> {
    const path = join(LOCAL_UPLOAD_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}

class R2Storage implements StoragePort {
  private client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });

  async putPublic(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    return `${env.R2_PUBLIC_BASE_URL}/${key}`;
  }

  async putPrivate(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  async resolveDownload(key: string): Promise<DownloadTarget> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return { kind: 'url', url };
  }
}

export const storage: StoragePort = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function makeKey(prefix: string, contentType: string): string {
  const ext = EXT_BY_TYPE[contentType] ?? 'bin';
  return `${prefix}/${randomBytes(12).toString('hex')}.${ext}`;
}

/** Protected-file key: private/<scope>/<random>/<sanitized original name>. The original
 * name is kept (sanitized) so downloads can carry a human filename. */
export function makeAttachmentKey(scope: string, originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\.+/g, '_').slice(-80) || 'file';
  return `private/${scope}/${randomBytes(12).toString('hex')}/${safe}`;
}
```

- [ ] **Step 4: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 107 tests (104 + 3). Also `npm -w server run typecheck` exits 0.

**Note:** the local `/files` static mount in `app.ts` serves everything under `uploads/` — including `uploads/private/`. That hole is closed in Task 12 alongside the download route (kept there so this task stays storage-only). Do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/storage.ts server/tests/storage.test.ts
git commit -m "feat(server): private storage with presigned/streamed download resolution"
```

---

### Task 4: CalendarEvent model + recurrence expansion utility

**Files:**
- Create: `server/src/utils/recurrence.ts`
- Create: `server/src/models/CalendarEvent.ts`
- Test: `server/tests/recurrence.test.ts`, `server/tests/events.test.ts` (started here)

Recurrence is expanded **at query time** by a pure function — no materialized occurrence documents. Daily/weekly step by fixed absolute intervals (UTC); monthly steps calendar months with end-of-month clamping (Jan 31 → Feb 28). Wall-clock drift across DST for daily/weekly is an accepted consequence of UTC storage (spec decision #6) — documented in the util.

- [ ] **Step 1: Write the failing recurrence tests** — create `server/tests/recurrence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { expandOccurrences } from '../src/utils/recurrence.js';

const D = (s: string) => new Date(s);
const HOUR = 3_600_000;

function ev(overrides: Partial<Parameters<typeof expandOccurrences>[0]> = {}) {
  return {
    startAt: D('2026-01-05T15:00:00.000Z'),
    endAt: D('2026-01-05T16:00:00.000Z'),
    recurrence: 'none' as const,
    recurrenceUntil: null,
    ...overrides,
  };
}

describe('expandOccurrences', () => {
  it('returns a single occurrence for non-recurring events overlapping the range', () => {
    const occs = expandOccurrences(ev(), D('2026-01-01T00:00:00Z'), D('2026-01-31T00:00:00Z'));
    expect(occs).toHaveLength(1);
    expect(occs[0].startAt.toISOString()).toBe('2026-01-05T15:00:00.000Z');
    expect(expandOccurrences(ev(), D('2026-02-01T00:00:00Z'), D('2026-02-28T00:00:00Z'))).toHaveLength(0);
  });

  it('expands daily occurrences inside the range only', () => {
    const occs = expandOccurrences(
      ev({ recurrence: 'daily' }),
      D('2026-01-10T00:00:00Z'),
      D('2026-01-13T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-10T15:00:00.000Z',
      '2026-01-11T15:00:00.000Z',
      '2026-01-12T15:00:00.000Z',
    ]);
    expect(occs[0].endAt.getTime() - occs[0].startAt.getTime()).toBe(HOUR);
  });

  it('expands weekly and respects recurrenceUntil (inclusive of occurrences starting before it)', () => {
    const occs = expandOccurrences(
      ev({ recurrence: 'weekly', recurrenceUntil: D('2026-01-20T00:00:00Z') }),
      D('2026-01-01T00:00:00Z'),
      D('2026-03-01T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-05T15:00:00.000Z',
      '2026-01-12T15:00:00.000Z',
      '2026-01-19T15:00:00.000Z',
    ]);
  });

  it('expands monthly with end-of-month clamping', () => {
    const occs = expandOccurrences(
      ev({ startAt: D('2026-01-31T10:00:00Z'), endAt: D('2026-01-31T11:00:00Z'), recurrence: 'monthly' }),
      D('2026-01-01T00:00:00Z'),
      D('2026-04-30T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-31T10:00:00.000Z',
      '2026-02-28T10:00:00.000Z',
      '2026-03-31T10:00:00.000Z',
    ]);
  });

  it('never returns occurrences before the event start and caps runaway expansion', () => {
    expect(
      expandOccurrences(ev({ recurrence: 'daily' }), D('2025-01-01T00:00:00Z'), D('2025-06-01T00:00:00Z')),
    ).toHaveLength(0);
    const capped = expandOccurrences(
      ev({ recurrence: 'daily' }),
      D('2026-01-05T00:00:00Z'),
      D('2036-01-05T00:00:00Z'),
    );
    expect(capped.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w server run test -- tests/recurrence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/utils/recurrence.ts`**

```ts
export const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCE)[number];

export interface Occurrence {
  startAt: Date;
  endAt: Date;
}

interface RecurringSpan {
  startAt: Date;
  endAt: Date;
  recurrence: Recurrence;
  recurrenceUntil: Date | null;
}

const DAY_MS = 86_400_000;
const MAX_OCCURRENCES = 500;

/** Adds n calendar months in UTC, clamping the day (Jan 31 + 1mo = Feb 28). */
function addMonthsClamped(date: Date, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

/** Expands an event's occurrences that OVERLAP [rangeStart, rangeEnd).
 * Pure query-time expansion — occurrences are never persisted. Daily/weekly step
 * fixed absolute intervals (UTC), so local wall-clock shifts across DST — an
 * accepted consequence of storing UTC (spec decision #6). */
export function expandOccurrences(event: RecurringSpan, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const duration = event.endAt.getTime() - event.startAt.getTime();
  const overlaps = (s: Date, e: Date) => s < rangeEnd && e > rangeStart;
  if (event.recurrence === 'none') {
    return overlaps(event.startAt, event.endAt) ? [{ startAt: event.startAt, endAt: event.endAt }] : [];
  }

  const out: Occurrence[] = [];
  const until = event.recurrenceUntil;
  const push = (start: Date) => {
    if (until && start > until) return false;
    if (start >= rangeEnd) return false;
    const end = new Date(start.getTime() + duration);
    if (overlaps(start, end)) out.push({ startAt: start, endAt: end });
    return true;
  };

  if (event.recurrence === 'monthly') {
    for (let i = 0; out.length < MAX_OCCURRENCES; i++) {
      if (!push(addMonthsClamped(event.startAt, i))) break;
    }
    return out;
  }

  const step = event.recurrence === 'daily' ? DAY_MS : 7 * DAY_MS;
  // Skip straight to the first occurrence that could overlap the range.
  const first = Math.max(0, Math.floor((rangeStart.getTime() - duration - event.startAt.getTime()) / step));
  for (let i = first; out.length < MAX_OCCURRENCES; i++) {
    if (!push(new Date(event.startAt.getTime() + i * step))) break;
  }
  return out;
}
```

- [ ] **Step 4: Run recurrence tests**

Run: `npm -w server run test -- tests/recurrence.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `server/src/models/CalendarEvent.ts`**

```ts
import mongoose from 'mongoose';
import { RECURRENCE } from '../utils/recurrence.js';

export const RSVP_RESPONSES = ['yes', 'no', 'maybe'] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

const rsvpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    response: { type: String, enum: RSVP_RESPONSES, required: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    kind: { type: String, enum: ['office', 'personal'], required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Office events only: null targets all users. Personal events are always null.
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String, default: '', maxlength: 200 },
    recurrence: { type: String, enum: RECURRENCE, default: 'none' },
    recurrenceUntil: { type: Date, default: null },
    rsvpEnabled: { type: Boolean, default: false },
    rsvps: { type: [rsvpSchema], default: [] },
    mandatory: { type: Boolean, default: false },
    // References a Settings.reservableResources subdocument id.
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Reminder idempotency latches: "<occurrence ISO>|24h" / "…|1h" (see event-reminders job).
    remindersSent: { type: [String], default: [] },
  },
  { timestamps: true },
);
calendarEventSchema.index({ startAt: 1 });
calendarEventSchema.index({ kind: 1, officeId: 1 });
calendarEventSchema.index({ resourceId: 1 });

export const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema);
export type CalendarEventDoc = InstanceType<typeof CalendarEvent>;

export function toPublicEvent(e: CalendarEventDoc, viewerId: string) {
  return {
    id: e.id as string,
    title: e.title,
    descriptionHtml: e.descriptionHtml,
    kind: e.kind,
    createdBy: String(e.createdBy),
    officeId: e.officeId,
    startAt: e.startAt,
    endAt: e.endAt,
    allDay: e.allDay,
    location: e.location,
    recurrence: e.recurrence,
    recurrenceUntil: e.recurrenceUntil,
    rsvpEnabled: e.rsvpEnabled,
    mandatory: e.mandatory,
    resourceId: e.resourceId,
    myRsvp: e.rsvps.find((r) => String(r.userId) === viewerId)?.response ?? null,
    createdAt: e.get('createdAt') as Date,
  };
}
```

- [ ] **Step 6: Start `server/tests/events.test.ts`** with a model smoke test (service/route tests append in Tasks 5–6):

```ts
import { describe, expect, it } from 'vitest';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { User } from '../src/models/User.js';

describe('CalendarEvent model', () => {
  it('applies defaults', async () => {
    const u = await User.create({ email: 'e@x.com', hashedPassword: 'x', role: 'agent', displayName: 'e' });
    const e = await CalendarEvent.create({
      title: 'Lunch block',
      kind: 'personal',
      createdBy: u.id,
      startAt: new Date('2026-08-01T17:00:00Z'),
      endAt: new Date('2026-08-01T18:00:00Z'),
    });
    expect(e.officeId).toBeNull();
    expect(e.recurrence).toBe('none');
    expect(e.rsvpEnabled).toBe(false);
    expect(e.mandatory).toBe(false);
    expect(e.rsvps).toHaveLength(0);
    expect(e.remindersSent).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 113 tests (107 + 5 recurrence + 1 model).

- [ ] **Step 8: Commit**

```bash
git add server/src/utils/recurrence.ts server/src/models/CalendarEvent.ts server/tests/recurrence.test.ts server/tests/events.test.ts
git commit -m "feat(server): calendar event model and pure recurrence expansion"
```

---

### Task 5: Calendar service — create/update/delete, conflict check, mandatory fan-out

**Files:**
- Create: `server/src/services/calendarService.ts`
- Modify: `server/src/services/emailService.ts` (add `mandatoryEventEmail`)
- Test: `server/tests/events.test.ts` (append)

Rules the implementer must preserve:
- **Personal events are private and plain**: `officeId`, `mandatory`, `resourceId`, and `rsvpEnabled` are forced off/null for `kind: 'personal'` regardless of input.
- **Mandatory is broker-only** (PRD 5.4: "Broker/Owner can mark") — enforced here in the service, not just the route.
- **Conflict check**: a resource can be held by only one event at a time. The check expands BOTH the candidate and every other event holding the same resource over `[candidate.startAt, candidate.startAt + 180 days]` and rejects any overlap with 409. The 180-day horizon is a documented bound — recurring reservations beyond it are not checked (accepted).
- **Mandatory fan-out happens on create only** (events have no publish scheduling): `emitActivity('eventCreated', …)` + `notify(targeted users, 'mandatoryEvent', …)` with email honoring prefs. Non-mandatory events do not touch the feed (avoids feed spam).

- [ ] **Step 1: Append failing service tests** to `server/tests/events.test.ts` — add imports:

```ts
import { beforeEach, vi } from 'vitest'; // merge into the existing vitest import
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { Notification } from '../src/models/Notification.js';
import { getSettings } from '../src/models/Settings.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createEvent, deleteEvent, rsvp, updateEvent } from '../src/services/calendarService.js';
```

Then:

```ts
async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('calendarService', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('sanitizes description and strips office-only fields from personal events', async () => {
    const agent = await makeUser('c1@x.com');
    const e = await createEvent(
      {
        title: 'Block',
        descriptionHtml: '<p>mine <script>x()</script></p>',
        kind: 'personal',
        startAt: '2026-08-01T17:00:00.000Z',
        endAt: '2026-08-01T18:00:00.000Z',
        mandatory: true,
        rsvpEnabled: true,
        officeId: '64b000000000000000000001',
      },
      agent,
    );
    expect(e.descriptionHtml).toBe('<p>mine </p>');
    expect(e.mandatory).toBe(false);
    expect(e.rsvpEnabled).toBe(false);
    expect(e.officeId).toBeNull();
    expect(await ActivityEvent.countDocuments()).toBe(0); // personal events never feed
  });

  it('only a broker can create mandatory events; fan-out notifies targeted users', async () => {
    const broker = await makeUser('c2@x.com', 'broker');
    const admin = await makeUser('c3@x.com', 'officeAdmin');
    const agent = await makeUser('c4@x.com', 'agent');
    await expect(
      createEvent(
        { title: 'M', kind: 'office', startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T16:00:00.000Z', mandatory: true },
        admin,
      ),
    ).rejects.toThrow(/broker/i);
    await createEvent(
      { title: 'All hands', kind: 'office', startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T16:00:00.000Z', mandatory: true },
      broker,
    );
    expect(await ActivityEvent.countDocuments({ type: 'eventCreated' })).toBe(1);
    expect(await Notification.countDocuments({ userId: agent.id, type: 'mandatoryEvent' })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(0); // creator excluded
    // Email honors prefs (default on): admin + agent got it, creator didn't.
    expect(sendEmailMock.mock.calls.map((c) => c[0]).sort()).toEqual(['c3@x.com', 'c4@x.com']);
  });

  it('rejects overlapping resource reservations, including via recurrence', async () => {
    const broker = await makeUser('c5@x.com', 'broker');
    const settings = await getSettings();
    settings.reservableResources.push({ name: 'Conference Room A' } as never);
    await settings.save();
    const roomId = String(settings.reservableResources[0]._id);

    await createEvent(
      {
        title: 'Weekly standup',
        kind: 'office',
        startAt: '2026-08-03T15:00:00.000Z',
        endAt: '2026-08-03T16:00:00.000Z',
        recurrence: 'weekly',
        resourceId: roomId,
      },
      broker,
    );
    // Two weeks later, same slot — collides with the weekly recurrence.
    await expect(
      createEvent(
        { title: 'Clash', kind: 'office', startAt: '2026-08-17T15:30:00.000Z', endAt: '2026-08-17T16:30:00.000Z', resourceId: roomId },
        broker,
      ),
    ).rejects.toThrow(/reserved/i);
    // Same time, no resource → fine. Different time, same resource → fine.
    await createEvent(
      { title: 'No room', kind: 'office', startAt: '2026-08-17T15:30:00.000Z', endAt: '2026-08-17T16:30:00.000Z' },
      broker,
    );
    await createEvent(
      { title: 'Later', kind: 'office', startAt: '2026-08-17T17:00:00.000Z', endAt: '2026-08-17T18:00:00.000Z', resourceId: roomId },
      broker,
    );
  });

  it('rejects an unknown resource id', async () => {
    const broker = await makeUser('c6@x.com', 'broker');
    await expect(
      createEvent(
        { title: 'Ghost room', kind: 'office', startAt: '2026-08-01T10:00:00.000Z', endAt: '2026-08-01T11:00:00.000Z', resourceId: '64b0000000000000000000ff' },
        broker,
      ),
    ).rejects.toThrow(/resource/i);
  });

  it('rsvp upserts one response per user', async () => {
    const broker = await makeUser('c7@x.com', 'broker');
    const agent = await makeUser('c8@x.com', 'agent');
    const e = await createEvent(
      { title: 'Training', kind: 'office', startAt: '2026-08-05T15:00:00.000Z', endAt: '2026-08-05T16:00:00.000Z', rsvpEnabled: true },
      broker,
    );
    await rsvp(e.id, agent, 'yes');
    await rsvp(e.id, agent, 'maybe');
    const fresh = (await CalendarEvent.findById(e.id))!;
    expect(fresh.rsvps).toHaveLength(1);
    expect(fresh.rsvps[0].response).toBe('maybe');
    // rsvp on an rsvp-disabled event rejects
    const plain = await createEvent(
      { title: 'NoRsvp', kind: 'office', startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z' },
      broker,
    );
    await expect(rsvp(plain.id, agent, 'yes')).rejects.toThrow(/rsvp/i);
  });

  it('updateEvent enforces ownership and re-checks conflicts; deleteEvent enforces ownership', async () => {
    const broker = await makeUser('c9@x.com', 'broker');
    const agent = await makeUser('c10@x.com', 'agent');
    const personal = await createEvent(
      { title: 'Mine', kind: 'personal', startAt: '2026-08-07T15:00:00.000Z', endAt: '2026-08-07T16:00:00.000Z' },
      agent,
    );
    await expect(updateEvent(personal.id, { title: 'Stolen' }, broker)).rejects.toThrow(/permission/i);
    await expect(deleteEvent(personal.id, broker)).rejects.toThrow(/permission/i);
    const mine = await updateEvent(personal.id, { title: 'Renamed' }, agent);
    expect(mine.title).toBe('Renamed');
    await deleteEvent(personal.id, agent);
    expect(await CalendarEvent.findById(personal.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the new block fails**

Run: `npm -w server run test -- tests/events.test.ts`
Expected: FAIL — cannot resolve calendarService.

- [ ] **Step 3: Write `server/src/services/calendarService.ts`**

```ts
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { CalendarEvent, type CalendarEventDoc, type RsvpResponse } from '../models/CalendarEvent.js';
import { getSettings } from '../models/Settings.js';
import { User, type UserDoc } from '../models/User.js';
import { expandOccurrences } from '../utils/recurrence.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { mandatoryEventEmail } from './emailService.js';
import { notify } from './notificationService.js';

const CONFLICT_HORIZON_MS = 180 * 86_400_000; // conflict check bound — documented trade-off
const DAY_MS = 86_400_000;

export interface EventInput {
  title?: string;
  descriptionHtml?: string;
  kind?: 'office' | 'personal';
  officeId?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  location?: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceUntil?: string | null;
  rsvpEnabled?: boolean;
  mandatory?: boolean;
  resourceId?: string | null;
}

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

function canManage(event: CalendarEventDoc, user: UserDoc): boolean {
  if (event.kind === 'personal') return String(event.createdBy) === user.id; // private, even from admins
  return String(event.createdBy) === user.id || isAdmin(user.role);
}

async function assertResourceExists(resourceId: string): Promise<void> {
  const settings = await getSettings();
  const found = settings.reservableResources.some((r) => String(r._id) === resourceId);
  if (!found) throw new AppError(400, 'Unknown reservable resource');
}

/** Only one event may hold a resource at any time (PRD 5.4.2). Expands recurrence on
 * both sides over a 180-day horizon from the candidate's start — reservations beyond
 * the horizon are not checked (accepted, documented bound). */
async function assertResourceFree(candidate: CalendarEventDoc, excludeId?: string): Promise<void> {
  if (!candidate.resourceId) return;
  const horizonEnd = new Date(candidate.startAt.getTime() + CONFLICT_HORIZON_MS);
  const mine = expandOccurrences(candidate, new Date(candidate.startAt.getTime() - DAY_MS), horizonEnd);
  const others = await CalendarEvent.find({
    resourceId: candidate.resourceId,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    startAt: { $lt: horizonEnd },
  });
  for (const other of others) {
    const theirs = expandOccurrences(other, new Date(candidate.startAt.getTime() - DAY_MS), horizonEnd);
    for (const a of mine) {
      for (const b of theirs) {
        if (a.startAt < b.endAt && a.endAt > b.startAt)
          throw new AppError(409, 'Resource is already reserved during that time');
      }
    }
  }
}

function applyInput(event: CalendarEventDoc, input: EventInput): void {
  if (input.title !== undefined) event.title = input.title;
  if (input.descriptionHtml !== undefined) {
    event.descriptionHtml = sanitizePostHtml(input.descriptionHtml);
    event.descriptionText = htmlToText(input.descriptionHtml);
  }
  if (input.startAt !== undefined) event.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) event.endAt = new Date(input.endAt);
  if (input.allDay !== undefined) event.allDay = input.allDay;
  if (input.location !== undefined) event.location = input.location;
  if (input.recurrence !== undefined) event.recurrence = input.recurrence;
  if (input.recurrenceUntil !== undefined)
    event.recurrenceUntil = input.recurrenceUntil ? new Date(input.recurrenceUntil) : null;
  if (input.rsvpEnabled !== undefined) event.rsvpEnabled = input.rsvpEnabled;
  if (input.mandatory !== undefined) event.mandatory = input.mandatory;
  if (input.officeId !== undefined) event.officeId = (input.officeId ?? null) as never;
  if (input.resourceId !== undefined) event.resourceId = (input.resourceId ?? null) as never;
}

function enforceKindRules(event: CalendarEventDoc, user: UserDoc): void {
  if (event.endAt <= event.startAt) throw new AppError(400, 'Event must end after it starts');
  if (event.kind === 'personal') {
    // Personal events are private scheduling blocks — office-only features forced off.
    event.officeId = null as never;
    event.mandatory = false;
    event.rsvpEnabled = false;
    event.resourceId = null as never;
  } else if (event.mandatory && user.role !== 'broker') {
    throw new AppError(403, 'Only a broker can mark events mandatory');
  }
}

export async function createEvent(input: EventInput, creator: UserDoc): Promise<CalendarEventDoc> {
  const event = new CalendarEvent({ kind: input.kind, createdBy: creator.id, title: input.title, startAt: new Date(0), endAt: new Date(0) });
  applyInput(event, input);
  enforceKindRules(event, creator);
  if (event.resourceId) {
    await assertResourceExists(String(event.resourceId));
    await assertResourceFree(event);
  }
  await event.save();
  if (event.kind === 'office' && event.mandatory) await announceMandatory(event, creator);
  return event;
}

export async function updateEvent(id: string, input: EventInput, user: UserDoc): Promise<CalendarEventDoc> {
  const event = await CalendarEvent.findById(id);
  if (!event) throw new AppError(404, 'Event not found');
  if (!canManage(event, user)) throw new AppError(403, 'Insufficient permissions');
  const wasMandatory = event.mandatory;
  applyInput(event, input);
  enforceKindRules(event, user);
  if (event.resourceId) {
    await assertResourceExists(String(event.resourceId));
    await assertResourceFree(event, event.id);
  }
  await event.save();
  // Newly-flagged mandatory on an existing event announces once.
  if (event.kind === 'office' && event.mandatory && !wasMandatory) await announceMandatory(event, user);
  return event;
}

export async function deleteEvent(id: string, user: UserDoc): Promise<void> {
  const event = await CalendarEvent.findById(id);
  if (!event) throw new AppError(404, 'Event not found');
  if (!canManage(event, user)) throw new AppError(403, 'Insufficient permissions');
  await event.deleteOne();
}

export async function rsvp(eventId: string, user: UserDoc, response: RsvpResponse): Promise<void> {
  const event = await CalendarEvent.findById(eventId);
  if (!event || event.kind !== 'office') throw new AppError(404, 'Event not found');
  if (!event.rsvpEnabled) throw new AppError(400, 'RSVP is not enabled on this event');
  const updated = await CalendarEvent.updateOne(
    { _id: eventId, 'rsvps.userId': user.id },
    { $set: { 'rsvps.$.response': response, 'rsvps.$.at': new Date() } },
  );
  if (updated.matchedCount === 0) {
    await CalendarEvent.updateOne(
      { _id: eventId, 'rsvps.userId': { $ne: user.id } },
      { $push: { rsvps: { userId: user.id, response, at: new Date() } } },
    );
  }
}

async function announceMandatory(event: CalendarEventDoc, creator: UserDoc): Promise<void> {
  const when = event.startAt.toISOString();
  await emitActivity({
    type: 'eventCreated',
    message: `Mandatory event: ${event.title}`,
    link: `/calendar/${event.id}`,
    officeId: event.officeId ? String(event.officeId) : null,
    actorId: creator.id,
  });
  const recipients = await User.find({
    status: 'active',
    role: { $in: ['broker', 'officeAdmin', 'agent'] },
    _id: { $ne: creator.id },
    ...(event.officeId
      ? { $or: [{ officeId: event.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
      : {}),
  }).select('_id');
  await notify(
    recipients.map((r) => String(r._id)),
    { type: 'mandatoryEvent', title: `Mandatory event: ${event.title} — ${when}`, link: `/calendar/${event.id}` },
    mandatoryEventEmail(event.title, when, `${env.APP_DOMAIN}/calendar/${event.id}`),
  );
}
```

- [ ] **Step 4: Add `mandatoryEventEmail` to `server/src/services/emailService.ts`** (append):

```ts
export function mandatoryEventEmail(title: string, startAtIso: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Mandatory event: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>A mandatory event was scheduled: <strong>${safeTitle}</strong></p>
      <p>Starts at ${startAtIso} (shown in your local time on the calendar).</p>
      <p><a href="${link}">View it on the calendar</a></p>
    </div>`,
  };
}
```

- [ ] **Step 5: Run the events tests**

Run: `npm -w server run test -- tests/events.test.ts`
Expected: PASS (7 tests). Then the full suite: 119 total.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/calendarService.ts server/src/services/emailService.ts server/tests/events.test.ts
git commit -m "feat(server): calendar service with resource conflict checks and mandatory fan-out"
```

---

### Task 6: Events routes — range listing, detail with RSVP summary, CRUD

**Files:**
- Create: `server/src/validators/events.ts`
- Create: `server/src/routes/events.ts`
- Modify: `server/src/app.ts` (mount)
- Test: `server/tests/events.test.ts` (append)

Visibility: personal events are visible ONLY to their creator (even admins can't see them — they're private scheduling blocks); office events follow the board rule (all-users or own office; admins see every office event). The range query expands recurrence server-side and returns flat occurrences.

- [ ] **Step 1: Append failing route tests** to `server/tests/events.test.ts` — add imports `import request from 'supertest';`, `import { createApp } from '../src/app.js';`, `import { hashPassword } from '../src/utils/password.js';`:

```ts
async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('event routes', () => {
  it('lists expanded occurrences with visibility scoping', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r1@x.com', 'broker');
    const officeA = '64b000000000000000000001';
    const agentA = await loginAs(app, 'r2@x.com', 'agent', officeA);
    const agentB = await loginAs(app, 'r3@x.com', 'agent', '64b000000000000000000002');

    // Broker: weekly office event for everyone.
    await broker.post('/api/v1/events').send({
      title: 'Standup', kind: 'office',
      startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T15:30:00.000Z', recurrence: 'weekly',
    });
    // Broker: office-A-only event.
    await broker.post('/api/v1/events').send({
      title: 'Office A social', kind: 'office', officeId: officeA,
      startAt: '2026-08-04T22:00:00.000Z', endAt: '2026-08-04T23:00:00.000Z',
    });
    // Agent A: personal block.
    await agentA.post('/api/v1/events').send({
      title: 'Dentist', kind: 'personal',
      startAt: '2026-08-05T16:00:00.000Z', endAt: '2026-08-05T17:00:00.000Z',
    });

    const q = '/api/v1/events?from=2026-08-01T00:00:00.000Z&to=2026-08-15T00:00:00.000Z';
    const a = await agentA.get(q);
    const titles = a.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(titles.filter((t: string) => t === 'Standup')).toHaveLength(2); // weekly ×2 in range
    expect(titles).toContain('Office A social');
    expect(titles).toContain('Dentist');

    const b = await agentB.get(q);
    const bTitles = b.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(bTitles).not.toContain('Office A social');
    expect(bTitles).not.toContain('Dentist'); // personal events are private

    const br = await broker.get(q);
    const brTitles = br.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(brTitles).toContain('Office A social'); // admins see all office events
    expect(brTitles).not.toContain('Dentist'); // …but not personal ones
  });

  it('rejects an office event created by an agent, and a missing/oversized range', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'r4@x.com', 'agent');
    expect(
      (
        await agent.post('/api/v1/events').send({
          title: 'Nope', kind: 'office', startAt: '2026-08-01T10:00:00.000Z', endAt: '2026-08-01T11:00:00.000Z',
        })
      ).status,
    ).toBe(403);
    expect((await agent.get('/api/v1/events')).status).toBe(400);
    expect(
      (await agent.get('/api/v1/events?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')).status,
    ).toBe(400); // > 92 days
  });

  it('rsvp via route and creator-only summary', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r5@x.com', 'broker');
    const agent = await loginAs(app, 'r6@x.com', 'agent');
    const created = await broker.post('/api/v1/events').send({
      title: 'Training', kind: 'office', rsvpEnabled: true,
      startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
    });
    const id = created.body.event.id;
    expect((await agent.post(`/api/v1/events/${id}/rsvp`).send({ response: 'yes' })).status).toBe(200);

    const asAgent = await agent.get(`/api/v1/events/${id}`);
    expect(asAgent.body.event.myRsvp).toBe('yes');
    expect(asAgent.body.rsvpSummary).toBeUndefined(); // summary is creator/admin-only

    const asBroker = await broker.get(`/api/v1/events/${id}`);
    expect(asBroker.body.rsvpSummary.yes).toEqual(['r6@x.com']);
    expect(asBroker.body.rsvpSummary.no).toEqual([]);
  });

  it('mandatory flag is broker-only through the route', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'r7@x.com', 'officeAdmin');
    expect(
      (
        await admin.post('/api/v1/events').send({
          title: 'M', kind: 'office', mandatory: true,
          startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
        })
      ).status,
    ).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify the block fails**

Run: `npm -w server run test -- tests/events.test.ts`
Expected: FAIL — 404 (router not mounted).

- [ ] **Step 3: Write `server/src/validators/events.ts`**

```ts
import { z } from 'zod';
import { RECURRENCE } from '../utils/recurrence.js';
import { RSVP_RESPONSES } from '../models/CalendarEvent.js';

export const createEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    descriptionHtml: z.string().max(100_000).optional(),
    kind: z.enum(['office', 'personal']),
    officeId: z.string().nullable().optional(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().optional(),
    location: z.string().max(200).optional(),
    recurrence: z.enum(RECURRENCE).optional(),
    recurrenceUntil: z.string().datetime({ offset: true }).nullable().optional(),
    rsvpEnabled: z.boolean().optional(),
    mandatory: z.boolean().optional(),
    resourceId: z.string().nullable().optional(),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: 'endAt must be after startAt' });

// kind is immutable after creation.
export const updateEventSchema = createEventSchema.innerType().omit({ kind: true }).partial();

export const rsvpSchema = z.object({ response: z.enum(RSVP_RESPONSES) });
```

- [ ] **Step 4: Write `server/src/routes/events.ts`**

```ts
import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { CalendarEvent, toPublicEvent, type CalendarEventDoc } from '../models/CalendarEvent.js';
import { createEvent, deleteEvent, rsvp, updateEvent } from '../services/calendarService.js';
import { expandOccurrences } from '../utils/recurrence.js';
import { createEventSchema, rsvpSchema, updateEventSchema } from '../validators/events.js';

const MAX_RANGE_MS = 92 * 86_400_000; // one quarter — month/week/day views never need more
const MAX_OCCURRENCES = 1000;

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Personal events: creator only. Office events: all-users or own office; admins all. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  const office = isAdmin(me.role)
    ? { kind: 'office' }
    : { kind: 'office', $or: [{ officeId: null }, { officeId: me.officeId }] };
  return { $or: [{ kind: 'personal', createdBy: me.id }, office] };
}

async function loadVisibleEvent(req: Request): Promise<CalendarEventDoc> {
  const event = await CalendarEvent.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!event) throw new AppError(404, 'Event not found');
  return event;
}

eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : null;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
      throw new AppError(400, 'from and to are required ISO datetimes with to > from');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new AppError(400, 'Range too large (max 92 days)');

    const events = await CalendarEvent.find({
      $and: [
        visibilityFilter(req),
        { startAt: { $lt: to } },
        { $or: [{ recurrence: { $ne: 'none' } }, { endAt: { $gt: from } }] },
      ],
    });
    const me = req.user!.id;
    const occurrences = events
      .flatMap((e) => expandOccurrences(e, from, to).map((o) => ({ event: toPublicEvent(e, me), startAt: o.startAt, endAt: o.endAt })))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, MAX_OCCURRENCES);
    res.json({ occurrences });
  }),
);

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await loadVisibleEvent(req);
    const me = req.user!;
    const body: Record<string, unknown> = { event: toPublicEvent(event, me.id) };
    if (event.rsvpEnabled && (String(event.createdBy) === me.id || isAdmin(me.role))) {
      await event.populate('rsvps.userId', 'displayName');
      const summary: Record<string, string[]> = { yes: [], no: [], maybe: [] };
      for (const r of event.rsvps) {
        const name = (r.userId as unknown as { displayName?: string })?.displayName ?? 'Unknown';
        summary[r.response].push(name);
      }
      body.rsvpSummary = summary;
    }
    res.json(body);
  }),
);

eventsRouter.post(
  '/',
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    if (req.body.kind === 'office' && !isAdmin(me.role))
      throw new AppError(403, 'Only admins can create office events');
    const event = await createEvent(req.body, me);
    res.status(201).json({ event: toPublicEvent(event, me.id) });
  }),
);

eventsRouter.patch(
  '/:id',
  validate(updateEventSchema),
  asyncHandler(async (req, res) => {
    const event = await updateEvent(req.params.id, req.body, req.user!);
    res.json({ event: toPublicEvent(event, req.user!.id) });
  }),
);

eventsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteEvent(req.params.id, req.user!);
    res.json({ ok: true });
  }),
);

eventsRouter.post(
  '/:id/rsvp',
  validate(rsvpSchema),
  asyncHandler(async (req, res) => {
    await loadVisibleEvent(req); // visibility gate
    await rsvp(req.params.id, req.user!, req.body.response);
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 5: Mount in `server/src/app.ts`**

```ts
import { eventsRouter } from './routes/events.js';
```
```ts
app.use('/api/v1/events', eventsRouter);
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 123 tests (119 + 4).

- [ ] **Step 7: Commit**

```bash
git add server/src/validators/events.ts server/src/routes/events.ts server/src/app.ts server/tests/events.test.ts
git commit -m "feat(server): calendar routes with occurrence expansion, rsvp, visibility"
```

---

### Task 7: Event reminders job

**Files:**
- Create: `server/src/jobs/eventReminders.ts`
- Modify: `server/src/jobs/index.ts` (register)
- Modify: `server/src/config/agenda.ts` (recurring schedule)
- Modify: `server/src/services/emailService.ts` (template)
- Test: `server/tests/eventReminders.test.ts`

A 15-minute sweeper. For each lead time (24h, 1h) it finds occurrences starting inside `[now + lead, now + lead + 15min)`, claims a per-occurrence latch atomically (`remindersSent` array, `$ne`-guarded `$push` — the Stage 2 latch pattern), and emails **opted-in attendees**. Opt-in is explicit: `emailPrefs.get('eventReminders') === true` (absent = OFF — the one pref that inverts the default; the sweep is email-only per PRD 5.4). Attendees = RSVP-yes users, plus all targeted users when the event is mandatory. Missed windows (sleeping host) are skipped, not back-filled — a reminder for a moment that already passed is noise (documented).

- [ ] **Step 1: Write the failing tests** — create `server/tests/eventReminders.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { sweepEventReminders } from '../src/jobs/eventReminders.js';

async function optedInUser(email: string, extra: Record<string, unknown> = {}) {
  return User.create({
    email, hashedPassword: 'x', role: 'agent', displayName: email,
    emailPrefs: { eventReminders: true }, ...extra,
  });
}

describe('sweepEventReminders', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('emails opted-in RSVP-yes attendees inside the 24h window, exactly once', async () => {
    const broker = await User.create({ email: 'b@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b' });
    const yes = await optedInUser('yes@x.com');
    const yesButOptedOut = await User.create({ email: 'out@x.com', hashedPassword: 'x', role: 'agent', displayName: 'out' });
    const maybe = await optedInUser('maybe@x.com');
    const startAt = new Date(Date.now() + 24 * 3_600_000 + 5 * 60_000); // 24h + 5min from now
    await CalendarEvent.create({
      title: 'Training', kind: 'office', createdBy: broker.id, rsvpEnabled: true,
      startAt, endAt: new Date(startAt.getTime() + 3_600_000),
      rsvps: [
        { userId: yes.id, response: 'yes' },
        { userId: yesButOptedOut.id, response: 'yes' },
        { userId: maybe.id, response: 'maybe' },
      ],
    });
    await sweepEventReminders();
    await sweepEventReminders(); // second sweep: latch makes it a no-op
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('yes@x.com');
  });

  it('mandatory events remind all targeted opted-in users; outside-window events are untouched', async () => {
    const broker = await User.create({ email: 'b2@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b2' });
    await optedInUser('all@x.com');
    const startSoon = new Date(Date.now() + 3_600_000 + 5 * 60_000); // 1h + 5min → 1h window
    await CalendarEvent.create({
      title: 'All hands', kind: 'office', createdBy: broker.id, mandatory: true,
      startAt: startSoon, endAt: new Date(startSoon.getTime() + 3_600_000),
    });
    const startFar = new Date(Date.now() + 48 * 3_600_000);
    await CalendarEvent.create({
      title: 'Far away', kind: 'office', createdBy: broker.id, mandatory: true,
      startAt: startFar, endAt: new Date(startFar.getTime() + 3_600_000),
    });
    await sweepEventReminders();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('all@x.com');
    expect(sendEmailMock.mock.calls[0][1]).toMatch(/All hands/);
  });

  it('recurring events remind for the occurrence in the window', async () => {
    const broker = await User.create({ email: 'b3@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b3' });
    const attendee = await optedInUser('rec@x.com');
    // Started weeks ago, weekly; next occurrence lands in the 24h window.
    const nextOcc = new Date(Date.now() + 24 * 3_600_000 + 5 * 60_000);
    const origin = new Date(nextOcc.getTime() - 21 * 86_400_000);
    await CalendarEvent.create({
      title: 'Weekly sync', kind: 'office', createdBy: broker.id, rsvpEnabled: true, recurrence: 'weekly',
      startAt: origin, endAt: new Date(origin.getTime() + 1_800_000),
      rsvps: [{ userId: attendee.id, response: 'yes' }],
    });
    await sweepEventReminders();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w server run test -- tests/eventReminders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the template to `server/src/services/emailService.ts`** (append):

```ts
export function eventReminderEmail(title: string, startAtIso: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Reminder: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>Upcoming event: <strong>${safeTitle}</strong></p>
      <p>Starts at ${startAtIso} (shown in your local time on the calendar).</p>
      <p><a href="${link}">View it on the calendar</a></p>
    </div>`,
  };
}
```

- [ ] **Step 4: Write `server/src/jobs/eventReminders.ts`**

```ts
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CalendarEvent, type CalendarEventDoc } from '../models/CalendarEvent.js';
import { User } from '../models/User.js';
import { eventReminderEmail, sendEmail } from '../services/emailService.js';
import { expandOccurrences } from '../utils/recurrence.js';

const WINDOW_MS = 15 * 60_000; // matches the agenda every-15-minutes cadence
const LEADS = [
  { key: '24h', ms: 24 * 3_600_000 },
  { key: '1h', ms: 3_600_000 },
] as const;

/** Email-only, opt-in reminders (PRD 5.4). Runs every 15 minutes; windows that pass
 * while the host sleeps are skipped, not back-filled — a late reminder is noise. */
export async function sweepEventReminders(): Promise<void> {
  const now = Date.now();
  for (const lead of LEADS) {
    const windowStart = new Date(now + lead.ms);
    const windowEnd = new Date(now + lead.ms + WINDOW_MS);
    const candidates = await CalendarEvent.find({
      kind: 'office',
      $or: [{ rsvpEnabled: true }, { mandatory: true }],
      $and: [
        {
          $or: [
            { recurrence: 'none', startAt: { $gte: windowStart, $lt: windowEnd } },
            {
              recurrence: { $ne: 'none' },
              startAt: { $lt: windowEnd },
              $or: [{ recurrenceUntil: null }, { recurrenceUntil: { $gte: windowStart } }],
            },
          ],
        },
      ],
    });
    for (const event of candidates) {
      for (const occ of expandOccurrences(event, windowStart, windowEnd)) {
        if (occ.startAt < windowStart) continue; // overlap ≠ starting in window
        const latch = `${occ.startAt.toISOString()}|${lead.key}`;
        const claimed = await CalendarEvent.updateOne(
          { _id: event.id, remindersSent: { $ne: latch } },
          { $push: { remindersSent: latch } },
        );
        if (claimed.modifiedCount !== 1) continue; // already reminded (or raced)
        try {
          await remindAttendees(event, occ.startAt);
        } catch (err) {
          logger.error({ err, eventId: event.id }, 'event reminder send failed');
        }
      }
    }
  }
}

async function remindAttendees(event: CalendarEventDoc, occStart: Date): Promise<void> {
  const rsvpYesIds = event.rsvps.filter((r) => r.response === 'yes').map((r) => r.userId);
  const filter = event.mandatory
    ? {
        status: 'active',
        role: { $in: ['broker', 'officeAdmin', 'agent'] },
        ...(event.officeId
          ? { $or: [{ officeId: event.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
          : {}),
      }
    : { _id: { $in: rsvpYesIds }, status: 'active' };
  const users = await User.find(filter);
  const { subject, html } = eventReminderEmail(
    event.title,
    occStart.toISOString(),
    `${env.APP_DOMAIN}/calendar/${event.id}`,
  );
  for (const u of users) {
    // Opt-IN: absent pref means NO reminder (unlike other email prefs).
    if ((u.emailPrefs as Map<string, boolean>).get('eventReminders') !== true) continue;
    try {
      await sendEmail(u.email, subject, html);
    } catch (err) {
      logger.error({ err, to: u.email }, 'event reminder email failed');
    }
  }
}
```

- [ ] **Step 5: Register the job** — in `server/src/jobs/index.ts` add:

```ts
import { sweepEventReminders } from './eventReminders.js';
```

and inside `registerJobs`:

```ts
  agenda.define('event-reminders', async () => {
    await sweepEventReminders();
  });
```

In `server/src/config/agenda.ts`, in `startAgenda` after the poll-rss `every` line:

```ts
  await agenda.every('15 minutes', 'event-reminders');
```

and update the log line to `'agenda started (poll-rss hourly, event-reminders 15m)'`.

- [ ] **Step 6: Update the job-registry test** — `server/tests/agenda.test.ts` asserts the registered job names; extend the expected array to `['event-reminders', 'poll-rss', 'publish-post']` (sorted).

- [ ] **Step 7: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 126 tests (123 + 3).

- [ ] **Step 8: Commit**

```bash
git add server/src/jobs/eventReminders.ts server/src/jobs/index.ts server/src/config/agenda.ts server/src/services/emailService.ts server/tests/eventReminders.test.ts server/tests/agenda.test.ts
git commit -m "feat(server): opt-in event reminder sweeper with occurrence latches"
```

---

### Task 8: Task + TaskTemplate models, audience resolution

**Files:**
- Create: `server/src/models/Task.ts`
- Create: `server/src/models/TaskTemplate.ts`
- Create: `server/src/services/audience.ts`
- Test: `server/tests/tasks.test.ts` (started here)

Core rule (PRD 5.7.2): completion records are **resolved at assignment time** — one subdoc per member. Members added later are NOT auto-included in existing tasks. The `audience` descriptor is kept on the task so recurring instances re-resolve it fresh at spawn time.

- [ ] **Step 1: Write the failing tests** — create `server/tests/tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Task } from '../src/models/Task.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { resolveAudience } from '../src/services/audience.js';

async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('resolveAudience', () => {
  it('resolves all / office / users to active intranet members', async () => {
    const officeA = '64b000000000000000000001';
    const broker = await makeUser('a1@x.com', 'broker');
    const inOffice = await makeUser('a2@x.com', 'agent', officeA);
    await makeUser('a3@x.com', 'agent', '64b000000000000000000002');
    const deactivated = await makeUser('a4@x.com', 'agent', officeA);
    deactivated.status = 'deactivated';
    await deactivated.save();

    const all = await resolveAudience({ type: 'all', userIds: [], officeId: null });
    expect(all).toHaveLength(3); // broker + 2 active agents, deactivated excluded

    const office = await resolveAudience({ type: 'office', userIds: [], officeId: officeA });
    expect(office.map(String)).toEqual([inOffice.id]); // office members only, not admins

    const users = await resolveAudience({ type: 'users', userIds: [broker.id, deactivated.id], officeId: null });
    expect(users.map(String)).toEqual([broker.id]); // deactivated filtered out
  });
});

describe('Task / TaskTemplate models', () => {
  it('applies defaults and stores completion subdocs', async () => {
    const broker = await makeUser('m1@x.com', 'broker');
    const agent = await makeUser('m2@x.com', 'agent');
    const t = await Task.create({
      title: 'File paperwork',
      createdBy: broker.id,
      audience: { type: 'users', userIds: [agent.id], officeId: null },
      completions: [{ userId: agent.id }],
    });
    expect(t.priority).toBe('Medium');
    expect(t.dueAt).toBeNull();
    expect(t.recurrence).toBe('none');
    expect(t.isOnboarding).toBe(false);
    expect(t.completions[0].completedAt).toBeNull();
    expect(t.completions[0].note).toBe('');
  });

  it('templates hold an ordered item list', async () => {
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [
        { title: 'Sign policies', dueInDays: 3 },
        { title: 'Meet your office admin', priority: 'High' },
      ],
    });
    expect(tpl.items).toHaveLength(2);
    expect(tpl.items[0].dueInDays).toBe(3);
    expect(tpl.items[1].priority).toBe('High');
    expect(tpl.items[1].dueInDays).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w server run test -- tests/tasks.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `server/src/models/Task.ts`**

```ts
import mongoose from 'mongoose';
import { RECURRENCE } from '../utils/recurrence.js';

export const TASK_PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const AUDIENCE_TYPES = ['users', 'office', 'all'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

const audienceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: AUDIENCE_TYPES, required: true },
    userIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const completionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 1000 },
    // Sweeper latches (task-sweep job): set once per user when the notice went out.
    dueSoonNotifiedAt: { type: Date, default: null },
    overdueNotifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const attachmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true },
    contentType: { type: String, required: true },
  },
  { _id: false },
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },
    dueAt: { type: Date, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    // Field ships per PRD 5.7; the Resource Hub (and its UI) arrives in Stage 4.
    relatedResourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    recurrence: { type: String, enum: RECURRENCE, default: 'none' },
    // Sweeper claims this atomically to spawn the next instance.
    nextRecurrenceAt: { type: Date, default: null },
    audience: { type: audienceSchema, required: true },
    completions: { type: [completionSchema], default: [] },
    isOnboarding: { type: Boolean, default: false },
    templateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
taskSchema.index({ 'completions.userId': 1, dueAt: 1 });
taskSchema.index({ nextRecurrenceAt: 1 });
taskSchema.index({ dueAt: 1 });

export const Task = mongoose.model('Task', taskSchema);
export type TaskDoc = InstanceType<typeof Task>;

export function toPublicTask(t: TaskDoc, viewerId: string) {
  const mine = t.completions.find((c) => String(c.userId) === viewerId);
  const completed = t.completions.filter((c) => c.completedAt).length;
  return {
    id: t.id as string,
    title: t.title,
    descriptionHtml: t.descriptionHtml,
    createdBy: String(t.createdBy),
    priority: t.priority,
    dueAt: t.dueAt,
    attachments: t.attachments.map((a) => ({ name: a.name, size: a.size, contentType: a.contentType })),
    recurrence: t.recurrence,
    isOnboarding: t.isOnboarding,
    myCompletion: mine ? { completedAt: mine.completedAt, note: mine.note } : null,
    counts: { total: t.completions.length, completed },
    createdAt: t.get('createdAt') as Date,
  };
}
```

- [ ] **Step 4: Write `server/src/models/TaskTemplate.ts`**

```ts
import mongoose from 'mongoose';
import { TASK_PRIORITIES } from './Task.js';

const templateItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },
    // Due date relative to instantiation; null = no due date.
    dueInDays: { type: Number, default: null, min: 0, max: 365 },
  },
  { _id: false },
);

const taskTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    items: { type: [templateItemSchema], default: [] },
  },
  { timestamps: true },
);

export const TaskTemplate = mongoose.model('TaskTemplate', taskTemplateSchema);
export type TaskTemplateDoc = InstanceType<typeof TaskTemplate>;

export function toPublicTemplate(t: TaskTemplateDoc) {
  return {
    id: t.id as string,
    name: t.name,
    items: t.items.map((i) => ({
      title: i.title,
      descriptionHtml: i.descriptionHtml,
      priority: i.priority,
      dueInDays: i.dueInDays,
    })),
    createdAt: t.get('createdAt') as Date,
  };
}
```

- [ ] **Step 5: Write `server/src/services/audience.ts`**

```ts
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import type { AudienceType } from '../models/Task.js';

export interface Audience {
  type: AudienceType;
  userIds: (string | mongoose.Types.ObjectId)[];
  officeId: string | mongoose.Types.ObjectId | null;
}

/** Snapshot resolution (PRD 5.7.2): returns ACTIVE intranet member ids for the audience
 * at this moment. Callers create one completion record per returned id; users added to
 * the office later are NOT retro-included in existing tasks. */
export async function resolveAudience(audience: Audience): Promise<mongoose.Types.ObjectId[]> {
  const base = { status: 'active', role: { $in: ['broker', 'officeAdmin', 'agent'] } };
  if (audience.type === 'all') {
    return (await User.find(base).select('_id')).map((u) => u._id);
  }
  if (audience.type === 'office') {
    return (await User.find({ ...base, officeId: audience.officeId }).select('_id')).map((u) => u._id);
  }
  return (await User.find({ ...base, _id: { $in: audience.userIds } }).select('_id')).map((u) => u._id);
}
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 129 tests (126 + 3).

- [ ] **Step 7: Commit**

```bash
git add server/src/models/Task.ts server/src/models/TaskTemplate.ts server/src/services/audience.ts server/tests/tasks.test.ts
git commit -m "feat(server): task and template models with snapshot audience resolution"
```

---

### Task 9: Task service — create, complete, template instantiation

**Files:**
- Create: `server/src/services/taskService.ts`
- Modify: `server/src/services/emailService.ts` (append two templates)
- Test: `server/tests/tasks.test.ts` (append)

Notification rules (PRD 5.7.2): in-app on assignment for everyone; EMAIL on assignment only when priority is High OR the due date is within 48 hours (prefs-honoring). Completion emits a user-scoped `taskCompleted` activity ("your own" feed events, wired in Task 1) and logs the `taskComplete` engagement event (roadmap cross-stage wiring).

- [ ] **Step 1: Append failing service tests** to `server/tests/tasks.test.ts` — add the hoisted email mock at the top (same importOriginal-spread pattern as `events.test.ts`), plus imports:

```ts
import { beforeEach, vi } from 'vitest'; // merge into existing vitest import
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { Notification } from '../src/models/Notification.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { completeTask, createTask, instantiateTemplate } from '../src/services/taskService.js';
```

Then:

```ts
describe('taskService', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('createTask resolves the audience, sanitizes, notifies in-app; no email for Medium/far-due', async () => {
    const broker = await makeUser('t1@x.com', 'broker');
    const a1 = await makeUser('t2@x.com', 'agent');
    const a2 = await makeUser('t3@x.com', 'agent');
    const task = await createTask(
      {
        title: 'Update your license record',
        descriptionHtml: '<p>Do <script>x()</script>it</p>',
        audience: { type: 'all' },
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      broker,
    );
    expect(task.descriptionHtml).toBe('<p>Do it</p>');
    expect(task.completions).toHaveLength(3); // broker + both agents
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: a1.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: a2.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: broker.id })).toBe(0); // creator excluded
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await ActivityEvent.countDocuments({ type: 'taskAssigned' })).toBe(1);
  });

  it('High priority (or due <48h) assignment emails assignees per prefs', async () => {
    const broker = await makeUser('t4@x.com', 'broker');
    await makeUser('t5@x.com', 'agent');
    const optedOut = await makeUser('t6@x.com', 'agent');
    optedOut.emailPrefs = new Map([['taskAssigned', false]]) as never;
    await optedOut.save();
    await createTask({ title: 'Urgent', audience: { type: 'all' }, priority: 'High' }, broker);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('t5@x.com');
  });

  it('completeTask sets note, emits user-scoped activity, logs engagement, rejects double-complete', async () => {
    const broker = await makeUser('t7@x.com', 'broker');
    const agent = await makeUser('t8@x.com', 'agent');
    const task = await createTask({ title: 'Sign form', audience: { type: 'users', userIds: [agent.id] } }, broker);
    await completeTask(task.id, agent, 'Done at the office');
    const fresh = (await Task.findById(task.id))!;
    expect(fresh.completions[0].completedAt).not.toBeNull();
    expect(fresh.completions[0].note).toBe('Done at the office');
    const act = (await ActivityEvent.findOne({ type: 'taskCompleted' }))!;
    expect(String(act.userId)).toBe(agent.id); // visible only to the completer
    expect(await EngagementEvent.countDocuments({ type: 'taskComplete', userId: agent.id })).toBe(1);
    await expect(completeTask(task.id, agent, '')).rejects.toThrow(/already/i);
  });

  it('admin completes on behalf; non-assignee cannot complete', async () => {
    const broker = await makeUser('t9@x.com', 'broker');
    const agent = await makeUser('t10@x.com', 'agent');
    const outsider = await makeUser('t11@x.com', 'agent');
    const task = await createTask({ title: 'X', audience: { type: 'users', userIds: [agent.id] } }, broker);
    await expect(completeTask(task.id, outsider, '')).rejects.toThrow(/not assigned/i);
    await completeTask(task.id, broker, 'verified in person', agent.id); // on-behalf
    const fresh = (await Task.findById(task.id))!;
    expect(fresh.completions[0].completedAt).not.toBeNull();
  });

  it('instantiateTemplate creates one task per item with relative due dates', async () => {
    const broker = await makeUser('t12@x.com', 'broker');
    const agent = await makeUser('t13@x.com', 'agent');
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [
        { title: 'Sign policies', dueInDays: 3 },
        { title: 'Office tour', priority: 'High' },
      ],
    });
    const tasks = await instantiateTemplate(tpl.id, { type: 'users', userIds: [agent.id] }, broker.id, {
      isOnboarding: true,
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].isOnboarding).toBe(true);
    expect(tasks[0].dueAt).not.toBeNull();
    expect(tasks[1].dueAt).toBeNull();
    expect(String(tasks[0].templateId)).toBe(tpl.id);
    expect(tasks[0].completions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify the block fails**

Run: `npm -w server run test -- tests/tasks.test.ts`
Expected: FAIL — cannot resolve taskService.

- [ ] **Step 3: Append the email templates to `server/src/services/emailService.ts`**

```ts
export function taskAssignedEmail(title: string, dueAtIso: string | null, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `New task: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>You've been assigned a task: <strong>${safeTitle}</strong></p>
      ${dueAtIso ? `<p>Due: ${dueAtIso}</p>` : ''}
      <p><a href="${link}">Open the task</a></p>
    </div>`,
  };
}

export function taskDueEmail(kind: 'due-soon' | 'overdue', title: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  const lead = kind === 'due-soon' ? 'is due within 24 hours' : 'is overdue';
  return {
    subject: kind === 'due-soon' ? `Task due soon: ${title}` : `Task overdue: ${title}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>Your task <strong>${safeTitle}</strong> ${lead}.</p>
      <p><a href="${link}">Open the task</a></p>
    </div>`,
  };
}
```

- [ ] **Step 4: Write `server/src/services/taskService.ts`**

```ts
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { Task, type TaskDoc, type TaskPriority } from '../models/Task.js';
import { TaskTemplate } from '../models/TaskTemplate.js';
import type { UserDoc } from '../models/User.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { resolveAudience, type Audience } from './audience.js';
import { taskAssignedEmail } from './emailService.js';
import { logEngagement } from './engagementService.js';
import { notify } from './notificationService.js';

const EMAIL_DUE_WINDOW_MS = 48 * 3_600_000;

export interface TaskInput {
  title: string;
  descriptionHtml?: string;
  priority?: TaskPriority;
  dueAt?: string | null;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  audience: { type: 'users' | 'office' | 'all'; userIds?: string[]; officeId?: string | null };
}

function nextRecurrence(from: Date, recurrence: string): Date {
  if (recurrence === 'daily') return new Date(from.getTime() + 86_400_000);
  if (recurrence === 'weekly') return new Date(from.getTime() + 7 * 86_400_000);
  // monthly: same wall-clock day next month, clamped by JS Date rollover being acceptable here
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

// createTask only needs the creator's id — the loose type lets template
// instantiation pass a bare id without holding a full UserDoc.
export async function createTask(
  input: TaskInput,
  creator: { id: string },
  opts: { isOnboarding?: boolean; templateId?: string | null } = {},
): Promise<TaskDoc> {
  const audience: Audience = {
    type: input.audience.type,
    userIds: input.audience.userIds ?? [],
    officeId: input.audience.officeId ?? null,
  };
  const memberIds = await resolveAudience(audience);
  if (memberIds.length === 0) throw new AppError(400, 'No active users match that audience');

  const now = new Date();
  const task = await Task.create({
    title: input.title,
    descriptionHtml: sanitizePostHtml(input.descriptionHtml ?? ''),
    descriptionText: htmlToText(input.descriptionHtml ?? ''),
    createdBy: creator.id,
    priority: input.priority ?? 'Medium',
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    recurrence: input.recurrence ?? 'none',
    nextRecurrenceAt: input.recurrence && input.recurrence !== 'none' ? nextRecurrence(now, input.recurrence) : null,
    audience,
    completions: memberIds.map((userId) => ({ userId })),
    isOnboarding: opts.isOnboarding ?? false,
    templateId: opts.templateId ?? null,
  });

  const recipients = memberIds.map(String).filter((id) => id !== creator.id);
  const emailWorthy =
    task.priority === 'High' || (task.dueAt !== null && task.dueAt.getTime() - now.getTime() < EMAIL_DUE_WINDOW_MS);
  await notify(
    recipients,
    { type: 'taskAssigned', title: `New task: ${task.title}`, link: `/tasks/${task.id}` },
    emailWorthy
      ? taskAssignedEmail(task.title, task.dueAt ? task.dueAt.toISOString() : null, `${env.APP_DOMAIN}/tasks/${task.id}`)
      : undefined,
  );
  // Feed: office/all audiences get an office-scoped event; individually-targeted tasks
  // skip the feed (assignees already got the in-app notification — no broadcast value).
  if (audience.type !== 'users') {
    await emitActivity({
      type: 'taskAssigned',
      message: `New task: ${task.title}`,
      link: `/tasks/${task.id}`,
      officeId: audience.type === 'office' ? String(audience.officeId) : null,
      actorId: creator.id,
    });
  }
  return task;
}

/** Completes for `onBehalfUserId` when provided (admins only — routes enforce role). */
export async function completeTask(
  taskId: string,
  actor: UserDoc,
  note: string,
  onBehalfUserId?: string,
): Promise<TaskDoc> {
  const targetUserId = onBehalfUserId ?? actor.id;
  const isAdmin = actor.role === 'broker' || actor.role === 'officeAdmin';
  if (onBehalfUserId && onBehalfUserId !== actor.id && !isAdmin)
    throw new AppError(403, 'Insufficient permissions');
  const task = await Task.findById(taskId);
  if (!task) throw new AppError(404, 'Task not found');
  const completion = task.completions.find((c) => String(c.userId) === targetUserId);
  if (!completion) throw new AppError(400, 'That user is not assigned to this task');
  if (completion.completedAt) throw new AppError(400, 'Task is already completed for that user');
  completion.completedAt = new Date();
  completion.note = note;
  await task.save();
  await emitActivity({
    type: 'taskCompleted',
    message: `You completed: ${task.title}`,
    link: `/tasks/${task.id}`,
    userId: targetUserId, // visible only to the completer (PRD 5.2 "your own")
    actorId: actor.id,
  });
  logEngagement('taskComplete', targetUserId, { taskId: task.id });
  return task;
}

export async function instantiateTemplate(
  templateId: string,
  audience: TaskInput['audience'],
  creatorId: string,
  opts: { isOnboarding?: boolean } = {},
): Promise<TaskDoc[]> {
  const tpl = await TaskTemplate.findById(templateId);
  if (!tpl) throw new AppError(404, 'Template not found');
  const creator = { id: creatorId };
  const out: TaskDoc[] = [];
  for (const item of tpl.items) {
    out.push(
      await createTask(
        {
          title: item.title,
          descriptionHtml: item.descriptionHtml,
          priority: item.priority as TaskPriority,
          dueAt: item.dueInDays != null ? new Date(Date.now() + item.dueInDays * 86_400_000).toISOString() : null,
          audience,
        },
        creator,
        { isOnboarding: opts.isOnboarding ?? false, templateId: tpl.id },
      ),
    );
  }
  return out;
}
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 134 tests (129 + 5).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/taskService.ts server/src/services/emailService.ts server/tests/tasks.test.ts
git commit -m "feat(server): task service with assignment fan-out, completion, templates"
```

---

### Task 10: Task + template routes

**Files:**
- Create: `server/src/validators/tasks.ts`
- Create: `server/src/routes/tasks.ts`
- Create: `server/src/routes/taskTemplates.ts`
- Modify: `server/src/app.ts` (mount both)
- Test: `server/tests/tasks.test.ts` (append)

Authorization: task creation/deletion is officeAdmin+; template CRUD is broker-only (PRD 5.7: "Broker/Owner saves a task configuration"). Task detail is visible to assignees, the creator, and admins; the per-user completion matrix is included only for the creator/admins.

- [ ] **Step 1: Append failing route tests** to `server/tests/tasks.test.ts` — add imports `request`, `createApp`, `hashPassword` and a `loginAs` helper identical to the one in `events.test.ts` (copy it — per-file duplication is the established pattern):

```ts
describe('task routes', () => {
  it('admin creates; assignee sees it under scope=mine; matrix is creator/admin-only', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'tr1@x.com', 'broker');
    const agent = await loginAs(app, 'tr2@x.com', 'agent');
    const agentUser = (await User.findOne({ email: 'tr2@x.com' }))!;

    expect((await agent.post('/api/v1/tasks').send({ title: 'No', audience: { type: 'all' } })).status).toBe(403);
    const created = await broker.post('/api/v1/tasks').send({
      title: 'Compliance form',
      audience: { type: 'users', userIds: [agentUser.id] },
      priority: 'Low',
    });
    expect(created.status).toBe(201);
    const id = created.body.task.id;

    const mine = await agent.get('/api/v1/tasks?scope=mine');
    expect(mine.body.tasks.map((t: { id: string }) => t.id)).toContain(id);
    expect((await agent.get('/api/v1/tasks?scope=all')).status).toBe(403);

    const asAgent = await agent.get(`/api/v1/tasks/${id}`);
    expect(asAgent.status).toBe(200);
    expect(asAgent.body.matrix).toBeUndefined();
    const asBroker = await broker.get(`/api/v1/tasks/${id}`);
    expect(asBroker.body.matrix).toHaveLength(1);
    expect(asBroker.body.matrix[0].displayName).toBe('tr2@x.com');
    expect(asBroker.body.matrix[0].completedAt).toBeNull();
  });

  it('non-assignee outsiders get 404 on detail; completion via route with note', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'tr3@x.com', 'broker');
    const agent = await loginAs(app, 'tr4@x.com', 'agent');
    const outsider = await loginAs(app, 'tr5@x.com', 'agent');
    const agentUser = (await User.findOne({ email: 'tr4@x.com' }))!;
    const id = (
      await broker.post('/api/v1/tasks').send({ title: 'T', audience: { type: 'users', userIds: [agentUser.id] } })
    ).body.task.id;
    expect((await outsider.get(`/api/v1/tasks/${id}`)).status).toBe(404);
    expect((await outsider.post(`/api/v1/tasks/${id}/complete`).send({})).status).toBe(404); // invisible to non-assignees
    const done = await agent.post(`/api/v1/tasks/${id}/complete`).send({ note: 'brought it in' });
    expect(done.status).toBe(200);
    expect(done.body.task.myCompletion.completedAt).toBeTruthy();
    expect(done.body.task.myCompletion.note).toBe('brought it in');
  });

  it('broker manages templates; officeAdmin cannot', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'tr6@x.com', 'broker');
    const admin = await loginAs(app, 'tr7@x.com', 'officeAdmin');
    expect((await admin.post('/api/v1/task-templates').send({ name: 'X', items: [] })).status).toBe(403);
    const created = await broker.post('/api/v1/task-templates').send({
      name: 'Onboarding',
      items: [{ title: 'Sign policies', dueInDays: 3 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.template.id;
    const patched = await broker.patch(`/api/v1/task-templates/${id}`).send({ name: 'Onboarding v2' });
    expect(patched.body.template.name).toBe('Onboarding v2');
    expect((await broker.get('/api/v1/task-templates')).body.templates).toHaveLength(1);
    expect((await broker.delete(`/api/v1/task-templates/${id}`)).status).toBe(200);
    expect((await broker.get('/api/v1/task-templates')).body.templates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify the block fails** (404s — routers not mounted).

- [ ] **Step 3: Write `server/src/validators/tasks.ts`**

```ts
import { z } from 'zod';
import { AUDIENCE_TYPES, TASK_PRIORITIES } from '../models/Task.js';
import { RECURRENCE } from '../utils/recurrence.js';

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  descriptionHtml: z.string().max(100_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  recurrence: z.enum(RECURRENCE).optional(),
  audience: z.object({
    type: z.enum(AUDIENCE_TYPES),
    userIds: z.array(z.string()).max(500).optional(),
    officeId: z.string().nullable().optional(),
  }),
});

export const completeTaskSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  userId: z.string().optional(), // admin completes on behalf
});

const templateItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  descriptionHtml: z.string().max(100_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(templateItemSchema).max(50),
});

export const updateTemplateSchema = templateSchema.partial();
```

- [ ] **Step 4: Write `server/src/routes/tasks.ts`**

```ts
import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Task, toPublicTask, type TaskDoc } from '../models/Task.js';
import { completeTask, createTask } from '../services/taskService.js';
import { completeTaskSchema, createTaskSchema } from '../validators/tasks.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Assignees, the creator, and admins can open a task; others see 404. */
async function loadVisibleTask(req: Request): Promise<TaskDoc> {
  const me = req.user!;
  const task = await Task.findById(req.params.id);
  if (!task) throw new AppError(404, 'Task not found');
  const assigned = task.completions.some((c) => String(c.userId) === me.id);
  if (!assigned && String(task.createdBy) !== me.id && !isAdmin(me.role)) throw new AppError(404, 'Task not found');
  return task;
}

tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    if (scope === 'all' && !isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
    const filter = scope === 'all' ? {} : { 'completions.userId': me.id };
    const tasks = await Task.find(filter).sort({ dueAt: 1, createdAt: -1 });
    res.json({ tasks: tasks.map((t) => toPublicTask(t, me.id)) });
  }),
);

tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const task = await loadVisibleTask(req);
    const body: Record<string, unknown> = { task: toPublicTask(task, me.id) };
    if (String(task.createdBy) === me.id || isAdmin(me.role)) {
      await task.populate('completions.userId', 'displayName');
      body.matrix = task.completions.map((c) => ({
        userId: String((c.userId as unknown as { _id: unknown })._id ?? c.userId),
        displayName: (c.userId as unknown as { displayName?: string })?.displayName ?? 'Unknown',
        completedAt: c.completedAt,
        note: c.note,
      }));
    }
    res.json(body);
  }),
);

tasksRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createTaskSchema),
  asyncHandler(async (req, res) => {
    const task = await createTask(req.body, req.user!);
    res.status(201).json({ task: toPublicTask(task, req.user!.id) });
  }),
);

tasksRouter.post(
  '/:id/complete',
  validate(completeTaskSchema),
  asyncHandler(async (req, res) => {
    await loadVisibleTask(req);
    const task = await completeTask(req.params.id, req.user!, req.body.note ?? '', req.body.userId);
    res.json({ task: toPublicTask(task, req.body.userId ?? req.user!.id) });
  }),
);

tasksRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) throw new AppError(404, 'Task not found');
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 5: Write `server/src/routes/taskTemplates.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { TaskTemplate, toPublicTemplate } from '../models/TaskTemplate.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { templateSchema, updateTemplateSchema } from '../validators/tasks.js';

export const taskTemplatesRouter = Router();
taskTemplatesRouter.use(requireAuth, requireRole('broker'));

type ItemInput = { title: string; descriptionHtml?: string; priority?: string; dueInDays?: number | null };

function sanitizeItems(items: ItemInput[]) {
  return items.map((i) => ({
    title: i.title,
    descriptionHtml: sanitizePostHtml(i.descriptionHtml ?? ''),
    descriptionText: htmlToText(i.descriptionHtml ?? ''),
    priority: i.priority ?? 'Medium',
    dueInDays: i.dueInDays ?? null,
  }));
}

taskTemplatesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await TaskTemplate.find().sort({ name: 1 });
    res.json({ templates: templates.map(toPublicTemplate) });
  }),
);

taskTemplatesRouter.post(
  '/',
  validate(templateSchema),
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.create({ name: req.body.name, items: sanitizeItems(req.body.items) });
    res.status(201).json({ template: toPublicTemplate(tpl) });
  }),
);

taskTemplatesRouter.patch(
  '/:id',
  validate(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.findById(req.params.id);
    if (!tpl) throw new AppError(404, 'Template not found');
    if (req.body.name !== undefined) tpl.name = req.body.name;
    if (req.body.items !== undefined) tpl.items = sanitizeItems(req.body.items) as never;
    await tpl.save();
    res.json({ template: toPublicTemplate(tpl) });
  }),
);

taskTemplatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.findByIdAndDelete(req.params.id);
    if (!tpl) throw new AppError(404, 'Template not found');
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 6: Mount both in `server/src/app.ts`**

```ts
import { tasksRouter } from './routes/tasks.js';
import { taskTemplatesRouter } from './routes/taskTemplates.js';
```
```ts
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/task-templates', taskTemplatesRouter);
```

- [ ] **Step 7: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 137 tests (134 + 3).

- [ ] **Step 8: Commit**

```bash
git add server/src/validators/tasks.ts server/src/routes/tasks.ts server/src/routes/taskTemplates.ts server/src/app.ts server/tests/tasks.test.ts
git commit -m "feat(server): task and template routes with completion matrix"
```

---

### Task 11: Task attachments — upload + protected download

**Files:**
- Modify: `server/src/routes/tasks.ts` (append two endpoints)
- Modify: `server/src/app.ts` (close the `/files/private` hole from Task 3)
- Modify: `server/src/middleware/errorHandler.ts` (generalize the multer size message)
- Test: `server/tests/taskAttachments.test.ts` (new)

25MB × 5 per task; allowlisted types only; uploads by the creator/admins; downloads by assignees/creator/admins. Download resolution: R2 → 302 to a 15-minute presigned URL; local → streamed with the original filename.

- [ ] **Step 1: Write the failing tests** — create `server/tests/taskAttachments.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Task } from '../src/models/Task.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

const PDF = Buffer.from('%PDF-1.4 fake');

describe('task attachments', () => {
  it('creator uploads (type-allowlisted), assignee downloads, outsider cannot', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'at1@x.com', 'broker');
    const agent = await loginAs(app, 'at2@x.com', 'agent');
    const outsider = await loginAs(app, 'at3@x.com', 'agent');
    const agentUser = (await User.findOne({ email: 'at2@x.com' }))!;
    const id = (
      await broker.post('/api/v1/tasks').send({ title: 'Read this', audience: { type: 'users', userIds: [agentUser.id] } })
    ).body.task.id;

    expect(
      (await agent.post(`/api/v1/tasks/${id}/attachments`).attach('file', PDF, 'guide.pdf')).status,
    ).toBe(403); // assignees don't upload
    expect(
      (
        await broker
          .post(`/api/v1/tasks/${id}/attachments`)
          .attach('file', Buffer.from('MZ fake exe'), { filename: 'evil.exe', contentType: 'application/x-msdownload' })
      ).status,
    ).toBe(400); // type not allowlisted
    const up = await broker
      .post(`/api/v1/tasks/${id}/attachments`)
      .attach('file', PDF, { filename: 'guide.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.task.attachments).toHaveLength(1);
    expect(up.body.task.attachments[0].name).toBe('guide.pdf');

    const dl = await agent.get(`/api/v1/tasks/${id}/attachments/0/download`);
    expect(dl.status).toBe(200); // local driver streams
    expect(dl.headers['content-disposition']).toContain('guide.pdf');
    expect((await outsider.get(`/api/v1/tasks/${id}/attachments/0/download`)).status).toBe(404);
    expect((await agent.get(`/api/v1/tasks/${id}/attachments/9/download`)).status).toBe(404);
  });

  it('enforces the 5-attachment cap', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'at4@x.com', 'broker');
    const id = (await broker.post('/api/v1/tasks').send({ title: 'Full', audience: { type: 'all' } })).body.task.id;
    for (let i = 0; i < 5; i++) {
      const r = await broker
        .post(`/api/v1/tasks/${id}/attachments`)
        .attach('file', PDF, { filename: `f${i}.pdf`, contentType: 'application/pdf' });
      expect(r.status).toBe(201);
    }
    const sixth = await broker
      .post(`/api/v1/tasks/${id}/attachments`)
      .attach('file', PDF, { filename: 'f5.pdf', contentType: 'application/pdf' });
    expect(sixth.status).toBe(400);
  });

  it('the local /files mount refuses private keys', async () => {
    const app = createApp();
    const res = await request(app).get('/files/private/tasks/aaaaaaaaaaaaaaaaaaaaaaaa/x.pdf');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (404s / hole test fails against the open static mount).

- [ ] **Step 3: Append the endpoints to `server/src/routes/tasks.ts`**

Add imports:

```ts
import multer from 'multer';
import { makeAttachmentKey, storage } from '../services/storage.js';
```

Module-level constants (near `isAdmin`):

```ts
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
```

Endpoints:

```ts
tasksRouter.post(
  '/:id/attachments',
  requireRole('officeAdmin'),
  attachmentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const task = await loadVisibleTask(req);
    const file = req.file;
    if (!file) throw new AppError(400, 'File is required');
    if (!ATTACHMENT_TYPES.has(file.mimetype)) throw new AppError(400, 'File type not allowed');
    if (task.attachments.length >= MAX_ATTACHMENTS) throw new AppError(400, 'Maximum of 5 attachments per task');
    const key = makeAttachmentKey('tasks', file.originalname);
    await storage.putPrivate(key, file.buffer, file.mimetype);
    task.attachments.push({
      key,
      name: file.originalname.slice(0, 120),
      size: file.size,
      contentType: file.mimetype,
    } as never);
    await task.save();
    res.status(201).json({ task: toPublicTask(task, req.user!.id) });
  }),
);

tasksRouter.get(
  '/:id/attachments/:index/download',
  asyncHandler(async (req, res) => {
    const task = await loadVisibleTask(req); // assignee/creator/admin — others 404
    const attachment = task.attachments[Number(req.params.index)];
    if (!attachment) throw new AppError(404, 'Attachment not found');
    const target = await storage.resolveDownload(attachment.key);
    if (target.kind === 'url') {
      res.redirect(302, target.url); // 15-minute presigned R2 URL
    } else {
      res.download(target.path, attachment.name);
    }
  }),
);
```

- [ ] **Step 4: Close the static hole in `server/src/app.ts`**

Replace the local-files line:

```ts
  if (env.STORAGE_DRIVER === 'local') app.use('/files', express.static(LOCAL_UPLOAD_DIR));
```

with:

```ts
  if (env.STORAGE_DRIVER === 'local') {
    // Protected files live under uploads/private/ and are served ONLY through
    // authorized download routes — never by the public static mount.
    app.use('/files', (req, res, next) => {
      if (req.path.startsWith('/private/')) return res.status(404).json({ error: 'Not found' });
      next();
    });
    app.use('/files', express.static(LOCAL_UPLOAD_DIR));
  }
```

- [ ] **Step 5: Generalize the multer size message** — in `server/src/middleware/errorHandler.ts` change `'File is too large (max 5MB)'` to `'File is too large'` (the limit now differs per route). Search the test suite for the old string (`grep -r "max 5MB" server/tests`) and update any assertion to the new message.

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 140 tests (137 + 3).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/tasks.ts server/src/app.ts server/src/middleware/errorHandler.ts server/tests/taskAttachments.test.ts
git commit -m "feat(server): task attachments with protected downloads; close private static hole"
```

---

### Task 12: Task sweeper job — due-soon, overdue, recurrence spawning

**Files:**
- Create: `server/src/jobs/taskSweep.ts`
- Modify: `server/src/jobs/index.ts`, `server/src/config/agenda.ts` (register, every 15m)
- Test: `server/tests/taskSweep.test.ts`

Three passes, all latch-guarded so re-runs are no-ops:
1. **Due soon** — incomplete completions on tasks due within the next 24h: claim `dueSoonNotifiedAt` per user (positional `$set` guarded by `$elemMatch`), then `notify` (`taskDueSoon`, email per prefs).
2. **Overdue** — incomplete completions past due: claim `overdueNotifiedAt`, then `notify` (`taskOverdue`) with **`nonDisableable: true`** email (PRD 5.9.3 — overdue emails cannot be disabled).
3. **Recurrence** — tasks with `nextRecurrenceAt <= now`: claim by atomically advancing `nextRecurrenceAt`, then spawn a fresh instance via `createTask` (audience re-resolved; new dueAt keeps the original created→due offset when one existed; spawned instances never recur themselves — the parent keeps the schedule).

- [ ] **Step 1: Write the failing tests** — create `server/tests/taskSweep.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification } from '../src/models/Notification.js';
import { Task } from '../src/models/Task.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createTask } from '../src/services/taskService.js';
import { sweepTasks } from '../src/jobs/taskSweep.js';

async function makeUser(email: string, role = 'agent') {
  return User.create({ email, hashedPassword: 'x', role, displayName: email });
}

describe('sweepTasks', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('due-soon notifies incomplete assignees exactly once, honoring prefs', async () => {
    const broker = await makeUser('s1@x.com', 'broker');
    const agent = await makeUser('s2@x.com');
    const optedOut = await makeUser('s3@x.com');
    optedOut.emailPrefs = new Map([['taskDueSoon', false]]) as never;
    await optedOut.save();
    await createTask(
      { title: 'Due soon', audience: { type: 'all' }, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      broker,
    );
    sendEmailMock.mockClear(); // discard assignment emails (due <48h emails on assignment)
    await sweepTasks();
    await sweepTasks(); // latch: no repeats
    expect(await Notification.countDocuments({ type: 'taskDueSoon', userId: agent.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskDueSoon', userId: optedOut.id })).toBe(1); // in-app always
    // email respects the pref: only the non-opted-out assignees get mail (agent + broker)
    const emailTargets = sendEmailMock.mock.calls.map((c) => c[0]).sort();
    expect(emailTargets).toEqual(['s1@x.com', 's2@x.com']);
  });

  it('overdue emails are non-disableable and fire once', async () => {
    const broker = await makeUser('s4@x.com', 'broker');
    const optedOut = await makeUser('s5@x.com');
    optedOut.emailPrefs = new Map([['taskOverdue', false]]) as never;
    await optedOut.save();
    const task = await createTask(
      { title: 'Late', audience: { type: 'users', userIds: [optedOut.id] }, dueAt: new Date(Date.now() + 3_600_000).toISOString() },
      broker,
    );
    await Task.updateOne({ _id: task.id }, { $set: { dueAt: new Date(Date.now() - 3_600_000) } });
    sendEmailMock.mockClear();
    await sweepTasks();
    await sweepTasks();
    expect(await Notification.countDocuments({ type: 'taskOverdue', userId: optedOut.id })).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // pref ignored — nonDisableable
    expect(sendEmailMock.mock.calls[0][0]).toBe('s5@x.com');
  });

  it('completed assignees are not nagged', async () => {
    const broker = await makeUser('s6@x.com', 'broker');
    const agent = await makeUser('s7@x.com');
    const task = await createTask(
      { title: 'Done already', audience: { type: 'users', userIds: [agent.id] }, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      broker,
    );
    await Task.updateOne(
      { _id: task.id, 'completions.userId': agent.id },
      { $set: { 'completions.$.completedAt': new Date() } },
    );
    await sweepTasks();
    expect(await Notification.countDocuments({ type: 'taskDueSoon' })).toBe(0);
  });

  it('spawns recurring instances, re-resolving the audience, exactly once per due date', async () => {
    const broker = await makeUser('s8@x.com', 'broker');
    await makeUser('s9@x.com');
    const parent = await createTask({ title: 'Weekly report', audience: { type: 'all' }, recurrence: 'weekly' }, broker);
    await Task.updateOne({ _id: parent.id }, { $set: { nextRecurrenceAt: new Date(Date.now() - 60_000) } });
    await makeUser('s10@x.com'); // joins AFTER parent creation — must be in the spawned instance
    await sweepTasks();
    await sweepTasks(); // advanced latch: no double spawn
    const spawned = await Task.find({ title: 'Weekly report', _id: { $ne: parent.id } });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].recurrence).toBe('none');
    expect(spawned[0].completions).toHaveLength(3); // broker + both agents (fresh resolution)
    const freshParent = (await Task.findById(parent.id))!;
    expect(freshParent.nextRecurrenceAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run to verify it fails** (module not found).

- [ ] **Step 3: Write `server/src/jobs/taskSweep.ts`**

```ts
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Task, type TaskDoc } from '../models/Task.js';
import { User } from '../models/User.js';
import { taskDueEmail } from '../services/emailService.js';
import { notify } from '../services/notificationService.js';
import { createTask } from '../services/taskService.js';

const DUE_SOON_MS = 24 * 3_600_000;

export async function sweepTasks(): Promise<void> {
  const now = new Date();
  await sweepDueSoon(now);
  await sweepOverdue(now);
  await sweepRecurrence(now);
}

async function sweepDueSoon(now: Date): Promise<void> {
  const soon = new Date(now.getTime() + DUE_SOON_MS);
  const tasks = await Task.find({
    dueAt: { $gt: now, $lte: soon },
    completions: { $elemMatch: { completedAt: null, dueSoonNotifiedAt: null } },
  });
  for (const task of tasks) {
    for (const c of task.completions) {
      if (c.completedAt || c.dueSoonNotifiedAt) continue;
      const claimed = await Task.updateOne(
        { _id: task.id, completions: { $elemMatch: { userId: c.userId, completedAt: null, dueSoonNotifiedAt: null } } },
        { $set: { 'completions.$.dueSoonNotifiedAt': now } },
      );
      if (claimed.modifiedCount !== 1) continue;
      await safeNotify(task, String(c.userId), 'taskDueSoon', 'due-soon', false);
    }
  }
}

async function sweepOverdue(now: Date): Promise<void> {
  const tasks = await Task.find({
    dueAt: { $lt: now },
    completions: { $elemMatch: { completedAt: null, overdueNotifiedAt: null } },
  });
  for (const task of tasks) {
    for (const c of task.completions) {
      if (c.completedAt || c.overdueNotifiedAt) continue;
      const claimed = await Task.updateOne(
        { _id: task.id, completions: { $elemMatch: { userId: c.userId, completedAt: null, overdueNotifiedAt: null } } },
        { $set: { 'completions.$.overdueNotifiedAt': now } },
      );
      if (claimed.modifiedCount !== 1) continue;
      await safeNotify(task, String(c.userId), 'taskOverdue', 'overdue', true); // PRD 5.9.3: cannot be disabled
    }
  }
}

async function safeNotify(
  task: TaskDoc,
  userId: string,
  type: 'taskDueSoon' | 'taskOverdue',
  emailKind: 'due-soon' | 'overdue',
  nonDisableable: boolean,
): Promise<void> {
  try {
    const { subject, html } = taskDueEmail(emailKind, task.title, `${env.APP_DOMAIN}/tasks/${task.id}`);
    await notify(
      [userId],
      {
        type,
        title: emailKind === 'due-soon' ? `Due soon: ${task.title}` : `Overdue: ${task.title}`,
        link: `/tasks/${task.id}`,
      },
      { subject, html, nonDisableable },
    );
  } catch (err) {
    logger.error({ err, taskId: task.id, userId }, 'task sweep notification failed');
  }
}

async function sweepRecurrence(now: Date): Promise<void> {
  // Claim one task at a time by atomically advancing nextRecurrenceAt.
  for (;;) {
    const parent = await Task.findOneAndUpdate(
      { nextRecurrenceAt: { $lte: now } },
      [{ $set: { nextRecurrenceAt: nextFrom('$recurrence', now) } }] as never,
      { new: false },
    );
    if (!parent) return;
    try {
      const creator = await User.findById(parent.createdBy);
      if (!creator) continue;
      const dueOffset = parent.dueAt ? parent.dueAt.getTime() - (parent.get('createdAt') as Date).getTime() : null;
      await createTask(
        {
          title: parent.title,
          descriptionHtml: parent.descriptionHtml,
          priority: parent.priority as never,
          dueAt: dueOffset !== null ? new Date(now.getTime() + dueOffset).toISOString() : null,
          audience: {
            type: parent.audience.type as never,
            userIds: parent.audience.userIds.map(String),
            officeId: parent.audience.officeId ? String(parent.audience.officeId) : null,
          },
        },
        creator,
        { isOnboarding: false, templateId: parent.templateId ? String(parent.templateId) : null },
      );
    } catch (err) {
      logger.error({ err, taskId: parent.id }, 'recurring task spawn failed');
    }
  }
}

/** Aggregation-pipeline expression advancing nextRecurrenceAt by the task's own interval. */
function nextFrom(recurrenceField: string, now: Date): unknown {
  return {
    $switch: {
      branches: [
        { case: { $eq: [recurrenceField, 'daily'] }, then: new Date(now.getTime() + 86_400_000) },
        { case: { $eq: [recurrenceField, 'weekly'] }, then: new Date(now.getTime() + 7 * 86_400_000) },
      ],
      default: new Date(new Date(now).setUTCMonth(now.getUTCMonth() + 1)),
    },
  };
}
```

- [ ] **Step 4: Register** — `server/src/jobs/index.ts`: import `sweepTasks`, define `'task-sweep'` calling it. `server/src/config/agenda.ts`: `await agenda.every('15 minutes', 'task-sweep');` and extend the log line. Update `server/tests/agenda.test.ts` expected names to `['event-reminders', 'poll-rss', 'publish-post', 'task-sweep']`.

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 144 tests (140 + 4).

- [ ] **Step 6: Commit**

```bash
git add server/src/jobs/taskSweep.ts server/src/jobs/index.ts server/src/config/agenda.ts server/tests/taskSweep.test.ts server/tests/agenda.test.ts
git commit -m "feat(server): task sweeper — due-soon, non-disableable overdue, recurrence spawning"
```

---

### Task 13: Onboarding — auto-assign on registration + progress endpoints

**Files:**
- Modify: `server/src/services/authService.ts` (replace the Stage 3 wiring comment)
- Modify: `server/src/routes/tasks.ts` (two onboarding endpoints — declared BEFORE `/:id`)
- Test: `server/tests/onboarding.test.ts` (new)

- [ ] **Step 1: Write the failing tests** — create `server/tests/onboarding.test.ts`:

```ts
import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Invitation } from '../src/models/Invitation.js';
import { getSettings } from '../src/models/Settings.js';
import { Task } from '../src/models/Task.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

async function registerViaInvite(app: ReturnType<typeof createApp>, inviterId: string, email: string) {
  const token = `tok-${email}`;
  await Invitation.create({
    email, role: 'agent', invitedBy: inviterId,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send({ token, password: 'Password1!', displayName: email });
  return { agent, status: res.status };
}

describe('onboarding', () => {
  it('registration auto-assigns the configured template; progress endpoints report it', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'ob1@x.com', 'broker');
    const brokerUser = (await User.findOne({ email: 'ob1@x.com' }))!;
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [{ title: 'Sign policies', dueInDays: 3 }, { title: 'Office tour' }],
    });
    const settings = await getSettings();
    settings.onboardingTaskTemplateId = tpl.id;
    await settings.save();

    const { agent: newbie, status } = await registerViaInvite(app, brokerUser.id, 'newagent@x.com');
    expect(status).toBe(201);
    expect(await Task.countDocuments({ isOnboarding: true })).toBe(2);

    const mine = await newbie.get('/api/v1/tasks/onboarding/mine');
    expect(mine.body).toEqual({ total: 2, completed: 0 });

    // Complete one onboarding task and re-check.
    const myTasks = await newbie.get('/api/v1/tasks?scope=mine');
    const first = myTasks.body.tasks.find((t: { isOnboarding: boolean }) => t.isOnboarding);
    await newbie.post(`/api/v1/tasks/${first.id}/complete`).send({});
    expect((await newbie.get('/api/v1/tasks/onboarding/mine')).body).toEqual({ total: 2, completed: 1 });

    // Admin status view.
    const statusRes = await broker.get('/api/v1/tasks/onboarding/status');
    const newbieUser = (await User.findOne({ email: 'newagent@x.com' }))!;
    const row = statusRes.body.statuses.find((s: { userId: string }) => s.userId === String(newbieUser._id));
    expect(row).toEqual({ userId: String(newbieUser._id), total: 2, completed: 1 });
  });

  it('registration works fine with no template configured; status endpoint is admin-only', async () => {
    const app = createApp();
    await loginAs(app, 'ob2@x.com', 'broker');
    const brokerUser = (await User.findOne({ email: 'ob2@x.com' }))!;
    const { agent: newbie, status } = await registerViaInvite(app, brokerUser.id, 'plain@x.com');
    expect(status).toBe(201);
    expect(await Task.countDocuments()).toBe(0);
    expect((await newbie.get('/api/v1/tasks/onboarding/mine')).body).toEqual({ total: 0, completed: 0 });
    expect((await newbie.get('/api/v1/tasks/onboarding/status')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (no tasks created; endpoints 404).

- [ ] **Step 3: Wire registration** — in `server/src/services/authService.ts`, replace the line

```ts
  // Stage 3 wiring: auto-assign Settings.onboardingTaskTemplateId once Tasks exist.
```

with (inside the existing side-effects `try` block, after the `notify(...)` call — reusing the `settings` already loaded there):

```ts
    if (settings.onboardingTaskTemplateId) {
      await instantiateTemplate(
        String(settings.onboardingTaskTemplateId),
        { type: 'users', userIds: [user.id] },
        String(invitation.invitedBy),
        { isOnboarding: true },
      );
    }
```

Add the import: `import { instantiateTemplate } from './taskService.js';`

- [ ] **Step 4: Add the endpoints** — in `server/src/routes/tasks.ts`, ABOVE the `GET /:id` route (Express matches in order; `onboarding` must not be captured as `:id`):

```ts
tasksRouter.get(
  '/onboarding/mine',
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const tasks = await Task.find({ isOnboarding: true, 'completions.userId': me });
    const completed = tasks.filter((t) =>
      t.completions.some((c) => String(c.userId) === me && c.completedAt),
    ).length;
    res.json({ total: tasks.length, completed });
  }),
);

tasksRouter.get(
  '/onboarding/status',
  requireRole('officeAdmin'),
  asyncHandler(async (_req, res) => {
    const rows = await Task.aggregate([
      { $match: { isOnboarding: true } },
      { $unwind: '$completions' },
      {
        $group: {
          _id: '$completions.userId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $ne: ['$completions.completedAt', null] }, 1, 0] } },
        },
      },
    ]);
    res.json({ statuses: rows.map((r) => ({ userId: String(r._id), total: r.total, completed: r.completed })) });
  }),
);
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — 146 tests (144 + 2). The Stage 3 server surface is complete.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/authService.ts server/src/routes/tasks.ts server/tests/onboarding.test.ts
git commit -m "feat(server): onboarding auto-assignment and progress endpoints"
```

---

### Task 14: Client — types + hooks for events, tasks, templates

**Files:**
- Modify: `client/src/api/types.ts` (append)
- Modify: `client/src/api/hooks.ts` (append)

No new tests here — these are thin declarations exercised by every page test in Tasks 15–19. Run the existing client suite after editing to prove nothing broke.

- [ ] **Step 1: Append to `client/src/api/types.ts`:**

```ts
export type RsvpResponse = 'yes' | 'no' | 'maybe';
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type TaskPriority = 'High' | 'Medium' | 'Low';

export interface CalendarEventInfo {
  id: string;
  title: string;
  descriptionHtml: string;
  kind: 'office' | 'personal';
  createdBy: string;
  officeId: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  recurrence: EventRecurrence;
  recurrenceUntil: string | null;
  rsvpEnabled: boolean;
  mandatory: boolean;
  resourceId: string | null;
  myRsvp: RsvpResponse | null;
  createdAt: string;
}

export interface EventOccurrence {
  event: CalendarEventInfo;
  startAt: string;
  endAt: string;
}

export interface RsvpSummary {
  yes: string[];
  no: string[];
  maybe: string[];
}

export interface TaskAttachmentInfo {
  name: string;
  size: number;
  contentType: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  descriptionHtml: string;
  createdBy: string;
  priority: TaskPriority;
  dueAt: string | null;
  attachments: TaskAttachmentInfo[];
  recurrence: EventRecurrence;
  isOnboarding: boolean;
  myCompletion: { completedAt: string | null; note: string } | null;
  counts: { total: number; completed: number };
  createdAt: string;
}

export interface TaskMatrixRow {
  userId: string;
  displayName: string;
  completedAt: string | null;
  note: string;
}

export interface TaskTemplateInfo {
  id: string;
  name: string;
  items: { title: string; descriptionHtml: string; priority: TaskPriority; dueInDays: number | null }[];
  createdAt: string;
}

export interface OnboardingProgress {
  total: number;
  completed: number;
}

export interface ReservableResource {
  _id: string;
  name: string;
}
```

Also extend the existing `Settings` interface with the new field:

```ts
  reservableResources: ReservableResource[];
```

- [ ] **Step 2: Append to `client/src/api/hooks.ts`** (extend the type import accordingly):

```ts
export function useEvents(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ['events', { fromIso, toIso }],
    queryFn: async () =>
      (
        await api.get<{ occurrences: EventOccurrence[] }>(
          `/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
        )
      ).data.occurrences,
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['events', id],
    queryFn: async () =>
      (await api.get<{ event: CalendarEventInfo; rsvpSummary?: RsvpSummary }>(`/events/${id}`)).data,
    enabled: !!id,
  });
}

export function useTasks(scope: 'mine' | 'all') {
  return useQuery({
    queryKey: ['tasks', { scope }],
    queryFn: async () => (await api.get<{ tasks: TaskInfo[] }>(`/tasks?scope=${scope}`)).data.tasks,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await api.get<{ task: TaskInfo; matrix?: TaskMatrixRow[] }>(`/tasks/${id}`)).data,
    enabled: !!id,
  });
}

export function useTaskTemplates(enabled = true) {
  return useQuery({
    queryKey: ['task-templates'],
    queryFn: async () => (await api.get<{ templates: TaskTemplateInfo[] }>('/task-templates')).data.templates,
    enabled,
  });
}

export function useMyOnboarding() {
  return useQuery({
    queryKey: ['onboarding', 'mine'],
    queryFn: async () => (await api.get<OnboardingProgress>('/tasks/onboarding/mine')).data,
  });
}

export function useOnboardingStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: async () =>
      (await api.get<{ statuses: ({ userId: string } & OnboardingProgress)[] }>('/tasks/onboarding/status')).data
        .statuses,
    enabled,
  });
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm -w client run test` (34 pass, unchanged) and `npm -w client run build` (clean).

```bash
git add client/src/api/types.ts client/src/api/hooks.ts
git commit -m "feat(client): event/task/template types and query hooks"
```

---

### Task 15: Client — calendar grid utility + CalendarPage

**Files:**
- Create: `client/src/utils/calendarGrid.ts`
- Create: `client/src/utils/calendarGrid.test.ts`
- Create: `client/src/pages/CalendarPage.tsx`
- Create: `client/src/pages/CalendarPage.test.tsx`
- Modify: `client/src/App.tsx` (route `/calendar`), `client/src/components/AppShell.tsx` (nav link, `CalendarDays` icon after Feed)

No calendar library — a 42-cell month matrix util plus list-style week/day views. All date math is LOCAL time (the user's browser timezone) because that's the rendering rule; the API range is sent as the ISO instants of the local grid bounds.

- [ ] **Step 1: Write the failing util tests** — create `client/src/utils/calendarGrid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, monthGrid, startOfWeek } from './calendarGrid';

describe('calendarGrid', () => {
  it('monthGrid returns 42 cells starting on Sunday with inMonth flags', () => {
    // July 2026: the 1st is a Wednesday.
    const cells = monthGrid(2026, 6);
    expect(cells).toHaveLength(42);
    expect(cells[0].date.getDay()).toBe(0); // Sunday
    expect(cells[0].date.getDate()).toBe(28); // June 28
    expect(cells[0].inMonth).toBe(false);
    expect(cells[3].date.getDate()).toBe(1); // July 1
    expect(cells[3].inMonth).toBe(true);
    expect(cells[33].date.getDate()).toBe(31);
    expect(cells[34].inMonth).toBe(false); // Aug 1
  });

  it('startOfWeek returns the preceding Sunday at midnight local; addDays adds calendar days', () => {
    const thu = new Date(2026, 6, 9, 15, 30);
    const sun = startOfWeek(thu);
    expect(sun.getDay()).toBe(0);
    expect(sun.getDate()).toBe(5);
    expect(sun.getHours()).toBe(0);
    expect(addDays(sun, 7).getDate()).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then write `client/src/utils/calendarGrid.ts`:

```ts
export interface DayCell {
  date: Date; // local midnight
  inMonth: boolean;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay()); // back to Sunday
  return out;
}

/** 42 local-midnight day cells (6 weeks) covering the given month, starting Sunday. */
export function monthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: date.getMonth() === month };
  });
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
```

- [ ] **Step 3: Write the failing page test** — create `client/src/pages/CalendarPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function mockApi(occurrences: unknown[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
    if (url.startsWith('/events')) return { data: { occurrences } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function occ(title: string, startAt: Date, mandatory = false) {
  return {
    event: {
      id: `e-${title}`, title, descriptionHtml: '', kind: 'office', createdBy: 'x', officeId: null,
      startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
      allDay: false, location: '', recurrence: 'none', recurrenceUntil: null,
      rsvpEnabled: false, mandatory, resourceId: null, myRsvp: null, createdAt: startAt.toISOString(),
    },
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
  };
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar']}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CalendarPage', () => {
  it('renders the month grid with events on their local days and a mandatory marker', async () => {
    const today = new Date();
    const at10 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0);
    mockApi([occ('Team meeting', at10), occ('All hands', at10, true)]);
    render(wrap());
    expect(await screen.findByText('Team meeting')).toBeInTheDocument();
    expect(screen.getByText(/All hands/)).toBeInTheDocument();
    expect(screen.getByLabelText(/mandatory/i)).toBeInTheDocument();
    // Exact names: /day/i would also match the "Today" button.
    for (const name of ['Month', 'Week', 'Day']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /new event/i })).toBeInTheDocument();
  });

  it('switches to week view as a chronological list', async () => {
    const today = new Date();
    mockApi([occ('Weekly item', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0))]);
    render(wrap());
    await screen.findByText('Weekly item');
    await userEvent.click(screen.getByRole('button', { name: /week/i }));
    expect(await screen.findByText('Weekly item')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**, then write `client/src/pages/CalendarPage.tsx`:

```tsx
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEvents } from '../api/hooks';
import type { EventOccurrence } from '../api/types';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { addDays, monthGrid, sameLocalDay, startOfWeek } from '../utils/calendarGrid';

type View = 'month' | 'week' | 'day';
const VIEWS: View[] = ['month', 'week', 'day'];

function rangeFor(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === 'month') {
    const cells = monthGrid(anchor.getFullYear(), anchor.getMonth());
    return { from: cells[0].date, to: addDays(cells[41].date, 1) };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return { from, to: addDays(from, 1) };
}

function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return addDays(anchor, view === 'week' ? 7 * dir : dir);
}

export function CalendarPage() {
  const [view, setView] = useState<View>('month'); // PRD 5.4: default Month
  const [anchor, setAnchor] = useState(() => new Date());
  const navigate = useNavigate();
  const { from, to } = rangeFor(view, anchor);
  const { data: occurrences, isLoading } = useEvents(from.toISOString(), to.toISOString());

  const title =
    view === 'month'
      ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `Week of ${startOfWeek(anchor).toLocaleDateString()}`
        : anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const occLabel = (o: EventOccurrence) => (
    <button
      key={`${o.event.id}-${o.startAt}`}
      onClick={() => navigate(`/calendar/${o.event.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left',
        background: o.event.kind === 'personal' ? 'transparent' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        border: o.event.kind === 'personal' ? '1px dashed var(--color-border)' : 'none',
        borderRadius: 'var(--radius-sm)', padding: '1px 4px', fontSize: 12, color: 'var(--color-text)',
      }}
    >
      {o.event.mandatory && <AlertCircle size={12} aria-label="Mandatory event" style={{ color: 'var(--color-danger)', flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.event.title}</span>
    </button>
  );

  const listDays = (days: Date[]) => (
    <Card>
      {days.map((day) => {
        const todays = (occurrences ?? []).filter((o) => sameLocalDay(new Date(o.startAt), day));
        if (todays.length === 0 && view === 'week') return null;
        return (
          <div key={day.toISOString()} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)' }}>
            <strong style={{ fontSize: 14 }}>{day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
            {todays.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No events.</p>}
            {todays.map((o) => (
              <div key={`${o.event.id}-${o.startAt}`} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', minHeight: 32 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', width: 90, flexShrink: 0 }}>
                  {o.event.allDay ? 'All day' : new Date(o.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </span>
                {occLabel(o)}
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1, minWidth: 200 }}>{title}</h1>
        <button aria-label="Previous" onClick={() => setAnchor(shift(view, anchor, -1))} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
          <ChevronLeft size={18} />
        </button>
        <Button variant="secondary" onClick={() => setAnchor(new Date())}>Today</Button>
        <button aria-label="Next" onClick={() => setAnchor(shift(view, anchor, 1))} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
          <ChevronRight size={18} />
        </button>
        {VIEWS.map((v) => (
          <Button key={v} variant={view === v ? 'primary' : 'secondary'} aria-pressed={view === v} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
        <Link
          to="/calendar/new"
          style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}
        >
          New event
        </Link>
      </div>

      {isLoading && <Spinner label="Loading calendar" />}

      {view === 'month' && (
        <Card style={{ padding: 'var(--space-2)', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(90px, 1fr))', gap: 2 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', padding: 4 }}>{d}</div>
            ))}
            {monthGrid(anchor.getFullYear(), anchor.getMonth()).map((cell) => {
              const todays = (occurrences ?? []).filter((o) => sameLocalDay(new Date(o.startAt), cell.date));
              return (
                <div
                  key={cell.date.toISOString()}
                  style={{
                    minHeight: 88, padding: 2, borderRadius: 'var(--radius-sm)',
                    background: cell.inMonth ? 'transparent' : 'color-mix(in srgb, var(--color-border) 30%, transparent)',
                    outline: sameLocalDay(cell.date, new Date()) ? '2px solid var(--color-accent)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 12, color: cell.inMonth ? 'var(--color-text)' : 'var(--color-text-muted)', padding: 2 }}>
                    {cell.date.getDate()}
                  </div>
                  {todays.slice(0, 3).map(occLabel)}
                  {todays.length > 3 && (
                    <button
                      onClick={() => { setAnchor(cell.date); setView('day'); }}
                      style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', padding: '1px 4px' }}
                    >
                      +{todays.length - 3} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {view === 'week' && listDays(Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)))}
      {view === 'day' && listDays([new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())])}
    </div>
  );
}
```

- [ ] **Step 5: Route + nav**

`client/src/App.tsx`: `<Route path="/calendar" element={<CalendarPage />} />` (inside the authenticated layout, after `/feed`). `client/src/components/AppShell.tsx`: import `CalendarDays` from lucide-react and add after the Feed link:

```tsx
          <NavLink to="/calendar" style={({ isActive }) => navLinkStyle(isActive)}>
            <CalendarDays size={18} />
            Calendar
          </NavLink>
```

- [ ] **Step 6: Run the full client suite**

Run: `npm -w client run test`
Expected: PASS — 38 tests (34 + 2 util + 2 page). Build + lint clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/calendarGrid.ts client/src/utils/calendarGrid.test.ts client/src/pages/CalendarPage.tsx client/src/pages/CalendarPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): calendar page with month/week/day views"
```

---

### Task 16: Client — event editor + event detail with RSVP

**Files:**
- Create: `client/src/pages/EventEditorPage.tsx`
- Create: `client/src/pages/EventDetailPage.tsx`
- Create: `client/src/pages/EventDetailPage.test.tsx`
- Modify: `client/src/App.tsx` (routes `/calendar/new`, `/calendar/:id`, `/calendar/:id/edit` — `new` FIRST)

The editor follows `PostEditorPage`'s architecture exactly (seeding latch + `[id]` reset effect + `RichTextEditor` + datetime-local inputs + isAxiosError alert — read that file and mirror it). The full editor code is below; the detail page carries the RSVP UI.

- [ ] **Step 1: Write the failing detail-page test** — create `client/src/pages/EventDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EventDetailPage } from './EventDetailPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({ data: {} })) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn(), patch: vi.fn() } }));

function mockApi({ role = 'agent', createdBy = 'other', rsvpSummary = undefined as unknown }) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/events/e1')
      return {
        data: {
          event: {
            id: 'e1', title: 'Compliance training', descriptionHtml: '<p>Bring your <strong>license</strong></p>',
            kind: 'office', createdBy, officeId: null,
            startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
            allDay: false, location: 'HQ', recurrence: 'weekly', recurrenceUntil: null,
            rsvpEnabled: true, mandatory: true, resourceId: null, myRsvp: null, createdAt: '2026-08-01T00:00:00.000Z',
          },
          ...(rsvpSummary ? { rsvpSummary } : {}),
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar/e1']}>
        <Routes>
          <Route path="/calendar/:id" element={<EventDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventDetailPage', () => {
  it('renders detail with mandatory badge, rich description, and RSVP buttons; sends RSVP', async () => {
    mockApi({});
    render(wrap());
    expect(await screen.findByText('Compliance training')).toBeInTheDocument();
    expect(screen.getByText('Mandatory')).toBeInTheDocument();
    expect(screen.getByText('license')).toBeInTheDocument(); // rich html rendered
    expect(screen.getByText('HQ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(postMock).toHaveBeenCalledWith('/events/e1/rsvp', { response: 'yes' });
    expect(screen.queryByText(/responses/i)).not.toBeInTheDocument(); // summary hidden for non-creator
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('creator sees the RSVP summary and manage actions', async () => {
    mockApi({ createdBy: 'me', rsvpSummary: { yes: ['Ana'], no: [], maybe: ['Bob'] } });
    render(wrap());
    await screen.findByText('Compliance training');
    expect(screen.getByText(/responses/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then write `client/src/pages/EventDetailPage.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEvent, useMe } from '../api/hooks';
import type { RsvpResponse } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const RESPONSES: RsvpResponse[] = ['yes', 'no', 'maybe'];

export function EventDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useEvent(id);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const sendRsvp = useMutation({
    mutationFn: (response: RsvpResponse) => api.post(`/events/${id}/rsvp`, { response }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
  const deleteEvent = useMutation({
    mutationFn: () => api.delete(`/events/${id}`),
    onSuccess: () => {
      navigate('/calendar');
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const errText = (m: { isError: boolean; error: unknown }, fallback: string) =>
    m.isError
      ? isAxiosError(m.error)
        ? ((m.error.response?.data as { error?: string })?.error ?? fallback)
        : fallback
      : undefined;

  if (isLoading) return <Spinner label="Loading event" />;
  if (!data) {
    if (isAxiosError(error) && error.response?.status === 404)
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Event not found</h2>
        </Card>
      );
    return null;
  }

  const { event, rsvpSummary } = data;
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const canManage = event.createdBy === me?.id || (event.kind === 'office' && isAdmin);
  const when = event.allDay
    ? new Date(event.startAt).toLocaleDateString()
    : `${new Date(event.startAt).toLocaleString()} – ${new Date(event.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{event.title}</h1>
          {event.mandatory && <Badge tone="danger">Mandatory</Badge>}
          {event.kind === 'personal' && <Badge tone="neutral">Personal</Badge>}
          {event.recurrence !== 'none' && <Badge tone="accent">{event.recurrence}</Badge>}
        </div>
        <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{when}</p>
        {event.location && <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{event.location}</p>}
        {event.descriptionHtml && (
          // Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe.
          <div style={{ marginTop: 'var(--space-3)' }} dangerouslySetInnerHTML={{ __html: event.descriptionHtml }} />
        )}
        {canManage && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Link
              to={`/calendar/${event.id}/edit`}
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none' }}
            >
              Edit
            </Link>
            <Button
              variant="danger"
              onClick={() => { if (window.confirm('Delete this event?')) deleteEvent.mutate(); }}
              disabled={deleteEvent.isPending}
            >
              Delete
            </Button>
          </div>
        )}
        {errText(deleteEvent, 'Could not delete the event') && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {errText(deleteEvent, 'Could not delete the event')}
          </p>
        )}
      </Card>

      {event.rsvpEnabled && event.kind === 'office' && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Will you attend?</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {RESPONSES.map((r) => (
              <Button
                key={r}
                variant={event.myRsvp === r ? 'primary' : 'secondary'}
                aria-pressed={event.myRsvp === r}
                onClick={() => sendRsvp.mutate(r)}
                disabled={sendRsvp.isPending}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </Button>
            ))}
          </div>
          {errText(sendRsvp, 'Could not save your RSVP') && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
              {errText(sendRsvp, 'Could not save your RSVP')}
            </p>
          )}
          {rsvpSummary && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 15 }}>Responses</h3>
              {(['yes', 'no', 'maybe'] as const).map((k) => (
                <p key={k} style={{ fontSize: 14 }}>
                  <strong>{k[0].toUpperCase() + k.slice(1)} ({rsvpSummary[k].length}):</strong>{' '}
                  {rsvpSummary[k].join(', ') || '—'}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `client/src/pages/EventEditorPage.tsx`** — mirror `PostEditorPage.tsx` structurally (read it first): same `toLocalInputValue` helper (copy it with its comment), same `seeded` latch + `[id]` reset effect (the ProfilePage-precedent comment), same save-mutation/error-alert shape. Differences:

- State: `title`, `descriptionHtml`, `kind` (`'office' | 'personal'`, radio-style select; only rendered when the user is admin — agents always create personal), `officeId` (select from `settings.officeLocations`, office kind only), `startAt`/`endAt` (datetime-local, both required), `allDay` checkbox, `location` text, `recurrence` select (`none/daily/weekly/monthly`), `recurrenceUntil` (datetime-local, only when recurrence ≠ none), `rsvpEnabled` checkbox (office kind), `mandatory` checkbox (office kind, rendered only for `me.role === 'broker'`), `resourceId` (select from `settings.reservableResources`, office kind; empty option "No resource").
- Submit body: everything above with `startAt: new Date(startAt).toISOString()`, `endAt: …`, `recurrenceUntil: recurrenceUntil ? new Date(recurrenceUntil).toISOString() : null`, `officeId: officeId || null`, `resourceId: resourceId || null`. POST `/events` (create) / PATCH `/events/:id` (edit — omit `kind`). On success navigate to `/calendar/${event.id}`, invalidating `['events']`.
- Edit-mode seeding from `useEvent(id)`: all fields incl. `wasScheduled`-style handling is NOT needed here (no publish semantics); seed datetime fields via `toLocalInputValue`.
- The 409 conflict from a resource clash surfaces through the standard error alert (server message: "Resource is already reserved during that time").

Full file expected ~200 lines. Keep every control labeled (`<label htmlFor>`), 44px min heights, and the editor's submit disabled while pending.

- [ ] **Step 4: Routes** — in `client/src/App.tsx` (order matters):

```tsx
        <Route path="/calendar/new" element={<EventEditorPage />} />
        <Route path="/calendar/:id" element={<EventDetailPage />} />
        <Route path="/calendar/:id/edit" element={<EventEditorPage />} />
```

No role guard: agents legitimately create (personal) events; office-kind authorization is server-enforced and the editor hides office controls from agents.

- [ ] **Step 5: Run the full client suite**

Run: `npm -w client run test`
Expected: PASS — 40 tests (38 + 2). Build + lint clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/EventEditorPage.tsx client/src/pages/EventDetailPage.tsx client/src/pages/EventDetailPage.test.tsx client/src/App.tsx
git commit -m "feat(client): event editor and detail with rsvp and creator summary"
```

---

### Task 17: Client — tasks list + task detail

**Files:**
- Create: `client/src/pages/TasksPage.tsx`
- Create: `client/src/pages/TasksPage.test.tsx`
- Create: `client/src/pages/TaskDetailPage.tsx`
- Create: `client/src/pages/TaskDetailPage.test.tsx`
- Modify: `client/src/App.tsx` (routes `/tasks`, `/tasks/new` placeholder comes in Task 18, `/tasks/:id`), `client/src/components/AppShell.tsx` (nav link, `ClipboardList` icon after Calendar)

- [ ] **Step 1: Write the failing TasksPage test** — create `client/src/pages/TasksPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TaskInfo } from '../api/types';
import { TasksPage } from './TasksPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function task(overrides: Partial<TaskInfo>): TaskInfo {
  return {
    id: 't1', title: 'T', descriptionHtml: '', createdBy: 'b', priority: 'Medium', dueAt: null,
    attachments: [], recurrence: 'none', isOnboarding: false,
    myCompletion: { completedAt: null, note: '' }, counts: { total: 1, completed: 0 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi(role: string, tasks: TaskInfo[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url.startsWith('/tasks?')) return { data: { tasks } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks']}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TasksPage', () => {
  it('shows my open tasks with priority and overdue badges; no admin controls for agents', async () => {
    mockApi('agent', [
      task({ id: 't1', title: 'Overdue thing', priority: 'High', dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
      task({ id: 't2', title: 'Done thing', myCompletion: { completedAt: new Date().toISOString(), note: '' } }),
    ]);
    render(wrap());
    expect(await screen.findByText('Overdue thing')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Done thing')).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all tasks/i })).not.toBeInTheDocument();
  });

  it('admins get the All tasks scope and New task action', async () => {
    mockApi('broker', [task({ id: 't3', title: 'Anything' })]);
    render(wrap());
    expect(await screen.findByText('Anything')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all tasks/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then write `client/src/pages/TasksPage.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useTasks } from '../api/hooks';
import type { TaskInfo } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const PRIORITY_TONE = { High: 'danger', Medium: 'accent', Low: 'neutral' } as const;

export function isOverdue(t: TaskInfo): boolean {
  return !!t.dueAt && new Date(t.dueAt) < new Date() && !t.myCompletion?.completedAt;
}

export function TasksPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { data: tasks, isLoading } = useTasks(scope);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Tasks</h1>
        {isAdmin && (
          <>
            <Button variant={scope === 'mine' ? 'primary' : 'secondary'} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
              My tasks
            </Button>
            <Button variant={scope === 'all' ? 'primary' : 'secondary'} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              All tasks
            </Button>
            <Link
              to="/tasks/new"
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}
            >
              New task
            </Link>
          </>
        )}
      </div>

      {isLoading && <Spinner label="Loading tasks" />}
      {tasks?.length === 0 && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>No tasks here.</p>
        </Card>
      )}
      {tasks?.map((t) => (
        <Card key={t.id} style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to={`/tasks/${t.id}`} style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
              {t.title}
            </Link>
            <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
            {t.isOnboarding && <Badge tone="accent">Onboarding</Badge>}
            {isOverdue(t) && <Badge tone="danger">Overdue</Badge>}
            {t.myCompletion?.completedAt && <Badge tone="success">Completed</Badge>}
          </div>
          <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : 'No due date'}
            {scope === 'all' && ` · ${t.counts.completed}/${t.counts.total} done`}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write the failing TaskDetailPage test** — create `client/src/pages/TaskDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({ data: {} })) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn() } }));

function mockApi({ role = 'agent', completedAt = null as string | null, matrix = undefined as unknown }) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/tasks/t1')
      return {
        data: {
          task: {
            id: 't1', title: 'File the form', descriptionHtml: '<p>Use <strong>blue ink</strong></p>',
            createdBy: 'b', priority: 'High', dueAt: null,
            attachments: [{ name: 'guide.pdf', size: 100, contentType: 'application/pdf' }],
            recurrence: 'none', isOnboarding: false,
            myCompletion: { completedAt, note: '' }, counts: { total: 2, completed: 0 },
            createdAt: new Date().toISOString(),
          },
          ...(matrix ? { matrix } : {}),
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaskDetailPage', () => {
  it('renders description, attachment download link, and completes with a note', async () => {
    mockApi({});
    render(wrap());
    expect(await screen.findByText('File the form')).toBeInTheDocument();
    expect(screen.getByText('blue ink')).toBeInTheDocument();
    const dl = screen.getByRole('link', { name: /guide\.pdf/i });
    expect(dl).toHaveAttribute('href', '/api/v1/tasks/t1/attachments/0/download');
    await userEvent.type(screen.getByLabelText(/completion note/i), 'done and filed');
    await userEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(postMock).toHaveBeenCalledWith('/tasks/t1/complete', { note: 'done and filed' });
  });

  it('completed tasks show state instead of the form; admins see the matrix', async () => {
    mockApi({
      role: 'broker',
      completedAt: new Date().toISOString(),
      matrix: [
        { userId: 'u1', displayName: 'Ana', completedAt: new Date().toISOString(), note: 'ok' },
        { userId: 'u2', displayName: 'Bob', completedAt: null, note: '' },
      ],
    });
    render(wrap());
    await screen.findByText('File the form');
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/you completed this task/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**, then write `client/src/pages/TaskDetailPage.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useMe, useTask } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export function TaskDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useTask(id);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const complete = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/complete`, { note }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const completeError =
    complete.isError && isAxiosError(complete.error)
      ? ((complete.error.response?.data as { error?: string })?.error ?? 'Could not complete the task')
      : complete.isError
        ? 'Could not complete the task'
        : undefined;

  if (isLoading) return <Spinner label="Loading task" />;
  if (!data) {
    if (isAxiosError(error) && error.response?.status === 404)
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Task not found</h2>
        </Card>
      );
    return null;
  }

  const { task, matrix } = data;
  const assigned = task.myCompletion !== null;
  const completedAt = task.myCompletion?.completedAt;
  const overdue = !!task.dueAt && new Date(task.dueAt) < new Date() && !completedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{task.title}</h1>
          <Badge tone={task.priority === 'High' ? 'danger' : task.priority === 'Medium' ? 'accent' : 'neutral'}>
            {task.priority}
          </Badge>
          {overdue && <Badge tone="danger">Overdue</Badge>}
        </div>
        <p style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {task.dueAt ? `Due ${new Date(task.dueAt).toLocaleString()}` : 'No due date'}
        </p>
        {task.descriptionHtml && (
          // Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe.
          <div style={{ marginTop: 'var(--space-3)' }} dangerouslySetInnerHTML={{ __html: task.descriptionHtml }} />
        )}
        {task.attachments.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {task.attachments.map((a, i) => (
              <a
                key={i}
                href={`/api/v1/tasks/${task.id}/attachments/${i}/download`}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}
              >
                <Paperclip size={16} aria-hidden />
                {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)
              </a>
            ))}
          </div>
        )}
      </Card>

      {assigned && (
        <Card>
          {completedAt ? (
            <p style={{ fontSize: 14 }}>
              ✓ You completed this task on {new Date(completedAt).toLocaleString()}.
              {task.myCompletion?.note && ` Note: ${task.myCompletion.note}`}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                complete.mutate();
              }}
            >
              <label htmlFor="completion-note" style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 'var(--space-1)' }}>
                Completion note (optional)
              </label>
              <input
                id="completion-note"
                aria-label="Completion note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                style={{ width: '100%', minHeight: 44, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-3)', background: 'var(--color-surface)', marginBottom: 'var(--space-3)' }}
              />
              {completeError && (
                <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-2)' }}>
                  {completeError}
                </p>
              )}
              <Button type="submit" disabled={complete.isPending}>
                {complete.isPending ? 'Saving…' : 'Mark complete'}
              </Button>
            </form>
          )}
        </Card>
      )}

      {matrix && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>
            Completion — {task.counts.completed}/{task.counts.total}
          </h2>
          {matrix.map((row) => (
            <div key={row.userId} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', padding: 'var(--space-1) 0', borderBottom: '1px solid var(--color-border)', fontSize: 14 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{row.displayName}</span>
              {row.completedAt ? (
                <span style={{ color: 'var(--color-success)' }}>
                  Done {new Date(row.completedAt).toLocaleDateString()}
                  {row.note && ` — ${row.note}`}
                </span>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>Open</span>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
```

Note (why `me` is imported but only role-checked implicitly): admins receive `matrix` from the server; the client renders it when present — no client-side role logic needed beyond what the server already decided. If `useMe` ends up unused after writing, remove the import (lint will flag it).

- [ ] **Step 5: Routes + nav** — `client/src/App.tsx`: `/tasks` (TasksPage) and `/tasks/:id` (TaskDetailPage) inside the authenticated layout (leave `/tasks/new` for Task 18, declared before `/tasks/:id` when added). `client/src/components/AppShell.tsx`: `ClipboardList` icon link "Tasks" after Calendar.

- [ ] **Step 6: Run the full client suite**

Run: `npm -w client run test`
Expected: PASS — 44 tests (40 + 4). Build + lint clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/TasksPage.tsx client/src/pages/TasksPage.test.tsx client/src/pages/TaskDetailPage.tsx client/src/pages/TaskDetailPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): tasks list and detail with completion, attachments, matrix"
```

---

### Task 18: Client — task editor + template management

**Files:**
- Create: `client/src/pages/TaskEditorPage.tsx`
- Create: `client/src/pages/TaskEditorPage.test.tsx`
- Create: `client/src/pages/admin/TemplatesPage.tsx`
- Create: `client/src/pages/admin/TemplatesPage.test.tsx`
- Modify: `client/src/App.tsx` (routes `/tasks/new` before `/tasks/:id`; `/admin/templates` broker-guarded), `client/src/components/AppShell.tsx` (admin "Templates" link, `LayoutTemplate` icon, broker-only)

- [ ] **Step 1: TaskEditorPage** (`/tasks/new`, admin-guarded via `RequireAuth min="officeAdmin"`). Mirror PostEditorPage's structure (no edit mode — tasks aren't edited after creation in Phase 1; PRD defines create/complete/delete only). Fields and submit body:

- `title` (Field, required, max 200), `descriptionHtml` (RichTextEditor), `priority` (select High/Medium/Low, default Medium), `dueAt` (datetime-local, optional), `recurrence` (select none/daily/weekly/monthly), and an **audience picker**: radio-style select of `all | office | users`; when `office` — office select from `settings.officeLocations`; when `users` — a checkbox list of active users from `useUsers()` (Stage 1 hook; filter to `status === 'active'`), each row 44px with the user's displayName.
- Submit: `POST /tasks` with `{ title, descriptionHtml, priority, dueAt: dueAt ? new Date(dueAt).toISOString() : null, recurrence, audience: { type, officeId: type==='office' ? officeId : null, userIds: type==='users' ? selectedIds : [] } }` → navigate `/tasks/${task.id}`, invalidate `['tasks']`.
- Standard isAxiosError alert; submit disabled while pending or (type==='users' && none selected).

Test (`TaskEditorPage.test.tsx`, RichTextEditor mocked as the Stage 2 textarea stand-in): mock `/auth/me` (broker), `/settings` (one office), `/users` (two active users); select audience "users", check one user, type a title, submit, assert POST body contains `audience: { type: 'users', userIds: ['u2'], officeId: null }` and the typed title.

- [ ] **Step 2: TemplatesPage** (`/admin/templates`, broker-guarded via `RequireAuth min="broker"`). Layout: list of template Cards (name + item count + Delete with confirm), a create/edit form Card (name Field; item rows each with title Field, priority select, dueInDays number input, remove button; "Add item" button appends a row; Save posts). Use `useTaskTemplates()` + inline mutations (`POST /task-templates`, `PATCH /task-templates/:id`, `DELETE /task-templates/:id`), invalidating `['task-templates']`. Editing loads a template's fields into the form (an `editingId` state; Cancel resets). Rich text per item is out of scope for the form — items carry plain descriptions in Phase 1 UI; pass `descriptionHtml: ''` (the server sanitizes anyway). Standard error alert. Every input labeled (aria-label with the item index, mirroring SettingsPage's office rows).

Test (`TemplatesPage.test.tssx` — name it `.test.tsx`): mock one existing template; assert it lists; fill the form with a name and one item title, submit, assert POST body `{ name, items: [expect.objectContaining({ title })] }`; click its Delete (confirm stubbed true) and assert DELETE called.

- [ ] **Step 3: Routes + nav.** `/tasks/new` MUST be declared before `/tasks/:id`. Admin nav: inside the existing `isBroker` block in AppShell (next to Settings), add the Templates link.

- [ ] **Step 4: Run the full client suite**

Run: `npm -w client run test`
Expected: PASS — 48 tests (44 + 2 + 2). Build + lint clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TaskEditorPage.tsx client/src/pages/TaskEditorPage.test.tsx client/src/pages/admin/TemplatesPage.tsx client/src/pages/admin/TemplatesPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): task creation with audience picker; broker template management"
```

---

### Task 19: Client — dashboard widgets, onboarding visibility, settings + prefs wiring

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx` (My Tasks panel + onboarding progress bar)
- Modify: `client/src/pages/admin/UsersPage.tsx` (onboarding status column)
- Modify: `client/src/pages/admin/SettingsPage.tsx` (reservable resources editor + onboarding template selector)
- Modify: `client/src/pages/ProfilePage.tsx` (new email-pref rows incl. opt-in eventReminders)
- Test: `client/src/pages/DashboardPage.test.tsx` (new), plus updates to `ProfilePage.test.tsx` mocks if needed

- [ ] **Step 1: DashboardPage.** Replace the placeholder Card ("Announcements, tasks, and events will appear here…") with two widgets, keeping the welcome Card:

```tsx
// additions at the top
import { Link } from 'react-router-dom';
import { useMyOnboarding, useTasks } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { isOverdue } from './TasksPage';
```

Inside the component:

```tsx
  const { data: onboarding } = useMyOnboarding();
  const { data: tasks } = useTasks('mine');
  const openTasks = (tasks ?? []).filter((t) => !t.myCompletion?.completedAt).slice(0, 5);
  const showOnboarding = onboarding && onboarding.total > 0 && onboarding.completed < onboarding.total;
```

Widgets (before the closing `</div>`):

```tsx
      {showOnboarding && (
        <Card>
          <h2 style={{ fontSize: 18 }}>Onboarding progress</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            {onboarding.completed} of {onboarding.total} tasks done
          </p>
          <div
            role="progressbar"
            aria-valuenow={Math.round((onboarding.completed / onboarding.total) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 10, borderRadius: 999, background: 'color-mix(in srgb, var(--color-border) 60%, transparent)', overflow: 'hidden', marginTop: 'var(--space-2)' }}
          >
            <div style={{ width: `${(onboarding.completed / onboarding.total) * 100}%`, height: '100%', background: 'var(--color-accent)' }} />
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 18, flex: 1 }}>My tasks</h2>
          <Link to="/tasks" style={{ fontSize: 14 }}>All tasks</Link>
        </div>
        {openTasks.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Nothing open — nice.</p>}
        {openTasks.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--color-border)' }}>
            <Link to={`/tasks/${t.id}`} style={{ flex: 1, color: 'var(--color-text)', fontSize: 14 }}>{t.title}</Link>
            {isOverdue(t) && <Badge tone="danger">Overdue</Badge>}
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t.dueAt ? new Date(t.dueAt).toLocaleDateString() : ''}
            </span>
          </div>
        ))}
      </Card>
```

Test (`DashboardPage.test.tsx`, standard mock wrap): mock `/auth/me`, `/settings`, `/tasks?scope=mine` (one open overdue task, one completed), `/tasks/onboarding/mine` → `{total: 3, completed: 1}`; assert the progress bar (`role="progressbar"` with `aria-valuenow` 33), the open task listed with Overdue badge, and the completed one absent.

- [ ] **Step 2: UsersPage onboarding column.** Read the file; it renders a users table (`<th>User/Email/Role/Office/Status/Actions`). Add a column `Onboarding` between Status and Actions: `const { data: onboardingStatuses } = useOnboardingStatus(true);` (the page is already admin-gated by its route), build `const obByUser = new Map((onboardingStatuses ?? []).map((s) => [s.userId, s]));` and render per row: complete (`total>0 && completed===total`) → `<Badge tone="success">Done</Badge>`; in progress → `<Badge tone="accent">{completed}/{total}</Badge>`; no onboarding rows → `<span style={{color:'var(--color-text-muted)'}}>—</span>`. Extend the page's existing test mock with a `/tasks/onboarding/status` handler returning `[]` so existing tests stay green (they assert other columns).

- [ ] **Step 3: SettingsPage additions.** Read the file; mirror the offices editor exactly for **Reservable resources** (state array of `{_id?, name}` rows seeded from `settings.reservableResources`, add/remove/update rows with aria-labels `Resource ${i+1} name`, included in the existing save PATCH body as `reservableResources`). Below it add **Onboarding template**: `const { data: templates } = useTaskTemplates(me?.role === 'broker');` and a labeled `<select id="onboarding-template">` with an empty "None" option + one option per template, bound to a `onboardingTaskTemplateId` state string seeded from settings, sent in the save body as `onboardingTaskTemplateId: value || null`. NOTE: the server's `updateSettingsSchema` must accept it — check `server/src/validators/settings.ts`; if `onboardingTaskTemplateId` is not in the schema, add `onboardingTaskTemplateId: z.string().nullable().optional()` (tiny server edit, include it in this commit and note it in the commit body). Extend the page's test mock with `/task-templates` → `{ templates: [] }`.

- [ ] **Step 4: ProfilePage email prefs.** The `EMAIL_PREFS` array gains a `defaultOn` flag (default true). Replace the array with:

```tsx
const EMAIL_PREFS: { key: string; label: string; adminOnly?: boolean; defaultOn?: boolean }[] = [
  { key: 'postPublished', label: 'Important announcements' },
  { key: 'invitationAccepted', label: 'An invitation I sent is accepted', adminOnly: true },
  { key: 'taskAssigned', label: 'Task assignments (High priority or due soon)' },
  { key: 'taskDueSoon', label: 'Task due-soon reminders' },
  { key: 'mandatoryEvent', label: 'Mandatory event announcements' },
  // Opt-IN (PRD 5.4): event reminders are off unless enabled.
  { key: 'eventReminders', label: 'Event reminders (24h and 1h before)', defaultOn: false },
];
```

And change the checkbox line to honor it: `checked={user.emailPrefs[p.key] ?? p.defaultOn !== false}`. Overdue-task emails are deliberately NOT listed — they cannot be disabled (PRD 5.9.3); add that as muted helper text under the list: `Overdue-task emails are always sent.`

- [ ] **Step 5: Run the full client suite**

Run: `npm -w client run test`
Expected: PASS — 49+ tests (48 + 1 dashboard; existing page tests updated, not removed). Build + lint clean. Full server suite still green if the validator was touched.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/pages/DashboardPage.test.tsx client/src/pages/admin/UsersPage.tsx client/src/pages/admin/UsersPage.test.tsx client/src/pages/admin/SettingsPage.tsx client/src/pages/admin/SettingsPage.test.tsx client/src/pages/ProfilePage.tsx server/src/validators/settings.ts
git commit -m "feat(client): dashboard task/onboarding widgets, admin onboarding status, settings + prefs wiring"
```

---

### Task 20: Finish — docs, full verification, live smoke

**Files:**
- Modify: `README.md` (docs list + one-line Stage 3 status), `docs/superpowers/plans/2026-07-09-roadmap.md` (Stage 3 heading gains `✦ plan: 2026-07-10-stage-3-coordination.md`)

- [ ] **Step 1: Docs.** Roadmap Stage 3 heading: `## Stage 3 — Coordination ✦ plan: \`2026-07-10-stage-3-coordination.md\``. README: add the plan link to the Docs list and extend the status sentence with: shared calendar (RSVP, reservable resources, reminders), task management (templates, recurrence, attachments), structured onboarding.

- [ ] **Step 2: Full verification.** `npm run lint && npm run test && npm run build` — all green, report exact counts (expected: server 146, client ≈49). Any failure is a blocker.

- [ ] **Step 3: Live smoke (controller-run, ephemeral DB — the Stage 2 procedure):** boot in-memory Mongo + API + Vite; seed broker + one agent. Verify: create a reservable resource + onboarding template (2 items) in admin → invite/register a fresh agent → their dashboard shows the onboarding progress bar and My Tasks; create an office event with the resource → creating a second overlapping event with the same resource is rejected with the conflict message; RSVP yes as agent → broker sees the summary; create a High-priority task for all users → agent gets bell + (console) email → agent completes with a note → broker sees the matrix update → agent's feed shows "You completed…"; month/week/day views render; attachment upload + download round-trips.

- [ ] **Step 4: Commit, push (controller), PR:**

```bash
git add README.md docs/superpowers/plans/2026-07-09-roadmap.md
git commit -m "docs: stage 3 notes and roadmap link"
```

Then push and open the PR titled `Stage 3 — Coordination` per the finishing-a-development-branch skill; confirm CI green before merge.

---

## Deferred to later stages (do NOT build now)

- Resource Hub link UI on tasks (`relatedResourceId` field exists; Stage 4 adds the picker + Resources).
- Dashboard events widget + homepage layout config (Stage 5 assembles; My Tasks + onboarding shipped now per roadmap).
- Retention: task history 2y, activity 90d, RSS 30d (Stage 5 jobs).
- "Custom" recurrence (Phase 2 — documented delta), Google/Outlook sync (explicitly out per PRD 5.4).
- Group targeting (Phase 2).

## Carried backlog (unchanged)

Dummy-scrypt timing hardening · accent default dedup · RR v7 future flags · full focus trap for drawer + sidebar overlay · admin-set avatars route · feed/board pagination trade-offs (documented in code).






