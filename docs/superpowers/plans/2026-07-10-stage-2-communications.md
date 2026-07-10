# Stage 2 — Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the communications layer: notification system (in-app bell + email prefs), message board with rich-text posts and flat comments, internal activity feed with RSS ingestion, background-job infrastructure (Agenda), and the deferred "invitation accepted" trigger from Stage 1.

**Architecture:** Everything builds on the Stage 1 skeleton — new Mongoose models (`Notification`, `ActivityEvent`, `Post`, `Comment`, `RssItem`), thin routes calling services, Zod validation, and role guards. Rich text is authored client-side with TipTap and **sanitized server-side** with `sanitize-html` (server never trusts client HTML). Agenda (MongoDB-backed, no Redis) runs two jobs: hourly RSS polling and one-off scheduled-post publishing; both are idempotent so catch-up-on-boot is safe on a sleeping free host. The feed merges internal activity events and cached RSS items in the service layer (two indexed queries + JS merge — no fragile aggregation), cursor-paginated 20/page.

**Tech Stack:** Adds `agenda@^5`, `rss-parser@^3`, `sanitize-html@^2` (+types) to the server; `@tiptap/react@^2` + `starter-kit`/`link`/`image`/`pm` to the client. Everything else is the Stage 1 stack (Express 4, Mongoose 8, Zod 3, Vitest 2 + Supertest + mongodb-memory-server, React 18 + TanStack Query 5).

**Conventions for every task:**
- Run all commands from the repo root (`C:\Users\derri\OneDrive\Desktop\openagent`). Bash syntax.
- Server relative imports MUST use `.js` extensions (ESM + NodeNext) even in `.ts` source.
- Work on branch `feat/stage-2-communications` (created in Task 1). Commit after each green task. Never commit `.env`.
- Server tests: `npm -w server run test`. Client tests: `npm -w client run test`. `server/tests/setup.ts` already provides an in-memory Mongo per run and wipes collections between tests — no changes needed there.
- Agenda is **never started in tests** (it is only started from `server/src/index.ts`, which tests never import). Job handlers are exported as plain functions and tested directly.
- New client pages follow the existing style: inline styles with `var(--…)` design tokens, primitives from `components/ui/`, queries in `api/hooks.ts`, mutations declared inline in pages with `useMutation`. Consult `DESIGN.md` for tokens and interaction rules.
- No new env vars in this stage. `.env.example` is unchanged.

**API surface added (all under `/api/v1`):**

| Method & path | Who | Purpose |
|---|---|---|
| `GET /notifications` | any user | first/next page + unread count |
| `POST /notifications/:id/read` | any user | mark one read |
| `POST /notifications/read-all` | any user | mark all read |
| `GET /posts` · `GET /posts/:id` | any user (visibility-scoped) | board list/search + detail |
| `POST /posts` · `PATCH /posts/:id` · `DELETE /posts/:id` | officeAdmin+ | create/edit/delete |
| `POST /posts/:id/pin` · `DELETE /posts/:id/pin` | officeAdmin+ | pin (max 3) / unpin |
| `GET /posts/:id/comments` · `POST /posts/:id/comments` | any user (visibility-scoped) | flat comments |
| `DELETE /posts/:id/comments/:commentId` | comment author or officeAdmin+ | delete comment |
| `POST /uploads/post-image` | officeAdmin+ | rich-text image upload |
| `GET /feed` | any user | merged internal+RSS feed, cursor-paginated |
| `POST /feed/:id/pin` · `DELETE /feed/:id/pin` | broker | pin internal item ≤7 days |

---

### Task 1: Branch & dependencies

**Files:**
- Modify: `server/package.json`, `client/package.json` (via `npm install`)

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/stage-2-communications
```

- [ ] **Step 2: Install server dependencies**

```bash
npm -w server install agenda@^5.0.0 rss-parser@^3.13.0 sanitize-html@^2.14.0
npm -w server install -D @types/sanitize-html@^2.13.0
```

- [ ] **Step 3: Install client dependencies**

```bash
npm -w client install @tiptap/react@^2.11.0 @tiptap/pm@^2.11.0 @tiptap/starter-kit@^2.11.0 @tiptap/extension-link@^2.11.0 @tiptap/extension-image@^2.11.0
npm -w client install -D @testing-library/user-event@^14.5.2
```

- [ ] **Step 4: Verify workspace still healthy**

Run: `npm run lint && npm run test`
Expected: lint exits 0; all existing tests pass (42 server + 15 client).

- [ ] **Step 5: Commit**

```bash
git add package-lock.json server/package.json client/package.json
git commit -m "chore: stage 2 dependencies (agenda, rss-parser, sanitize-html, tiptap)"
```

---

### Task 2: Notification model + notification service

**Files:**
- Create: `server/src/models/Notification.ts`
- Create: `server/src/services/notificationService.ts`
- Test: `server/tests/notifications.test.ts`

The service is the single fan-out point every trigger (this stage and Stage 3+) calls: it always writes in-app notifications, and sends email per the user's `emailPrefs` map (key = notification type, absent = **true**, i.e. opt-out). `nonDisableable` exists now because Stage 3's overdue-task email must ignore prefs (PRD 5.9.3).

- [ ] **Step 1: Write the failing tests**

Create `server/tests/notifications.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
// Spread the original module — Task 3 appends route tests to this file whose import
// graph (createApp → authService/invitationService) needs the other email exports.
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { notify } from '../src/services/notificationService.js';

async function makeUser(email: string, emailPrefs: Record<string, boolean> = {}) {
  return User.create({ email, hashedPassword: 'x', role: 'agent', displayName: email, emailPrefs });
}

describe('notificationService.notify', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('creates an in-app notification per recipient', async () => {
    const a = await makeUser('a@x.com');
    const b = await makeUser('b@x.com');
    await notify([a.id, b.id], { type: 'invitationAccepted', title: 'Someone joined', link: '/admin/users' });
    const docs = await Notification.find().sort({ userId: 1 });
    expect(docs).toHaveLength(2);
    expect(docs[0].title).toBe('Someone joined');
    expect(docs[0].readAt).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled(); // no email payload given
  });

  it('sends email when no pref is set (default true)', async () => {
    const a = await makeUser('a@x.com');
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: '<p>h</p>' });
    expect(sendEmailMock).toHaveBeenCalledWith('a@x.com', 's', '<p>h</p>');
  });

  it('honors an explicit opt-out pref', async () => {
    const a = await makeUser('a@x.com', { invitationAccepted: false });
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await Notification.countDocuments()).toBe(1); // in-app always created
  });

  it('nonDisableable overrides the opt-out pref', async () => {
    const a = await makeUser('a@x.com', { invitationAccepted: false });
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h', nonDisableable: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('skips email to deactivated users and survives a send failure', async () => {
    const a = await makeUser('a@x.com');
    const b = await makeUser('b@x.com');
    b.status = 'deactivated';
    await b.save();
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      notify([a.id, b.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h' }),
    ).resolves.toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // only the active user, failure swallowed
  });

  it('is a no-op for an empty recipient list', async () => {
    await notify([], { type: 'invitationAccepted', title: 't' });
    expect(await Notification.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/notifications.test.ts`
Expected: FAIL — cannot resolve `../src/models/Notification.js`.

- [ ] **Step 3: Write `server/src/models/Notification.ts`**

```ts
import mongoose from 'mongoose';

// Stage 3+ appends task/calendar types (taskAssigned, taskDueSoon, taskOverdue,
// mandatoryEvent, bookmarkedResource) — extend this enum, never hardcode strings.
export const NOTIFICATION_TYPES = ['invitationAccepted', 'postPublished'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
export type NotificationDoc = InstanceType<typeof Notification>;

export function toPublicNotification(n: NotificationDoc) {
  return {
    id: n.id as string,
    type: n.type,
    title: n.title,
    link: n.link,
    readAt: n.readAt,
    createdAt: n.get('createdAt') as Date,
  };
}
```

- [ ] **Step 4: Write `server/src/services/notificationService.ts`**

```ts
import { logger } from '../config/logger.js';
import { Notification, type NotificationType } from '../models/Notification.js';
import { User } from '../models/User.js';
import { sendEmail } from './emailService.js';

export interface NotifyEmail {
  subject: string;
  html: string;
  /** PRD 5.9.3 — e.g. task-overdue emails ignore user prefs (Stage 3). */
  nonDisableable?: boolean;
}

export async function notify(
  userIds: string[],
  input: { type: NotificationType; title: string; link?: string },
  email?: NotifyEmail,
): Promise<void> {
  if (userIds.length === 0) return;
  await Notification.insertMany(
    userIds.map((userId) => ({ userId, type: input.type, title: input.title, link: input.link ?? '' })),
  );
  if (!email) return;
  const users = await User.find({ _id: { $in: userIds }, status: 'active' });
  for (const u of users) {
    const wantsEmail = (u.emailPrefs as Map<string, boolean>).get(input.type) ?? true;
    if (!email.nonDisableable && !wantsEmail) continue;
    try {
      await sendEmail(u.email, email.subject, email.html);
    } catch (err) {
      // A dead email provider must never fail the triggering action (post publish, registration).
      logger.error(err, 'notification email failed');
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w server run test -- tests/notifications.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/models/Notification.ts server/src/services/notificationService.ts server/tests/notifications.test.ts
git commit -m "feat(server): notification model and fan-out service with email prefs"
```

---

### Task 3: Notification routes

**Files:**
- Create: `server/src/routes/notifications.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/tests/notifications.test.ts` (append a new describe block)

- [ ] **Step 1: Append failing route tests**

Append to `server/tests/notifications.test.ts` (add these imports at the top of the file: `import request from 'supertest';` and `import { createApp } from '../src/app.js';` and `import { hashPassword } from '../src/utils/password.js';`):

```ts
async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role: 'agent', displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('notification routes', () => {
  it('lists own notifications newest-first with unread count and cursor', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n1@x.com');
    const me = (await User.findOne({ email: 'n1@x.com' }))!;
    const other = await User.create({ email: 'o@x.com', hashedPassword: 'x', role: 'agent', displayName: 'o' });
    // Explicit distinct createdAt values — a same-millisecond tie would make the
    // $lt cursor skip rows and flake. Mongoose keeps a caller-provided createdAt.
    for (let i = 0; i < 25; i++) {
      await Notification.create({
        userId: me.id,
        type: 'invitationAccepted',
        title: `n${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      } as never);
    }
    await Notification.create({ userId: other.id, type: 'invitationAccepted', title: 'not mine' });

    const res = await agent.get('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(20);
    expect(res.body.notifications[0].title).toBe('n0'); // newest first
    expect(res.body.unreadCount).toBe(25); // scoped to me — the other user's row is excluded
    expect(res.body.nextCursor).toBeTruthy();

    const page2 = await agent.get(`/api/v1/notifications?before=${encodeURIComponent(res.body.nextCursor)}`);
    expect(page2.body.notifications).toHaveLength(5);
    expect(page2.body.notifications.map((n: { title: string }) => n.title)).not.toContain('not mine');
  });

  it('marks one read, then all read; cannot mark another user’s notification', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n2@x.com');
    const me = (await User.findOne({ email: 'n2@x.com' }))!;
    const other = await User.create({ email: 'o2@x.com', hashedPassword: 'x', role: 'agent', displayName: 'o' });
    const mine = await Notification.create({ userId: me.id, type: 'invitationAccepted', title: 'a' });
    await Notification.create({ userId: me.id, type: 'invitationAccepted', title: 'b' });
    const theirs = await Notification.create({ userId: other.id, type: 'invitationAccepted', title: 'c' });

    expect((await agent.post(`/api/v1/notifications/${mine.id}/read`)).status).toBe(200);
    expect((await Notification.findById(mine.id))!.readAt).not.toBeNull();

    expect((await agent.post(`/api/v1/notifications/${theirs.id}/read`)).status).toBe(404);
    expect((await Notification.findById(theirs.id))!.readAt).toBeNull();

    expect((await agent.post('/api/v1/notifications/read-all')).status).toBe(200);
    expect(await Notification.countDocuments({ userId: me.id, readAt: null })).toBe(0);
    expect((await Notification.findById(theirs.id))!.readAt).toBeNull();
  });

  it('requires auth', async () => {
    const app = createApp();
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npm -w server run test -- tests/notifications.test.ts`
Expected: FAIL — 404s from the unmounted router (service tests still pass).

- [ ] **Step 3: Write `server/src/routes/notifications.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { Notification, toPublicNotification } from '../models/Notification.js';

const PAGE_SIZE = 20;

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const filter: Record<string, unknown> = { userId };
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(PAGE_SIZE),
      Notification.countDocuments({ userId, readAt: null }),
    ]);
    res.json({
      notifications: notifications.map(toPublicNotification),
      unreadCount,
      nextCursor:
        notifications.length === PAGE_SIZE
          ? (notifications[notifications.length - 1].get('createdAt') as Date).toISOString()
          : null,
    });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) throw new AppError(404, 'Notification not found');
    res.json({ notification: toPublicNotification(n) });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user!.id, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 4: Mount in `server/src/app.ts`**

Add the import alongside the other routers:

```ts
import { notificationsRouter } from './routes/notifications.js';
```

And mount it after the settings routers (line ~70):

```ts
app.use('/api/v1/notifications', notificationsRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w server run test -- tests/notifications.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/notifications.ts server/src/app.ts server/tests/notifications.test.ts
git commit -m "feat(server): notification list/read/read-all endpoints"
```

---

### Task 4: ActivityEvent model + activity service

**Files:**
- Create: `server/src/models/ActivityEvent.ts`
- Create: `server/src/services/activityService.ts`
- Test: `server/tests/activity.test.ts`

Internal feed events (PRD 5.2). Each event stores a pre-rendered human-readable `message` plus a client route `link`. `officeId` scopes office-targeted announcements; `pinnedUntil` implements broker pin-to-top (≤7 days). Retention (90 days) is a Stage 5 job — no TTL index now.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { emitActivity } from '../src/services/activityService.js';

describe('activityService.emitActivity', () => {
  it('creates an event with defaults', async () => {
    await emitActivity({ type: 'agentJoined', message: 'Ana joined Acme Realty', link: '/profile/abc' });
    const e = (await ActivityEvent.findOne())!;
    expect(e.type).toBe('agentJoined');
    expect(e.message).toBe('Ana joined Acme Realty');
    expect(e.link).toBe('/profile/abc');
    expect(e.officeId).toBeNull();
    expect(e.pinnedUntil).toBeNull();
  });

  it('rejects unknown types', async () => {
    await expect(
      emitActivity({ type: 'bogus' as never, message: 'x' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/activity.test.ts`
Expected: FAIL — cannot resolve `../src/models/ActivityEvent.js`.

- [ ] **Step 3: Write `server/src/models/ActivityEvent.ts`**

```ts
import mongoose from 'mongoose';

// Stage 3 appends taskAssigned/taskCompleted/eventCreated; Stage 4 appends resourceUploaded.
export const ACTIVITY_TYPES = ['agentJoined', 'announcementPosted'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const activityEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '' },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pinnedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
activityEventSchema.index({ createdAt: -1 });
activityEventSchema.index({ pinnedUntil: 1 });

export const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);
export type ActivityEventDoc = InstanceType<typeof ActivityEvent>;
```

- [ ] **Step 4: Write `server/src/services/activityService.ts`**

```ts
import { ActivityEvent, type ActivityType } from '../models/ActivityEvent.js';

export async function emitActivity(input: {
  type: ActivityType;
  message: string;
  link?: string;
  officeId?: string | null;
  actorId?: string | null;
}): Promise<void> {
  await ActivityEvent.create({
    type: input.type,
    message: input.message,
    link: input.link ?? '',
    officeId: input.officeId ?? null,
    actorId: input.actorId ?? null,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w server run test -- tests/activity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/models/ActivityEvent.ts server/src/services/activityService.ts server/tests/activity.test.ts
git commit -m "feat(server): activity event model and emit service"
```

---

### Task 5: "Invitation accepted" trigger + agent-joined activity

**Files:**
- Modify: `server/src/services/emailService.ts` (add template)
- Modify: `server/src/services/authService.ts:56-61` (replace the Stage-2 wiring comment)
- Test: `server/tests/auth.test.ts` (append one test)

This closes the Stage 1 deferred trigger (roadmap: "invitation accepted notifies the inviting admin") and emits the first feed event.

- [ ] **Step 1: Append a failing test**

Append to `server/tests/auth.test.ts` — add these imports at the top (some may already exist in the file; don't duplicate): `import { createHash } from 'node:crypto';`, `import { ActivityEvent } from '../src/models/ActivityEvent.js';`, `import { Invitation } from '../src/models/Invitation.js';`, `import { Notification } from '../src/models/Notification.js';`. The test is self-contained — it mints an invitation the same way `invitationService` does (token stored as its SHA-256 hash):

```ts
it('registration notifies the inviting admin and emits an agentJoined event', async () => {
  const app = createApp();
  const admin = await User.create({
    email: 'inviter@x.com',
    hashedPassword: await hashPassword('Password1!'),
    role: 'broker',
    displayName: 'Inviter',
  });
  const token = 'stage2-test-token';
  await Invitation.create({
    email: 'newagent@x.com',
    role: 'agent',
    invitedBy: admin.id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ token, password: 'Password1!', displayName: 'New Agent' });
  expect(res.status).toBe(201);

  const notifications = await Notification.find({ userId: admin.id });
  expect(notifications).toHaveLength(1);
  expect(notifications[0].type).toBe('invitationAccepted');
  expect(notifications[0].title).toContain('New Agent');
  const events = await ActivityEvent.find({ type: 'agentJoined' });
  expect(events).toHaveLength(1);
  expect(events[0].message).toContain('New Agent');
});
```

(`request`, `createApp`, `User`, and `hashPassword` are already imported by the existing tests in this file.)

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npm -w server run test -- tests/auth.test.ts`
Expected: FAIL — 0 notifications / 0 events found.

- [ ] **Step 3: Add the email template to `server/src/services/emailService.ts`**

Append after `invitationEmail`:

```ts
export function invitationAcceptedEmail(displayName: string, profileLink: string): { subject: string; html: string } {
  const safeName = escapeHtml(displayName);
  return {
    subject: `${safeName} accepted your invitation`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p><strong>${safeName}</strong> accepted your invitation and joined the workspace.</p>
      <p><a href="${profileLink}">View their profile</a></p>
    </div>`,
  };
}
```

- [ ] **Step 4: Wire the trigger in `server/src/services/authService.ts`**

Add imports:

```ts
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getSettings } from '../models/Settings.js';
import { emitActivity } from './activityService.js';
import { invitationAcceptedEmail } from './emailService.js';
import { notify } from './notificationService.js';
```

Replace the two wiring comment lines in `register` (keep the Stage 3 comment):

```ts
  // Side effects must never fail a registration that already created the account.
  try {
    const settings = await getSettings();
    await emitActivity({
      type: 'agentJoined',
      message: `${user.displayName} joined ${settings.brandName}`,
      link: `/profile/${user.id}`,
      actorId: user.id,
    });
    await notify(
      [String(invitation.invitedBy)],
      { type: 'invitationAccepted', title: `${user.displayName} accepted your invitation`, link: `/profile/${user.id}` },
      invitationAcceptedEmail(user.displayName, `${env.APP_DOMAIN}/profile/${user.id}`),
    );
  } catch (err) {
    logger.error(err, 'post-registration side effects failed');
  }
  // Stage 3 wiring: auto-assign Settings.onboardingTaskTemplateId once Tasks exist.
```

- [ ] **Step 5: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — including all pre-existing auth tests (registration behavior itself is unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/emailService.ts server/src/services/authService.ts server/tests/auth.test.ts
git commit -m "feat(server): invitation-accepted notification and agent-joined activity on registration"
```

---

### Task 6: HTML sanitizer utility

**Files:**
- Create: `server/src/utils/sanitizeHtml.ts`
- Test: `server/tests/sanitizeHtml.test.ts`

Server-side defense for TipTap output (spec §3: "sanitized server-side"). Stage 1's review caught a stored-XSS vector in uploads — this utility is the equivalent gate for rich text. `htmlToText` feeds the `bodyText` field used for keyword search and excerpts.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/sanitizeHtml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizePostHtml } from '../src/utils/sanitizeHtml.js';

describe('sanitizePostHtml', () => {
  it('keeps the TipTap formatting set', () => {
    const html =
      '<h2>T</h2><p><strong>b</strong> <em>i</em></p><ul><li>a</li></ul><ol><li>1</li></ol><blockquote><p>q</p></blockquote>';
    expect(sanitizePostHtml(html)).toBe(html);
  });

  it('strips script tags, event handlers, and style attributes', () => {
    expect(sanitizePostHtml('<p onclick="x()">a</p><script>evil()</script>')).toBe('<p>a</p>');
    expect(sanitizePostHtml('<p style="position:fixed">a</p>')).toBe('<p>a</p>');
  });

  it('blocks javascript: and protocol-relative URLs, keeps https and relative', () => {
    expect(sanitizePostHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(sanitizePostHtml('<img src="//evil.com/x.png" />')).toBe('<img />');
    expect(sanitizePostHtml('<img src="/files/posts/a.png" alt="a" />')).toBe('<img src="/files/posts/a.png" alt="a" />');
    expect(sanitizePostHtml('<a href="https://ok.com">x</a>')).toBe(
      '<a href="https://ok.com" rel="noopener noreferrer" target="_blank">x</a>',
    );
  });

  it('forces rel/target on links', () => {
    expect(sanitizePostHtml('<a href="https://a.com" target="_top" rel="opener">x</a>')).toBe(
      '<a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a>',
    );
  });
});

describe('htmlToText', () => {
  it('flattens markup to searchable text', () => {
    expect(htmlToText('<h2>Hello</h2><p><strong>world</strong> &amp; friends</p>')).toBe('Hello world &amp; friends');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/sanitizeHtml.test.ts`
Expected: FAIL — cannot resolve `../src/utils/sanitizeHtml.js`.

- [ ] **Step 3: Write `server/src/utils/sanitizeHtml.ts`**

```ts
import sanitize from 'sanitize-html';

// Mirrors exactly what the client TipTap editor can produce (StarterKit + Link + Image).
const OPTIONS: sanitize.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'img'],
  allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizePostHtml(html: string): string {
  return sanitize(html, OPTIONS);
}

export function htmlToText(html: string): string {
  return sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w server run test -- tests/sanitizeHtml.test.ts`
Expected: PASS (6 tests). If an assertion fails only on entity encoding or attribute order, adjust the test's expected string to sanitize-html's actual output — the security assertions (no script/onclick/javascript:/protocol-relative) must hold as written.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/sanitizeHtml.ts server/tests/sanitizeHtml.test.ts
git commit -m "feat(server): rich-text sanitizer for post bodies"
```

---

### Task 7: Post + Comment models

**Files:**
- Create: `server/src/models/Post.ts`
- Create: `server/src/models/Comment.ts`
- Test: `server/tests/posts.test.ts` (started here, extended by Tasks 8–10)

`bodyHtml` is the sanitized render source; `bodyText` is the plain-text shadow powering the `$text` index and excerpts. `pinnedAt` doubles as pin flag + pin order. `notifiedAt` is the idempotency latch for publish side effects.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/posts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Comment } from '../src/models/Comment.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

describe('Post model', () => {
  it('applies defaults', async () => {
    const u = await User.create({ email: 'a@x.com', hashedPassword: 'x', role: 'broker', displayName: 'a' });
    const p = await Post.create({ title: 'Hello', authorId: u.id });
    expect(p.officeId).toBeNull();
    expect(p.important).toBe(false);
    expect(p.commentsEnabled).toBe(true);
    expect(p.pinnedAt).toBeNull();
    expect(p.notifiedAt).toBeNull();
    expect(p.publishAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('supports keyword text search over title and bodyText', async () => {
    const u = await User.create({ email: 'b@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b' });
    await Post.create({ title: 'Commission update', bodyText: 'new split schedule', authorId: u.id });
    await Post.create({ title: 'Holiday party', bodyText: 'rooftop venue', authorId: u.id });
    await Post.init(); // ensure the text index exists before querying it
    const hits = await Post.find({ $text: { $search: 'rooftop' } });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Holiday party');
  });
});

describe('Comment model', () => {
  it('stores a flat comment against a post', async () => {
    const u = await User.create({ email: 'c@x.com', hashedPassword: 'x', role: 'agent', displayName: 'c' });
    const p = await Post.create({ title: 'T', authorId: u.id });
    const c = await Comment.create({ postId: p.id, authorId: u.id, body: 'Nice!' });
    expect(c.body).toBe('Nice!');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: FAIL — cannot resolve `../src/models/Post.js`.

- [ ] **Step 3: Write `server/src/models/Post.ts`**

```ts
import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    bodyHtml: { type: String, default: '' },
    // Plain-text shadow of bodyHtml — powers $text search and list excerpts.
    bodyText: { type: String, default: '' },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    important: { type: Boolean, default: false },
    commentsEnabled: { type: Boolean, default: true },
    pinnedAt: { type: Date, default: null },
    publishAt: { type: Date, default: () => new Date() },
    // Set exactly once when publish side effects (feed event + notifications) have run.
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
postSchema.index({ title: 'text', bodyText: 'text' });
postSchema.index({ pinnedAt: -1, publishAt: -1 });

export const Post = mongoose.model('Post', postSchema);
export type PostDoc = InstanceType<typeof Post>;

type PopulatedAuthor = { _id: mongoose.Types.ObjectId; displayName: string; photoUrl: string } | null;

/** Callers must .populate('authorId', 'displayName photoUrl') first. */
export function toPublicPost(p: PostDoc) {
  const a = p.authorId as unknown as PopulatedAuthor;
  return {
    id: p.id as string,
    title: p.title,
    bodyHtml: p.bodyHtml,
    excerpt: p.bodyText.slice(0, 200),
    author: a ? { id: String(a._id), displayName: a.displayName, photoUrl: a.photoUrl } : null,
    officeId: p.officeId,
    important: p.important,
    commentsEnabled: p.commentsEnabled,
    pinnedAt: p.pinnedAt,
    publishAt: p.publishAt,
    createdAt: p.get('createdAt') as Date,
  };
}
```

- [ ] **Step 4: Write `server/src/models/Comment.ts`**

```ts
import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

export const Comment = mongoose.model('Comment', commentSchema);
export type CommentDoc = InstanceType<typeof Comment>;

type PopulatedAuthor = { _id: mongoose.Types.ObjectId; displayName: string; photoUrl: string } | null;

/** Callers must .populate('authorId', 'displayName photoUrl') first. */
export function toPublicComment(c: CommentDoc) {
  const a = c.authorId as unknown as PopulatedAuthor;
  return {
    id: c.id as string,
    body: c.body,
    author: a ? { id: String(a._id), displayName: a.displayName, photoUrl: a.photoUrl } : null,
    createdAt: c.get('createdAt') as Date,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/models/Post.ts server/src/models/Comment.ts server/tests/posts.test.ts
git commit -m "feat(server): post and comment models with text search"
```

---

### Task 8: Post service (create/update, publish side effects, pinning)

**Files:**
- Create: `server/src/services/postService.ts`
- Test: `server/tests/posts.test.ts` (append)

Design notes the implementer needs:
- **`publishPostSideEffects` is the single announcement point** — called inline for immediate posts and by the Agenda job (Task 11) for scheduled ones. It claims the `notifiedAt` latch atomically with `findOneAndUpdate`, so double invocation (job retry, reschedule races) emits exactly once.
- **Recipients** of the in-app `postPublished` notification: all active intranet users except the author; office-targeted posts also notify all admins (a broker with no `officeId` must still see office posts announced). Email goes out only for `important` posts, honoring prefs.
- **Scheduling** calls `schedulePostPublish` (Task 11). Until Task 11 exists, this task creates a placeholder module so the service compiles — the placeholder no-ops exactly like the real function does when Agenda isn't running (tests, and any pre-boot call).

- [ ] **Step 1: Write the placeholder scheduler `server/src/config/agenda.ts`**

Task 11 replaces the bodies with real Agenda wiring; the signatures are final now:

```ts
/** Replaced with real Agenda wiring in the jobs task. When Agenda is not running
 * (tests, or before boot completes) these are safe no-ops: immediate posts publish
 * inline, and scheduled posts are caught up on next boot. */
export async function schedulePostPublish(_postId: string, _when: Date): Promise<void> {}

export async function cancelPostPublish(_postId: string): Promise<void> {}
```

- [ ] **Step 2: Append failing service tests**

Append to `server/tests/posts.test.ts` — add imports at the top:

```ts
import { vi } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { Notification } from '../src/models/Notification.js';
```

Mock email above the other imports (hoisted):

```ts
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createPost, publishPostSideEffects, setPinned, updatePost } from '../src/services/postService.js';
```

Then the tests:

```ts
async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('postService', () => {
  beforeEach(() => sendEmailMock.mockClear()); // add beforeEach to the vitest import

  it('createPost sanitizes html, derives bodyText, and announces immediately', async () => {
    const broker = await makeUser('br@x.com', 'broker');
    const agent = await makeUser('ag@x.com', 'agent');
    const post = await createPost(
      { title: 'Welcome', bodyHtml: '<p>Hi <script>x()</script><strong>all</strong></p>' },
      broker,
    );
    expect(post.bodyHtml).toBe('<p>Hi <strong>all</strong></p>');
    expect(post.bodyText).toBe('Hi all');
    expect(post.notifiedAt).not.toBeNull();
    expect(await ActivityEvent.countDocuments({ type: 'announcementPosted' })).toBe(1);
    // author excluded, agent notified
    expect(await Notification.countDocuments({ userId: agent.id, type: 'postPublished' })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled(); // not important → no email
  });

  it('important posts email recipients per prefs', async () => {
    const broker = await makeUser('br2@x.com', 'broker');
    await makeUser('ag2@x.com', 'agent');
    const optedOut = await makeUser('ag3@x.com', 'agent');
    optedOut.emailPrefs = new Map([['postPublished', false]]) as never;
    await optedOut.save();
    await createPost({ title: 'Urgent', bodyHtml: '<p>x</p>', important: true }, broker);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('ag2@x.com');
  });

  it('office-targeted posts notify that office plus admins only', async () => {
    const broker = await makeUser('br3@x.com', 'broker'); // officeId null — must still be notified
    const author = await makeUser('oa@x.com', 'officeAdmin');
    const officeA = '64b000000000000000000001';
    const inOffice = await makeUser('in@x.com', 'agent', officeA);
    const outOffice = await makeUser('out@x.com', 'agent', '64b000000000000000000002');
    await createPost({ title: 'Office A only', bodyHtml: '', officeId: officeA }, author);
    expect(await Notification.countDocuments({ userId: inOffice.id })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(1);
    expect(await Notification.countDocuments({ userId: outOffice.id })).toBe(0);
  });

  it('scheduled posts do not announce at creation; side effects run once when due', async () => {
    const broker = await makeUser('br4@x.com', 'broker');
    await makeUser('ag4@x.com', 'agent');
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await createPost({ title: 'Later', bodyHtml: '', publishAt: future.toISOString() }, broker);
    expect(post.notifiedAt).toBeNull();
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0);

    await publishPostSideEffects(post.id); // fires "early" — publishAt guard blocks it
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0);

    await Post.updateOne({ _id: post.id }, { $set: { publishAt: new Date(Date.now() - 1000) } });
    await publishPostSideEffects(post.id);
    await publishPostSideEffects(post.id); // idempotent — second call is a no-op
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(1);
    expect(await ActivityEvent.countDocuments({ type: 'announcementPosted' })).toBe(1);
  });

  it('updatePost re-sanitizes and cannot reschedule an already-announced post', async () => {
    const broker = await makeUser('br5@x.com', 'broker');
    const post = await createPost({ title: 'T', bodyHtml: '<p>a</p>' }, broker);
    const updated = await updatePost(post.id, {
      bodyHtml: '<p onclick="x()">b</p>',
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(updated.bodyHtml).toBe('<p>b</p>');
    expect(updated.notifiedAt).not.toBeNull(); // still announced
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0); // no re-announcement (broker was sole user)
  });

  it('setPinned enforces the max of 3', async () => {
    const broker = await makeUser('br6@x.com', 'broker');
    const posts = [];
    for (let i = 0; i < 4; i++) posts.push(await createPost({ title: `P${i}`, bodyHtml: '' }, broker));
    for (let i = 0; i < 3; i++) await setPinned(posts[i].id, true);
    await expect(setPinned(posts[3].id, true)).rejects.toThrow(/3 pinned/);
    await setPinned(posts[0].id, false);
    await expect(setPinned(posts[3].id, true)).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify the new block fails**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: FAIL — cannot resolve `../src/services/postService.js`.

- [ ] **Step 4: Write `server/src/services/postService.ts`**

```ts
import { cancelPostPublish, schedulePostPublish } from '../config/agenda.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { Comment } from '../models/Comment.js';
import { Post, type PostDoc } from '../models/Post.js';
import { User, type UserDoc } from '../models/User.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { importantPostEmail } from './emailService.js';
import { notify } from './notificationService.js';

const MAX_PINNED = 3;

export interface PostInput {
  title?: string;
  bodyHtml?: string;
  officeId?: string | null;
  important?: boolean;
  commentsEnabled?: boolean;
  publishAt?: string;
}

export async function createPost(input: PostInput, author: UserDoc): Promise<PostDoc> {
  const post = await Post.create({
    title: input.title,
    bodyHtml: sanitizePostHtml(input.bodyHtml ?? ''),
    bodyText: htmlToText(input.bodyHtml ?? ''),
    authorId: author.id,
    officeId: input.officeId ?? null,
    important: input.important ?? false,
    commentsEnabled: input.commentsEnabled ?? true,
    publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
  });
  await announceOrSchedule(post);
  return post;
}

export async function updatePost(id: string, input: PostInput): Promise<PostDoc> {
  const post = await Post.findById(id);
  if (!post) throw new AppError(404, 'Post not found');
  if (input.title !== undefined) post.title = input.title;
  if (input.bodyHtml !== undefined) {
    post.bodyHtml = sanitizePostHtml(input.bodyHtml);
    post.bodyText = htmlToText(input.bodyHtml);
  }
  if (input.officeId !== undefined) post.officeId = (input.officeId ?? null) as never;
  if (input.important !== undefined) post.important = input.important;
  if (input.commentsEnabled !== undefined) post.commentsEnabled = input.commentsEnabled;
  // Rescheduling only makes sense before the post was announced.
  if (input.publishAt !== undefined && !post.notifiedAt) post.publishAt = new Date(input.publishAt);
  await post.save();
  if (!post.notifiedAt) await announceOrSchedule(post);
  return post;
}

export async function deletePost(id: string): Promise<void> {
  const post = await Post.findByIdAndDelete(id);
  if (!post) throw new AppError(404, 'Post not found');
  await Comment.deleteMany({ postId: id });
  await cancelPostPublish(id);
}

export async function setPinned(id: string, pinned: boolean): Promise<PostDoc> {
  const post = await Post.findById(id);
  if (!post) throw new AppError(404, 'Post not found');
  if (pinned && !post.pinnedAt) {
    const pinnedCount = await Post.countDocuments({ pinnedAt: { $ne: null } });
    if (pinnedCount >= MAX_PINNED) throw new AppError(400, 'Maximum of 3 pinned posts — unpin one first');
    post.pinnedAt = new Date();
  }
  if (!pinned) post.pinnedAt = null;
  await post.save();
  return post;
}

async function announceOrSchedule(post: PostDoc): Promise<void> {
  if (post.publishAt <= new Date()) await publishPostSideEffects(post.id);
  else await schedulePostPublish(post.id, post.publishAt);
}

/** Idempotent: the notifiedAt latch is claimed atomically, so job retries,
 * reschedule races, and double calls announce exactly once. */
export async function publishPostSideEffects(postId: string): Promise<void> {
  const post = await Post.findOneAndUpdate(
    { _id: postId, notifiedAt: null, publishAt: { $lte: new Date() } },
    { $set: { notifiedAt: new Date() } },
  );
  if (!post) return; // already announced, deleted, or not yet due
  await emitActivity({
    type: 'announcementPosted',
    message: `New announcement: ${post.title}`,
    link: `/board/${post.id}`,
    officeId: post.officeId ? String(post.officeId) : null,
    actorId: String(post.authorId),
  });
  const recipients = await User.find({
    status: 'active',
    role: { $in: ['broker', 'officeAdmin', 'agent'] },
    _id: { $ne: post.authorId },
    ...(post.officeId
      ? { $or: [{ officeId: post.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
      : {}),
  }).select('_id');
  await notify(
    recipients.map((r) => String(r._id)),
    { type: 'postPublished', title: `New announcement: ${post.title}`, link: `/board/${post.id}` },
    post.important ? importantPostEmail(post.title, `${env.APP_DOMAIN}/board/${post.id}`) : undefined,
  );
}
```

- [ ] **Step 5: Add `importantPostEmail` to `server/src/services/emailService.ts`**

Append:

```ts
export function importantPostEmail(title: string, link: string): { subject: string; html: string } {
  const safeTitle = escapeHtml(title);
  return {
    subject: `Important announcement: ${safeTitle}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <p>An important announcement was posted to your workspace:</p>
      <p><strong>${safeTitle}</strong></p>
      <p><a href="${link}">Read it on the message board</a></p>
    </div>`,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/postService.ts server/src/services/emailService.ts server/src/config/agenda.ts server/tests/posts.test.ts
git commit -m "feat(server): post service with idempotent publish fan-out and pin limit"
```

---

### Task 9: Posts routes + post-image upload

**Files:**
- Create: `server/src/validators/posts.ts`
- Create: `server/src/routes/posts.ts`
- Modify: `server/src/routes/uploads.ts` (add `/post-image`)
- Modify: `server/src/app.ts` (mount router)
- Test: `server/tests/posts.test.ts` (append)

Visibility rule (used by list, detail, and comments): **agents** see posts that are published (`publishAt <= now`) AND targeted at everyone or their office; **officeAdmin/broker** see everything, including scheduled drafts.

- [ ] **Step 1: Append failing route tests**

Append to `server/tests/posts.test.ts` — add imports `import request from 'supertest';`, `import { createApp } from '../src/app.js';`, `import { hashPassword } from '../src/utils/password.js';`:

```ts
async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('post routes', () => {
  it('officeAdmin creates a post; agent cannot', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pa@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'pb@x.com', 'agent');
    expect((await agent.post('/api/v1/posts').send({ title: 'No', bodyHtml: '' })).status).toBe(403);
    const res = await admin.post('/api/v1/posts').send({ title: 'Yes', bodyHtml: '<p>hi</p>' });
    expect(res.status).toBe(201);
    expect(res.body.post.author.displayName).toBe('pa@x.com');
    expect(res.body.post.bodyHtml).toBe('<p>hi</p>');
  });

  it('agents see published all/own-office posts only; admins see scheduled too', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pc@x.com', 'broker');
    const officeA = '64b000000000000000000001';
    const agent = await loginAs(app, 'pd@x.com', 'agent', officeA);
    await admin.post('/api/v1/posts').send({ title: 'For everyone', bodyHtml: '' });
    await admin.post('/api/v1/posts').send({ title: 'For office A', bodyHtml: '', officeId: officeA });
    await admin.post('/api/v1/posts').send({ title: 'For office B', bodyHtml: '', officeId: '64b000000000000000000002' });
    await admin.post('/api/v1/posts').send({
      title: 'Scheduled',
      bodyHtml: '',
      publishAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const agentList = await agent.get('/api/v1/posts');
    expect(agentList.body.posts.map((p: { title: string }) => p.title).sort()).toEqual(['For everyone', 'For office A']);
    const adminList = await admin.get('/api/v1/posts');
    expect(adminList.body.total).toBe(4);

    const officeB = adminList.body.posts.find((p: { title: string }) => p.title === 'For office B');
    expect((await agent.get(`/api/v1/posts/${officeB.id}`)).status).toBe(404);
    expect((await admin.get(`/api/v1/posts/${officeB.id}`)).status).toBe(200);
  });

  it('keyword search matches body text', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pe@x.com', 'broker');
    await admin.post('/api/v1/posts').send({ title: 'A', bodyHtml: '<p>quarterly commission schedule</p>' });
    await admin.post('/api/v1/posts').send({ title: 'B', bodyHtml: '<p>parking reminder</p>' });
    const res = await admin.get('/api/v1/posts?q=commission');
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].title).toBe('A');
  });

  it('pins via route with the max-3 limit surfaced as 400', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pf@x.com', 'broker');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await admin.post('/api/v1/posts').send({ title: `P${i}`, bodyHtml: '' });
      ids.push(r.body.post.id);
    }
    for (let i = 0; i < 3; i++) expect((await admin.post(`/api/v1/posts/${ids[i]}/pin`)).status).toBe(200);
    expect((await admin.post(`/api/v1/posts/${ids[3]}/pin`)).status).toBe(400);
    expect((await admin.delete(`/api/v1/posts/${ids[0]}/pin`)).status).toBe(200);
    expect((await admin.post(`/api/v1/posts/${ids[3]}/pin`)).status).toBe(200);
    // pinned posts sort first
    const list = await admin.get('/api/v1/posts');
    expect(list.body.posts[0].pinnedAt).not.toBeNull();
  });

  it('deleting a post removes its comments', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pg@x.com', 'broker');
    const r = await admin.post('/api/v1/posts').send({ title: 'Del', bodyHtml: '' });
    await admin.post(`/api/v1/posts/${r.body.post.id}/comments`).send({ body: 'hi' });
    expect((await admin.delete(`/api/v1/posts/${r.body.post.id}`)).status).toBe(200);
    expect(await Comment.countDocuments()).toBe(0);
    expect((await admin.get(`/api/v1/posts/${r.body.post.id}`)).status).toBe(404);
  });

  it('rejects invalid bodies', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'ph@x.com', 'broker');
    expect((await admin.post('/api/v1/posts').send({ bodyHtml: '' })).status).toBe(400); // no title
    expect((await admin.post('/api/v1/posts').send({ title: 'x', bodyHtml: '', publishAt: 'tomorrow' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: FAIL — 404s from the unmounted router.

- [ ] **Step 3: Write `server/src/validators/posts.ts`**

```ts
import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(100_000),
  officeId: z.string().nullable().optional(),
  important: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  publishAt: z.string().datetime({ offset: true }).optional(),
});

export const updatePostSchema = createPostSchema.partial();

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
```

- [ ] **Step 4: Write `server/src/routes/posts.ts`**

(The comments endpoints referenced by the delete-cascade test above are added in Task 10 — include them now if you prefer, or expect that one test to stay red until Task 10. Recommended: implement Tasks 9 and 10's route file in one sitting since they share this file, committing separately per task.)

```ts
import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Post, toPublicPost, type PostDoc } from '../models/Post.js';
import { createPost, deletePost, setPinned, updatePost } from '../services/postService.js';
import { createPostSchema, updatePostSchema } from '../validators/posts.js';

const PAGE_SIZE = 20;
const AUTHOR_FIELDS = 'displayName photoUrl';

export const postsRouter = Router();
postsRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Agents: published + (all-users or own office). Admins: everything. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  if (isAdmin(me.role)) return {};
  return {
    publishAt: { $lte: new Date() },
    $or: [{ officeId: null }, { officeId: me.officeId }],
  };
}

async function loadVisiblePost(req: Request): Promise<PostDoc> {
  const post = await Post.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!post) throw new AppError(404, 'Post not found');
  return post;
}

postsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter: Record<string, unknown> = visibilityFilter(req);
    if (q) filter.$text = { $search: q };
    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ pinnedAt: -1, publishAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate('authorId', AUTHOR_FIELDS),
      Post.countDocuments(filter),
    ]);
    res.json({ posts: posts.map(toPublicPost), total, page });
  }),
);

postsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createPostSchema),
  asyncHandler(async (req, res) => {
    const post = await createPost(req.body, req.user!);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.status(201).json({ post: toPublicPost(post) });
  }),
);

postsRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updatePostSchema),
  asyncHandler(async (req, res) => {
    const post = await updatePost(req.params.id, req.body);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    await deletePost(req.params.id);
    res.json({ ok: true });
  }),
);

postsRouter.post(
  '/:id/pin',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const post = await setPinned(req.params.id, true);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.delete(
  '/:id/pin',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const post = await setPinned(req.params.id, false);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);
```

Note the `Parameters<typeof requireAuth>[0]` type is just Express's `Request` — write `Request` from `express` instead if you prefer; import it as a type.

- [ ] **Step 5: Add the post-image upload to `server/src/routes/uploads.ts`**

Append after the `/avatar` route, following the existing pattern exactly:

```ts
uploadsRouter.post(
  '/post-image',
  requireRole('officeAdmin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('posts', file.mimetype), file.buffer, file.mimetype);
    res.json({ url });
  }),
);
```

- [ ] **Step 6: Mount in `server/src/app.ts`**

```ts
import { postsRouter } from './routes/posts.js';
```

```ts
app.use('/api/v1/posts', postsRouter);
```

- [ ] **Step 7: Run tests**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: PASS except the delete-cascade test's comment-creation call if you deferred Task 10's endpoints — in that case finish Task 10 before expecting full green, but commit Task 9's scope now if everything else passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/validators/posts.ts server/src/routes/posts.ts server/src/routes/uploads.ts server/src/app.ts server/tests/posts.test.ts
git commit -m "feat(server): message board routes, search, pinning, post-image upload"
```

---

### Task 10: Comment routes

**Files:**
- Modify: `server/src/routes/posts.ts` (append comment endpoints)
- Test: `server/tests/posts.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```ts
describe('comment routes', () => {
  it('any user comments on a visible post; author and admin can delete, others cannot', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'ca@x.com', 'broker');
    const alice = await loginAs(app, 'cb@x.com', 'agent');
    const bob = await loginAs(app, 'cc@x.com', 'agent');
    const post = (await admin.post('/api/v1/posts').send({ title: 'C', bodyHtml: '' })).body.post;

    const created = await alice.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'First!' });
    expect(created.status).toBe(201);
    expect(created.body.comment.author.displayName).toBe('cb@x.com');

    const list = await bob.get(`/api/v1/posts/${post.id}/comments`);
    expect(list.body.comments).toHaveLength(1);

    expect((await bob.delete(`/api/v1/posts/${post.id}/comments/${created.body.comment.id}`)).status).toBe(403);
    expect((await alice.delete(`/api/v1/posts/${post.id}/comments/${created.body.comment.id}`)).status).toBe(200);

    const again = await bob.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'Second' });
    expect((await admin.delete(`/api/v1/posts/${post.id}/comments/${again.body.comment.id}`)).status).toBe(200);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('rejects comments when the author disabled them', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'cd@x.com', 'broker');
    const agent = await loginAs(app, 'ce@x.com', 'agent');
    const post = (await admin.post('/api/v1/posts').send({ title: 'Quiet', bodyHtml: '', commentsEnabled: false }))
      .body.post;
    expect((await agent.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'hi' })).status).toBe(403);
  });

  it('cannot comment on a post outside visibility', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'cf@x.com', 'broker');
    const agent = await loginAs(app, 'cg@x.com', 'agent', '64b000000000000000000001');
    const post = (
      await admin.post('/api/v1/posts').send({ title: 'B only', bodyHtml: '', officeId: '64b000000000000000000002' })
    ).body.post;
    expect((await agent.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'hi' })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npm -w server run test -- tests/posts.test.ts`
Expected: FAIL — 404s on the comments endpoints.

- [ ] **Step 3: Append the endpoints to `server/src/routes/posts.ts`**

Add imports: `import { Comment, toPublicComment } from '../models/Comment.js';` and `import { createCommentSchema } from '../validators/posts.js';` (extend the existing validators import).

```ts
postsRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req);
    const comments = await Comment.find({ postId: post.id })
      .sort({ createdAt: 1 })
      .populate('authorId', AUTHOR_FIELDS);
    res.json({ comments: comments.map(toPublicComment) });
  }),
);

postsRouter.post(
  '/:id/comments',
  validate(createCommentSchema),
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req);
    if (!post.commentsEnabled) throw new AppError(403, 'Comments are disabled on this post');
    const comment = await Comment.create({ postId: post.id, authorId: req.user!.id, body: req.body.body });
    await comment.populate('authorId', AUTHOR_FIELDS);
    res.status(201).json({ comment: toPublicComment(comment) });
  }),
);

postsRouter.delete(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req);
    const comment = await Comment.findOne({ _id: req.params.commentId, postId: post.id });
    if (!comment) throw new AppError(404, 'Comment not found');
    const me = req.user!;
    if (String(comment.authorId) !== me.id && !isAdmin(me.role))
      throw new AppError(403, 'Insufficient permissions');
    await comment.deleteOne();
    res.json({ ok: true });
  }),
);
```

- [ ] **Step 4: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS — including the Task 9 delete-cascade test that needed these endpoints.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/posts.ts server/tests/posts.test.ts
git commit -m "feat(server): flat post comments with author/admin delete and per-post toggle"
```

---

### Task 11: Agenda job infrastructure + scheduled-post publishing

**Files:**
- Modify: `server/src/config/agenda.ts` (replace Task 8's placeholder with real wiring)
- Create: `server/src/jobs/index.ts`
- Modify: `server/src/index.ts` (start Agenda after DB connect; graceful stop)
- Test: `server/tests/agenda.test.ts`

Key decisions the implementer must not change:
- **Agenda gets its own Mongo connection** (`db: { address: env.MONGODB_URI } }`), NOT the mongoose connection's `Db` handle. Agenda 5 bundles mongodb v4 internally; handing it a mongoose-8/mongodb-6 `Db` hits `findOneAndUpdate` return-shape differences and breaks job claiming silently.
- **Agenda is started only from `index.ts`** — never from `createApp()` — so tests and the seed script never touch it. When it isn't running, `schedulePostPublish`/`cancelPostPublish` no-op: immediate posts publish inline, and any missed one-off jobs run on next boot (Agenda executes jobs whose `nextRunAt` is in the past — the catch-up behavior the sleeping free host needs, spec §3).
- The import shape is `import Agenda from 'agenda';` (CJS default with `esModuleInterop`). If tsc complains, switch to `import { Agenda } from 'agenda';` — v5 exports both.

- [ ] **Step 1: Write the failing test**

Create `server/tests/agenda.test.ts` — this tests the job *handler registry*, not a live Agenda instance:

```ts
import { describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/User.js';
import { Post } from '../src/models/Post.js';
import { Notification } from '../src/models/Notification.js';
import { registerJobs } from '../src/jobs/index.js';

type Handler = (job: { attrs: { data?: unknown } }) => Promise<void>;

function captureHandlers() {
  const handlers = new Map<string, Handler>();
  const fakeAgenda = { define: (name: string, fn: Handler) => handlers.set(name, fn) };
  registerJobs(fakeAgenda as never);
  return handlers;
}

describe('job registry', () => {
  it('registers publish-post and poll-rss', () => {
    const handlers = captureHandlers();
    expect([...handlers.keys()].sort()).toEqual(['poll-rss', 'publish-post']);
  });

  it('publish-post handler announces a due post exactly once', async () => {
    const broker = await User.create({ email: 'j@x.com', hashedPassword: 'x', role: 'broker', displayName: 'j' });
    const agent = await User.create({ email: 'k@x.com', hashedPassword: 'x', role: 'agent', displayName: 'k' });
    const post = await Post.create({ title: 'Due now', authorId: broker.id, publishAt: new Date(Date.now() - 1000) });
    const handler = captureHandlers().get('publish-post')!;
    await handler({ attrs: { data: { postId: post.id } } });
    await handler({ attrs: { data: { postId: post.id } } }); // Agenda retry — must be a no-op
    expect(await Notification.countDocuments({ userId: agent.id, type: 'postPublished' })).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/agenda.test.ts`
Expected: FAIL — cannot resolve `../src/jobs/index.js`.

- [ ] **Step 3: Write `server/src/jobs/index.ts`**

```ts
import type Agenda from 'agenda';
import { publishPostSideEffects } from '../services/postService.js';
import { pollAllFeeds } from './pollRss.js';

export function registerJobs(agenda: Agenda): void {
  agenda.define('publish-post', async (job) => {
    const { postId } = (job.attrs.data ?? {}) as { postId?: string };
    if (postId) await publishPostSideEffects(postId);
  });
  agenda.define('poll-rss', async () => {
    await pollAllFeeds();
  });
}
```

`pollRss.ts` doesn't exist yet — create a stub now so this compiles; Task 12 fills it in:

```ts
// server/src/jobs/pollRss.ts
export async function pollAllFeeds(): Promise<void> {
  // Implemented in the RSS ingestion task.
}
```

- [ ] **Step 4: Replace `server/src/config/agenda.ts` with the real wiring**

```ts
import Agenda from 'agenda';
import { env } from './env.js';
import { logger } from './logger.js';

// Module-level so schedule/cancel helpers can reach the running instance.
// Stays null in tests and scripts — helpers then no-op (immediate posts publish
// inline; missed one-off jobs catch up on next boot because Agenda runs anything
// whose nextRunAt is already in the past).
let agenda: Agenda | null = null;

export async function startAgenda(registerJobs: (a: Agenda) => void): Promise<void> {
  // Own connection on purpose — see plan Task 11: agenda 5 bundles mongodb v4 and
  // must not share mongoose 8's mongodb-6 Db handle.
  agenda = new Agenda({ db: { address: env.MONGODB_URI, collection: 'agendaJobs' }, processEvery: '1 minute' });
  registerJobs(agenda);
  await agenda.start();
  await agenda.every('60 minutes', 'poll-rss');
  logger.info('agenda started (poll-rss hourly)');
}

export async function stopAgenda(): Promise<void> {
  await agenda?.stop();
  agenda = null;
}

export async function schedulePostPublish(postId: string, when: Date): Promise<void> {
  if (!agenda) return;
  await agenda.cancel({ name: 'publish-post', 'data.postId': postId });
  await agenda.schedule(when, 'publish-post', { postId });
}

export async function cancelPostPublish(postId: string): Promise<void> {
  if (!agenda) return;
  await agenda.cancel({ name: 'publish-post', 'data.postId': postId });
}
```

- [ ] **Step 5: Wire startup/shutdown in `server/src/index.ts`**

Add imports:

```ts
import { startAgenda, stopAgenda } from './config/agenda.js';
import { registerJobs } from './jobs/index.js';
```

In `start()`, after `await connectDb();` add:

```ts
  await startAgenda(registerJobs);
```

And after the `app.listen(...)` line add:

```ts
  process.on('SIGTERM', () => {
    void stopAgenda().finally(() => process.exit(0));
  });
```

- [ ] **Step 6: Run tests and boot check**

Run: `npm -w server run test -- tests/agenda.test.ts`
Expected: PASS (2 tests).

Run: `npm -w server run typecheck`
Expected: exits 0. (If `import Agenda from 'agenda'` errors, use `import { Agenda } from 'agenda'` in both files.)

- [ ] **Step 7: Commit**

```bash
git add server/src/config/agenda.ts server/src/jobs/index.ts server/src/jobs/pollRss.ts server/src/index.ts server/tests/agenda.test.ts
git commit -m "feat(server): agenda job infrastructure with scheduled post publishing"
```

---

### Task 12: RSS ingestion

**Files:**
- Create: `server/src/models/RssItem.ts`
- Modify: `server/src/jobs/pollRss.ts` (replace stub)
- Test: `server/tests/rss.test.ts`

PRD 5.2: poll ≤10 feeds hourly, cache in Mongo, render from DB only — never live-fetch on page load. `guid` falls back to `link`; the `{feedUrl, guid}` unique pair makes re-polls idempotent. A dead feed must never break the others.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/rss.test.ts`:

```ts
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

  it('does nothing with no feeds configured', async () => {
    await pollAllFeeds();
    expect(parseURL).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/rss.test.ts`
Expected: FAIL — cannot resolve `../src/models/RssItem.js`.

- [ ] **Step 3: Write `server/src/models/RssItem.ts`**

```ts
import mongoose from 'mongoose';

const rssItemSchema = new mongoose.Schema(
  {
    feedUrl: { type: String, required: true },
    guid: { type: String, required: true },
    title: { type: String, required: true },
    link: { type: String, default: '' },
    sourceTitle: { type: String, default: '' },
    publishedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
rssItemSchema.index({ feedUrl: 1, guid: 1 }, { unique: true });
rssItemSchema.index({ publishedAt: -1 });

export const RssItem = mongoose.model('RssItem', rssItemSchema);
export type RssItemDoc = InstanceType<typeof RssItem>;
```

- [ ] **Step 4: Replace `server/src/jobs/pollRss.ts`**

```ts
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
        return [
          {
            updateOne: {
              filter: { feedUrl, guid },
              update: {
                $set: { title: item.title, link: item.link ?? '', sourceTitle: feed.title ?? feedUrl },
                $setOnInsert: { publishedAt: item.isoDate ? new Date(item.isoDate) : new Date() },
              },
              upsert: true,
            },
          },
        ];
      });
      if (ops.length > 0) await RssItem.bulkWrite(ops);
    } catch (err) {
      logger.error({ err, feedUrl }, 'rss poll failed for feed');
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w server run test -- tests/rss.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/models/RssItem.ts server/src/jobs/pollRss.ts server/tests/rss.test.ts
git commit -m "feat(server): hourly rss ingestion with per-feed fault isolation"
```

---

### Task 13: Activity feed endpoint + broker pin

**Files:**
- Create: `server/src/services/feedService.ts`
- Create: `server/src/routes/feed.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/tests/feed.test.ts`

Design: two indexed queries (activity events + RSS items), each fetching one page-worth, merged and truncated in JS — no `$unionWith` aggregation to maintain. Cursor = ISO date of the last returned item (internal items compare on `createdAt`, external on `publishedAt`). Currently-pinned items are returned in a separate `pinned` array on the first page only and excluded from the chronological stream while pinned.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/feed.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { RssItem } from '../src/models/RssItem.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe('feed', () => {
  it('merges internal and external items newest-first with a working cursor', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'f1@x.com', 'agent');
    for (let i = 0; i < 15; i++) {
      const e = await ActivityEvent.create({ type: 'agentJoined', message: `internal ${i}` });
      // Back-date through the raw collection — mongoose marks createdAt immutable,
      // so a mongoose-level update would silently drop the $set.
      await ActivityEvent.collection.updateOne({ _id: e._id }, { $set: { createdAt: daysAgo(i * 2) } });
      await RssItem.create({
        feedUrl: 'f',
        guid: `g${i}`,
        title: `external ${i}`,
        publishedAt: daysAgo(i * 2 + 1),
      });
    }
    const page1 = await agent.get('/api/v1/feed');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items[0].title).toBe('internal 0');
    expect(page1.body.items[1].title).toBe('external 0'); // strict date interleave
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await agent.get(`/api/v1/feed?before=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items).toHaveLength(10);
    const all = [...page1.body.items, ...page2.body.items].map((i: { title: string }) => i.title);
    expect(new Set(all).size).toBe(30); // no duplicates across pages
  });

  it('filters internal-only and external-only', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'f2@x.com', 'agent');
    await ActivityEvent.create({ type: 'agentJoined', message: 'int' });
    await RssItem.create({ feedUrl: 'f', guid: 'g', title: 'ext', publishedAt: new Date() });
    const internal = await agent.get('/api/v1/feed?filter=internal');
    expect(internal.body.items.map((i: { kind: string }) => i.kind)).toEqual(['internal']);
    const external = await agent.get('/api/v1/feed?filter=external');
    expect(external.body.items.map((i: { kind: string }) => i.kind)).toEqual(['external']);
  });

  it('office-scoped events hide from other offices, show to admins', async () => {
    const app = createApp();
    const officeA = '64b000000000000000000001';
    const agentB = await loginAs(app, 'f3@x.com', 'agent', '64b000000000000000000002');
    const broker = await loginAs(app, 'f4@x.com', 'broker');
    await ActivityEvent.create({ type: 'announcementPosted', message: 'A only', officeId: officeA });
    expect((await agentB.get('/api/v1/feed')).body.items).toHaveLength(0);
    expect((await broker.get('/api/v1/feed')).body.items).toHaveLength(1);
  });

  it('broker pins an item to the top for 7 days; agents cannot pin', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'f5@x.com', 'broker');
    const agent = await loginAs(app, 'f6@x.com', 'agent');
    const e = await ActivityEvent.create({ type: 'agentJoined', message: 'pin me' });
    await ActivityEvent.create({ type: 'agentJoined', message: 'newer' });

    expect((await agent.post(`/api/v1/feed/${e.id}/pin`)).status).toBe(403);
    const pinRes = await broker.post(`/api/v1/feed/${e.id}/pin`);
    expect(pinRes.status).toBe(200);
    const until = new Date(pinRes.body.item.pinnedUntil).getTime();
    expect(until).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    expect(until).toBeLessThan(Date.now() + 7.1 * 86_400_000);

    const feed = await agent.get('/api/v1/feed');
    expect(feed.body.pinned).toHaveLength(1);
    expect(feed.body.pinned[0].title).toBe('pin me');
    expect(feed.body.items.map((i: { title: string }) => i.title)).toEqual(['newer']); // pinned excluded from stream

    expect((await broker.delete(`/api/v1/feed/${e.id}/pin`)).status).toBe(200);
    const after = await agent.get('/api/v1/feed');
    expect(after.body.pinned).toHaveLength(0);
    expect(after.body.items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server run test -- tests/feed.test.ts`
Expected: FAIL — 404 (router not mounted).

- [ ] **Step 3: Write `server/src/services/feedService.ts`**

```ts
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
```

- [ ] **Step 4: Write `server/src/routes/feed.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { ActivityEvent } from '../models/ActivityEvent.js';
import { getFeed, type FeedFilter } from '../services/feedService.js';

const PIN_DAYS = 7;

export const feedRouter = Router();
feedRouter.use(requireAuth);

feedRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter: FeedFilter =
      req.query.filter === 'internal' || req.query.filter === 'external' ? req.query.filter : 'all';
    const raw = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    const before = raw && !Number.isNaN(raw.getTime()) ? raw : null;
    res.json(await getFeed(req.user!, filter, before));
  }),
);

feedRouter.post(
  '/:id/pin',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    const item = await ActivityEvent.findByIdAndUpdate(
      req.params.id,
      { $set: { pinnedUntil: new Date(Date.now() + PIN_DAYS * 86_400_000) } },
      { new: true },
    );
    if (!item) throw new AppError(404, 'Feed item not found');
    res.json({ item: { id: item.id, pinnedUntil: item.pinnedUntil } });
  }),
);

feedRouter.delete(
  '/:id/pin',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    const item = await ActivityEvent.findByIdAndUpdate(req.params.id, { $set: { pinnedUntil: null } }, { new: true });
    if (!item) throw new AppError(404, 'Feed item not found');
    res.json({ item: { id: item.id, pinnedUntil: item.pinnedUntil } });
  }),
);
```

- [ ] **Step 5: Mount in `server/src/app.ts`**

```ts
import { feedRouter } from './routes/feed.js';
```

```ts
app.use('/api/v1/feed', feedRouter);
```

- [ ] **Step 6: Run the full server suite**

Run: `npm -w server run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/feedService.ts server/src/routes/feed.ts server/src/app.ts server/tests/feed.test.ts
git commit -m "feat(server): merged activity feed with filters, cursor pagination, broker pin"
```

---

### Task 14: Client — notification bell + drawer

**Files:**
- Modify: `client/src/api/types.ts` (append)
- Modify: `client/src/api/hooks.ts` (append)
- Create: `client/src/components/NotificationsDrawer.tsx`
- Modify: `client/src/components/AppShell.tsx` (replace the disabled bell, lines ~133-140)
- Test: `client/src/components/NotificationsDrawer.test.tsx`

- [ ] **Step 1: Append types to `client/src/api/types.ts`**

```ts
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
}
```

- [ ] **Step 2: Append the query hook to `client/src/api/hooks.ts`**

Add `NotificationsResponse` to the existing type import, then:

```ts
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<NotificationsResponse>('/notifications')).data,
    refetchInterval: 60_000, // keep the bell count fresh
  });
}
```

- [ ] **Step 3: Write the failing component test**

Create `client/src/components/NotificationsDrawer.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsDrawer } from './NotificationsDrawer';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({})) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationsDrawer', () => {
  it('lists notifications and marks one read on click', async () => {
    getMock.mockResolvedValue({
      data: {
        notifications: [
          { id: 'n1', type: 'postPublished', title: 'New announcement: Hi', link: '/board/p1', readAt: null, createdAt: new Date().toISOString() },
          { id: 'n2', type: 'invitationAccepted', title: 'Ana accepted', link: '/profile/u1', readAt: new Date().toISOString(), createdAt: new Date().toISOString() },
        ],
        unreadCount: 1,
        nextCursor: null,
      },
    });
    const onClose = vi.fn();
    render(wrap(<NotificationsDrawer open onClose={onClose} />));
    await userEvent.click(await screen.findByText('New announcement: Hi'));
    expect(postMock).toHaveBeenCalledWith('/notifications/n1/read');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty state and a mark-all action', async () => {
    getMock.mockResolvedValue({ data: { notifications: [], unreadCount: 0, nextCursor: null } });
    render(wrap(<NotificationsDrawer open onClose={() => {}} />));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mark all read/i }));
    expect(postMock).toHaveBeenCalledWith('/notifications/read-all');
  });
});
```

(`@testing-library/user-event` was installed in Task 1.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm -w client run test -- src/components/NotificationsDrawer.test.tsx`
Expected: FAIL — module `./NotificationsDrawer` not found.

- [ ] **Step 5: Write `client/src/components/NotificationsDrawer.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useNotifications } from '../api/hooks';
import type { NotificationItem } from '../api/types';
import { Button } from './ui/Button';

export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!open) return null;

  const onItemClick = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: '64px 0 0 0', zIndex: 29 }} />
      <div
        role="dialog"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: 64,
          right: 0,
          bottom: 0,
          width: 'min(360px, 100vw)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <strong style={{ flex: 1 }}>Notifications</strong>
          <Button variant="secondary" style={{ minHeight: 44 }} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
          <button
            aria-label="Close notifications"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text)',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {data?.notifications.length === 0 && (
            <p style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)' }}>You’re all caught up.</p>
          )}
          {data?.notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => onItemClick(n)}
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'baseline',
                width: '100%',
                minHeight: 44,
                padding: 'var(--space-3) var(--space-4)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                textAlign: 'left',
                color: 'var(--color-text)',
                fontWeight: n.readAt ? 400 : 600,
              }}
            >
              {!n.readAt && (
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', flexShrink: 0 }}
                />
              )}
              <span style={{ flex: 1 }}>
                {n.title}
                <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Wire the bell in `client/src/components/AppShell.tsx`**

Add imports: `import { useState } from 'react';` (extend the existing react import), `import { useNotifications } from '../api/hooks';` (extend the existing hooks import), `import { NotificationsDrawer } from './NotificationsDrawer';`.

Inside `AppShell()` add:

```tsx
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: notifData } = useNotifications();
  const unread = notifData?.unreadCount ?? 0;
```

Replace the disabled bell `<button …>Bell…</button>` block with:

```tsx
          <button
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((o) => !o)}
            style={{ ...iconButtonStyle, position: 'relative' }}
          >
            <Bell size={20} />
            {unread > 0 && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  minWidth: 18,
                  height: 18,
                  padding: '0 4px',
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
```

And render the drawer just before the closing `</div>` of the root flex container (next to the `<style>` tag):

```tsx
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
```

**Existing-test impact:** `AppShell.test.tsx`'s `mockAuthAs` throws on unhandled GETs; the new `useNotifications` call will hit `/notifications`. Extend that mock implementation with:

```ts
    if (url === '/notifications') return { data: { notifications: [], unreadCount: 0, nextCursor: null } };
```

- [ ] **Step 7: Run the client suite**

Run: `npm -w client run test`
Expected: PASS — new drawer tests plus all pre-existing tests (with the AppShell mock extended).

- [ ] **Step 8: Commit**

```bash
git add client/src/api/types.ts client/src/api/hooks.ts client/src/components/NotificationsDrawer.tsx client/src/components/NotificationsDrawer.test.tsx client/src/components/AppShell.tsx client/src/components/AppShell.test.tsx client/package.json package-lock.json
git commit -m "feat(client): notification bell with unread count and drawer"
```

---

### Task 15: Client — email notification preferences on the profile page

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx` (append a Card, own profile only)
- Test: `client/src/pages/ProfilePage.test.tsx` (append)

Uses the existing `PATCH /users/:id` endpoint — `updateUserSchema` already accepts `emailPrefs` and self-editing is allowed. Absent key = email ON (matches the server default in `notificationService`).

- [ ] **Step 1: Append a failing test**

Append to `client/src/pages/ProfilePage.test.tsx`, following that file's existing mock/render helpers (it already mocks `../api/client` and renders the page at `/profile/:id`; reuse its helpers — do not invent new ones). The test body:

```tsx
it('toggles an email preference off on own profile', async () => {
  // …render own profile via the file's existing helper (me.id === viewed id)…
  const checkbox = await screen.findByRole('checkbox', { name: /important announcements/i });
  expect(checkbox).toBeChecked(); // absent pref defaults to on
  await userEvent.click(checkbox);
  expect(patchMock).toHaveBeenCalledWith(
    expect.stringMatching(/^\/users\//),
    expect.objectContaining({ emailPrefs: expect.objectContaining({ postPublished: false }) }),
  );
});
```

(If the file's mock exposes `api.patch` under a different name than `patchMock`, use that name.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w client run test -- src/pages/ProfilePage.test.tsx`
Expected: FAIL — no checkbox found.

- [ ] **Step 3: Implement in `client/src/pages/ProfilePage.tsx`**

Add above the component:

```tsx
const EMAIL_PREFS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: 'postPublished', label: 'Important announcements' },
  { key: 'invitationAccepted', label: 'An invitation I sent is accepted', adminOnly: true },
];
```

Add a mutation inside the component (next to `updateUser`):

```tsx
  const updatePrefs = useMutation({
    mutationFn: (emailPrefs: Record<string, boolean>) => api.patch(`/users/${id}`, { emailPrefs }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users', id] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
```

Append a Card after the edit-form Card (still inside the page's outer flex column), rendered only for `isSelf`:

```tsx
      {isSelf && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-2)' }}>Email notifications</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 'var(--space-3)' }}>
            In-app notifications are always on. Choose which ones also send an email.
          </p>
          {EMAIL_PREFS.filter((p) => !p.adminOnly || me.role === 'broker' || me.role === 'officeAdmin').map((p) => (
            <label
              key={p.key}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={user.emailPrefs[p.key] ?? true}
                onChange={(e) => updatePrefs.mutate({ ...user.emailPrefs, [p.key]: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              {p.label}
            </label>
          ))}
        </Card>
      )}
```

Note: `isSelf` implies `me` is defined, but TypeScript can't see that — inside the block use `me!.role` or guard with `isSelf && me &&`.

- [ ] **Step 4: Run the client suite**

Run: `npm -w client run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ProfilePage.tsx client/src/pages/ProfilePage.test.tsx
git commit -m "feat(client): email notification preferences on own profile"
```

---

### Task 16: Client — rich text editor component

**Files:**
- Create: `client/src/components/RichTextEditor.tsx`
- Test: `client/src/components/RichTextEditor.test.tsx`

A TipTap wrapper matching exactly what the server sanitizer allows: bold, italic, bullet/ordered lists, links, images (uploaded through `/uploads/post-image`). Controlled via `value`/`onChange` (HTML string).

**Testing caveat:** TipTap generally renders in jsdom, but if the smoke test hits a jsdom limitation (e.g. missing `Range` APIs), don't fight it — mock `@tiptap/react` in the test, assert the toolbar renders, and note it. Page tests (Tasks 17–18) always mock this whole component.

- [ ] **Step 1: Write the failing smoke test**

Create `client/src/components/RichTextEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

vi.mock('../api/client', () => ({ api: { post: vi.fn() } }));

describe('RichTextEditor', () => {
  it('renders a formatting toolbar', async () => {
    render(<RichTextEditor value="<p>hello</p>" onChange={() => {}} />);
    expect(await screen.findByRole('toolbar', { name: /formatting/i })).toBeInTheDocument();
    for (const name of [/bold/i, /italic/i, /bullet list/i, /numbered list/i, /link/i, /image/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w client run test -- src/components/RichTextEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `client/src/components/RichTextEditor.tsx`**

```tsx
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { api } from '../api/client';

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        display: 'grid',
        placeItems: 'center',
        background: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--color-accent)' : 'var(--color-text)',
      }}
    >
      {children}
    </button>
  );
}

function promptForLink(editor: Editor) {
  const url = window.prompt('Link URL (https://…)', editor.getAttributes('link').href ?? '');
  if (url === null) return;
  if (url === '') editor.chain().focus().unsetLink().run();
  else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;

  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post<{ url: string }>('/uploads/post-image', formData);
    editor.chain().focus().setImage({ src: data.url }).run();
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <div
        role="toolbar"
        aria-label="Formatting"
        style={{ display: 'flex', gap: 2, padding: 2, borderBottom: '1px solid var(--color-border)' }}
      >
        <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={18} />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={18} />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={18} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={18} />
        </ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive('link')} onClick={() => promptForLink(editor)}>
          <LinkIcon size={18} />
        </ToolbarButton>
        <ToolbarButton label="Image" onClick={() => fileRef.current?.click()}>
          <ImageIcon size={18} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void uploadImage(file);
          e.currentTarget.value = '';
        }}
      />
      <style>{`
        .ProseMirror { min-height: 180px; padding: var(--space-3); outline: none; }
        .ProseMirror:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
        .ProseMirror img { max-width: 100%; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w client run test -- src/components/RichTextEditor.test.tsx`
Expected: PASS (apply the testing caveat above if jsdom fights TipTap).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RichTextEditor.tsx client/src/components/RichTextEditor.test.tsx
git commit -m "feat(client): tiptap rich text editor with image upload"
```

---

### Task 17: Client — message board list + post editor pages

**Files:**
- Modify: `client/src/api/types.ts` (append)
- Modify: `client/src/api/hooks.ts` (append)
- Create: `client/src/pages/BoardPage.tsx`
- Create: `client/src/pages/PostEditorPage.tsx`
- Modify: `client/src/App.tsx` (routes)
- Modify: `client/src/components/AppShell.tsx` (nav link)
- Test: `client/src/pages/BoardPage.test.tsx`

- [ ] **Step 1: Append types to `client/src/api/types.ts`**

```ts
export interface PostAuthor {
  id: string;
  displayName: string;
  photoUrl: string;
}

export interface Post {
  id: string;
  title: string;
  bodyHtml: string;
  excerpt: string;
  author: PostAuthor | null;
  officeId: string | null;
  important: boolean;
  commentsEnabled: boolean;
  pinnedAt: string | null;
  publishAt: string;
  createdAt: string;
}

export interface PostComment {
  id: string;
  body: string;
  author: PostAuthor | null;
  createdAt: string;
}
```

- [ ] **Step 2: Append hooks to `client/src/api/hooks.ts`**

Extend the type import with `Post, PostComment`, then:

```ts
export function usePosts(q: string, page: number) {
  return useQuery({
    queryKey: ['posts', { q, page }],
    queryFn: async () =>
      (await api.get<{ posts: Post[]; total: number; page: number }>(
        `/posts?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      )).data,
  });
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: ['posts', id],
    queryFn: async () => (await api.get<{ post: Post }>(`/posts/${id}`)).data.post,
    enabled: !!id,
  });
}

export function useComments(postId: string | undefined) {
  return useQuery({
    queryKey: ['posts', postId, 'comments'],
    queryFn: async () => (await api.get<{ comments: PostComment[] }>(`/posts/${postId}/comments`)).data.comments,
    enabled: !!postId,
  });
}
```

- [ ] **Step 3: Write the failing page test**

Create `client/src/pages/BoardPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Post } from '../api/types';
import { BoardPage } from './BoardPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function post(overrides: Partial<Post>): Post {
  return {
    id: 'p1',
    title: 'T',
    bodyHtml: '',
    excerpt: '',
    author: { id: 'u1', displayName: 'Bob Broker', photoUrl: '' },
    officeId: null,
    important: false,
    commentsEnabled: true,
    pinnedAt: null,
    publishAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi(me: { id: string; role: string }, posts: Post[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { ...me, displayName: 'x', officeId: null } } };
    if (url.startsWith('/posts')) return { data: { posts, total: posts.length, page: 1 } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board']}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BoardPage', () => {
  it('lists posts with pinned and important badges', async () => {
    mockApi({ id: 'u9', role: 'agent' }, [
      post({ id: 'p1', title: 'Pinned post', pinnedAt: new Date().toISOString() }),
      post({ id: 'p2', title: 'Urgent post', important: true }),
    ]);
    render(wrap());
    expect(await screen.findByText('Pinned post')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new post/i })).not.toBeInTheDocument(); // agents cannot create
  });

  it('shows the New post action for admins', async () => {
    mockApi({ id: 'u1', role: 'officeAdmin' }, []);
    render(wrap());
    expect(await screen.findByRole('link', { name: /new post/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm -w client run test -- src/pages/BoardPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `client/src/pages/BoardPage.tsx`**

```tsx
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe, usePosts } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const PAGE_SIZE = 20;

export function BoardPage() {
  const { data: me } = useMe();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // submitted search
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePosts(q, page);
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Message Board</h1>
        {isAdmin && (
          <Link
            to="/board/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            New post
          </Link>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(query.trim());
        }}
        style={{ display: 'flex', gap: 'var(--space-2)' }}
      >
        <input
          aria-label="Search posts"
          placeholder="Search posts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            minHeight: 44,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-3)',
            background: 'var(--color-surface)',
          }}
        />
        <Button type="submit" variant="secondary" aria-label="Search">
          <Search size={18} />
        </Button>
      </form>

      {isLoading && <Spinner label="Loading posts" />}
      {data?.posts.length === 0 && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>{q ? 'No posts match your search.' : 'No posts yet.'}</p>
        </Card>
      )}
      {data?.posts.map((p) => (
        <Card key={p.id} style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to={`/board/${p.id}`} style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
              {p.title}
            </Link>
            {p.pinnedAt && <Badge tone="accent">Pinned</Badge>}
            {p.important && <Badge tone="danger">Important</Badge>}
          </div>
          <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {p.author?.displayName ?? 'Unknown'} · {new Date(p.publishAt).toLocaleDateString()}
          </div>
          {p.excerpt && <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{p.excerpt}</p>}
        </Card>
      ))}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span style={{ alignSelf: 'center', fontSize: 14 }}>
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `client/src/pages/PostEditorPage.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePost, useSettings } from '../api/hooks';
import type { Post } from '../api/types';
import { RichTextEditor } from '../components/RichTextEditor';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';

/** ISO → value usable by <input type="datetime-local"> in the viewer's timezone. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostEditorPage() {
  const { id } = useParams(); // undefined on /board/new
  const editing = !!id;
  const { data: existing, isLoading } = usePost(id);
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [important, setImportant] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [publishAt, setPublishAt] = useState(''); // datetime-local value; '' = publish now
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (editing && existing && !seeded) {
      setTitle(existing.title);
      setBodyHtml(existing.bodyHtml);
      setOfficeId(existing.officeId ?? '');
      setImportant(existing.important);
      setCommentsEnabled(existing.commentsEnabled);
      if (new Date(existing.publishAt) > new Date()) setPublishAt(toLocalInputValue(existing.publishAt));
      setSeeded(true);
    }
  }, [editing, existing, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        bodyHtml,
        officeId: officeId || null,
        important,
        commentsEnabled,
        ...(publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
      };
      const res = editing
        ? await api.patch<{ post: Post }>(`/posts/${id}`, body)
        : await api.post<{ post: Post }>('/posts', body);
      return res.data.post;
    },
    onSuccess: async (post) => {
      await qc.invalidateQueries({ queryKey: ['posts'] });
      navigate(`/board/${post.id}`);
    },
  });

  const errorMessage =
    save.isError && isAxiosError(save.error)
      ? ((save.error.response?.data as { error?: string })?.error ?? 'Could not save the post')
      : undefined;

  if (editing && isLoading) return <Spinner label="Loading post" />;

  return (
    <Card style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-4)' }}>{editing ? 'Edit post' : 'New post'}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Body</span>
          <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="post-office" style={{ fontWeight: 600, fontSize: 14 }}>
            Audience
          </label>
          <select
            id="post-office"
            value={officeId}
            onChange={(e) => setOfficeId(e.target.value)}
            style={{
              minHeight: 44,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          >
            <option value="">All users</option>
            {settings?.officeLocations.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} style={{ width: 18, height: 18 }} />
          Important (also emails everyone it targets)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
          <input type="checkbox" checked={commentsEnabled} onChange={(e) => setCommentsEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          Allow comments
        </label>

        <div style={{ display: 'grid', gap: 'var(--space-1)', margin: 'var(--space-3) 0 var(--space-4)' }}>
          <label htmlFor="post-publish-at" style={{ fontWeight: 600, fontSize: 14 }}>
            Schedule (leave empty to publish now)
          </label>
          <input
            id="post-publish-at"
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            style={{
              minHeight: 44,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          />
        </div>

        {errorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
            {errorMessage}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : publishAt ? 'Schedule post' : 'Publish post'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 7: Add routes and nav**

In `client/src/App.tsx` add imports `BoardPage`, `PostEditorPage`, `PostPage` (PostPage arrives in Task 18 — add its route then if you prefer strict ordering) and routes inside the authenticated layout:

```tsx
        <Route path="/board" element={<BoardPage />} />
        <Route
          path="/board/new"
          element={
            <RequireAuth min="officeAdmin">
              <PostEditorPage />
            </RequireAuth>
          }
        />
        <Route
          path="/board/:id/edit"
          element={
            <RequireAuth min="officeAdmin">
              <PostEditorPage />
            </RequireAuth>
          }
        />
```

In `client/src/components/AppShell.tsx`, import `Megaphone` from lucide-react and add a nav link after Directory:

```tsx
          <NavLink to="/board" style={({ isActive }) => navLinkStyle(isActive)}>
            <Megaphone size={18} />
            Message Board
          </NavLink>
```

- [ ] **Step 8: Run the client suite**

Run: `npm -w client run test`
Expected: PASS. (If `AppShell.test.tsx` asserts exact link sets, extend it for the new link.)

- [ ] **Step 9: Commit**

```bash
git add client/src/api/types.ts client/src/api/hooks.ts client/src/pages/BoardPage.tsx client/src/pages/BoardPage.test.tsx client/src/pages/PostEditorPage.tsx client/src/App.tsx client/src/components/AppShell.tsx client/src/components/AppShell.test.tsx
git commit -m "feat(client): message board list, search, and post editor"
```

---

### Task 18: Client — post detail page with comments

**Files:**
- Create: `client/src/pages/PostPage.tsx`
- Modify: `client/src/App.tsx` (route)
- Test: `client/src/pages/PostPage.test.tsx`

`bodyHtml` is rendered with `dangerouslySetInnerHTML` — this is safe **only because the server sanitized it at write time** (Task 6); never render client-supplied HTML through this path.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/PostPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostPage } from './PostPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn() } }));

function mockApi({ role = 'agent', commentsEnabled = true } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me')
      return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/posts/p1')
      return {
        data: {
          post: {
            id: 'p1',
            title: 'Big news',
            bodyHtml: '<p>Rich <strong>body</strong></p>',
            excerpt: '',
            author: { id: 'a1', displayName: 'Bob', photoUrl: '' },
            officeId: null,
            important: false,
            commentsEnabled,
            pinnedAt: null,
            publishAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        },
      };
    if (url === '/posts/p1/comments')
      return {
        data: {
          comments: [
            { id: 'c1', body: 'Mine', author: { id: 'me', displayName: 'Me', photoUrl: '' }, createdAt: new Date().toISOString() },
            { id: 'c2', body: 'Theirs', author: { id: 'x', displayName: 'X', photoUrl: '' }, createdAt: new Date().toISOString() },
          ],
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board/p1']}>
        <Routes>
          <Route path="/board/:id" element={<PostPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PostPage', () => {
  it('renders rich body, comments, and delete only on own comment for agents', async () => {
    mockApi();
    render(wrap());
    expect(await screen.findByText('Big news')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument(); // <strong> rendered
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /delete comment/i })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('submits a comment', async () => {
    mockApi();
    render(wrap());
    await screen.findByText('Big news');
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'Great!');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(postMock).toHaveBeenCalledWith('/posts/p1/comments', { body: 'Great!' });
  });

  it('hides the comment form when comments are disabled and shows admin actions', async () => {
    mockApi({ role: 'broker', commentsEnabled: false });
    render(wrap());
    await screen.findByText('Big news');
    expect(screen.queryByLabelText(/add a comment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pin/i })).toBeInTheDocument();
    // admins can delete any comment
    expect(screen.getAllByRole('button', { name: /delete comment/i })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w client run test -- src/pages/PostPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `client/src/pages/PostPage.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useComments, useMe, usePost } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export function PostPage() {
  const { id } = useParams();
  const { data: post, isLoading, error } = usePost(id);
  const { data: comments } = useComments(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [commentBody, setCommentBody] = useState('');

  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/posts/${id}/comments`, { body }),
    onSuccess: async () => {
      setCommentBody('');
      await qc.invalidateQueries({ queryKey: ['posts', id, 'comments'] });
    },
  });
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.delete(`/posts/${id}/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts', id, 'comments'] }),
  });
  const togglePin = useMutation({
    mutationFn: () => (post?.pinnedAt ? api.delete(`/posts/${id}/pin`) : api.post(`/posts/${id}/pin`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
  const deletePost = useMutation({
    mutationFn: () => api.delete(`/posts/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posts'] });
      navigate('/board');
    },
  });

  const pinError =
    togglePin.isError && isAxiosError(togglePin.error)
      ? ((togglePin.error.response?.data as { error?: string })?.error ?? 'Could not pin')
      : undefined;

  if (isLoading) return <Spinner label="Loading post" />;
  if (!post) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Post not found</h2>
        </Card>
      );
    }
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{post.title}</h1>
          {post.pinnedAt && <Badge tone="accent">Pinned</Badge>}
          {post.important && <Badge tone="danger">Important</Badge>}
        </div>
        <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {post.author?.displayName ?? 'Unknown'} · {new Date(post.publishAt).toLocaleString()}
        </div>
        {/* Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe. */}
        <div style={{ marginTop: 'var(--space-4)' }} dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />
        {isAdmin && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Link
              to={`/board/${post.id}/edit`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Edit
            </Link>
            <Button variant="secondary" onClick={() => togglePin.mutate()} disabled={togglePin.isPending}>
              {post.pinnedAt ? <PinOff size={16} /> : <Pin size={16} />}
              <span style={{ marginLeft: 6 }}>{post.pinnedAt ? 'Unpin' : 'Pin'}</span>
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this post and its comments?')) deletePost.mutate();
              }}
              disabled={deletePost.isPending}
            >
              Delete
            </Button>
          </div>
        )}
        {pinError && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {pinError}
          </p>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Comments</h2>
        {comments?.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {post.commentsEnabled ? 'No comments yet.' : 'Comments are disabled on this post.'}
          </p>
        )}
        {comments?.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'baseline',
              padding: 'var(--space-2) 0',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{c.author?.displayName ?? 'Unknown'}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                {new Date(c.createdAt).toLocaleString()}
              </span>
              <p style={{ fontSize: 14, marginTop: 2 }}>{c.body}</p>
            </div>
            {(isAdmin || c.author?.id === me?.id) && (
              <button
                aria-label="Delete comment"
                onClick={() => deleteComment.mutate(c.id)}
                style={{
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-danger)',
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {post.commentsEnabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (commentBody.trim()) addComment.mutate(commentBody.trim());
            }}
            style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}
          >
            <input
              aria-label="Add a comment"
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              maxLength={2000}
              style={{
                flex: 1,
                minHeight: 44,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 var(--space-3)',
                background: 'var(--color-surface)',
              }}
            />
            <Button type="submit" disabled={addComment.isPending || !commentBody.trim()}>
              Comment
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the route in `client/src/App.tsx`**

After the `/board/new` route (order matters — `new` must not be captured by `:id`; React Router 6 ranks static segments higher anyway, but keep `new` first for readability):

```tsx
        <Route path="/board/:id" element={<PostPage />} />
```

- [ ] **Step 5: Run the client suite**

Run: `npm -w client run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/PostPage.tsx client/src/pages/PostPage.test.tsx client/src/App.tsx
git commit -m "feat(client): post detail page with comments and admin actions"
```

---

### Task 19: Client — activity feed page

**Files:**
- Modify: `client/src/api/types.ts` (append)
- Create: `client/src/pages/FeedPage.tsx`
- Modify: `client/src/App.tsx` (route)
- Modify: `client/src/components/AppShell.tsx` (nav link)
- Test: `client/src/pages/FeedPage.test.tsx`

- [ ] **Step 1: Append types to `client/src/api/types.ts`**

```ts
export interface FeedItem {
  id: string;
  kind: 'internal' | 'external';
  title: string;
  link: string;
  source?: string;
  pinnedUntil?: string | null;
  date: string;
}

export interface FeedResponse {
  pinned: FeedItem[];
  items: FeedItem[];
  nextCursor: string | null;
}
```

- [ ] **Step 2: Write the failing test**

Create `client/src/pages/FeedPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FeedPage } from './FeedPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({})) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn() } }));

// jsdom has no IntersectionObserver — the page uses it for infinite scroll.
beforeAll(() => {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', IO);
});

function mockApi(role: string) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url.startsWith('/feed'))
      return {
        data: {
          pinned: [
            { id: 'p', kind: 'internal', title: 'Pinned news', link: '', pinnedUntil: new Date(Date.now() + 86_400_000).toISOString(), date: new Date().toISOString() },
          ],
          items: [
            { id: 'i1', kind: 'internal', title: 'Ana joined', link: '/profile/a', date: new Date().toISOString() },
            { id: 'e1', kind: 'external', title: 'Rates dip', link: 'https://news.com/x', source: 'HW News', date: new Date().toISOString() },
          ],
          nextCursor: null,
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/feed']}>
        <FeedPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FeedPage', () => {
  it('renders pinned block, internal and external items with source, filters visible', async () => {
    mockApi('agent');
    render(wrap());
    expect(await screen.findByText('Pinned news')).toBeInTheDocument();
    expect(screen.getByText('Ana joined')).toBeInTheDocument();
    expect(screen.getByText(/HW News/)).toBeInTheDocument();
    for (const name of [/^all$/i, /internal/i, /external/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /pin item/i })).not.toBeInTheDocument(); // agents can't pin
  });

  it('lets a broker pin an internal item', async () => {
    mockApi('broker');
    render(wrap());
    await screen.findByText('Ana joined');
    await userEvent.click(screen.getAllByRole('button', { name: /pin item/i })[0]);
    expect(postMock).toHaveBeenCalledWith('/feed/i1/pin');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm -w client run test -- src/pages/FeedPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `client/src/pages/FeedPage.tsx`**

```tsx
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pin, PinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import type { FeedItem, FeedResponse } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

type Filter = 'all' | 'internal' | 'external';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'internal', label: 'Internal' },
  { key: 'external', label: 'External news' },
];

export function FeedPage() {
  const { data: me } = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const qc = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const feed = useInfiniteQuery({
    queryKey: ['feed', filter],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<FeedResponse>(
          `/feed?filter=${filter}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        )
      ).data,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.delete(`/feed/${id}/pin`) : api.post(`/feed/${id}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const isBroker = me?.role === 'broker';
  const pinned = feed.data?.pages[0]?.pinned ?? [];
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  const renderItem = (item: FeedItem, isPinned: boolean) => (
    <div
      key={item.id}
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'baseline',
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ flex: 1 }}>
        {item.kind === 'external' ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
            {item.title} <ExternalLink size={12} aria-hidden style={{ verticalAlign: 'baseline' }} />
          </a>
        ) : item.link ? (
          <Link to={item.link} style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {item.title}
          </Link>
        ) : (
          <span style={{ fontWeight: 600 }}>{item.title}</span>
        )}
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {item.kind === 'external' ? `${item.source ?? 'External'} · ` : ''}
          {new Date(item.date).toLocaleString()}
        </span>
      </div>
      {isPinned && <Badge tone="accent">Pinned</Badge>}
      {isBroker && item.kind === 'internal' && (
        <button
          aria-label={isPinned ? 'Unpin item' : 'Pin item'}
          onClick={() => pin.mutate({ id: item.id, pinned: isPinned })}
          style={{
            width: 44,
            height: 44,
            display: 'grid',
            placeItems: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Activity Feed</h1>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? 'primary' : 'secondary'}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {feed.isLoading && <Spinner label="Loading feed" />}

      {pinned.length > 0 && <Card>{pinned.map((i) => renderItem(i, true))}</Card>}

      <Card>
        {items.length === 0 && !feed.isLoading && (
          <p style={{ color: 'var(--color-text-muted)' }}>Nothing here yet.</p>
        )}
        {items.map((i) => renderItem(i, false))}
        <div ref={sentinelRef} />
        {isFetchingNextPage && <Spinner label="Loading more" />}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Add route and nav**

`client/src/App.tsx`:

```tsx
        <Route path="/feed" element={<FeedPage />} />
```

`client/src/components/AppShell.tsx` — import `Newspaper` from lucide-react, add after the Message Board link:

```tsx
          <NavLink to="/feed" style={({ isActive }) => navLinkStyle(isActive)}>
            <Newspaper size={18} />
            Feed
          </NavLink>
```

- [ ] **Step 6: Run the client suite**

Run: `npm -w client run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/api/types.ts client/src/pages/FeedPage.tsx client/src/pages/FeedPage.test.tsx client/src/App.tsx client/src/components/AppShell.tsx
git commit -m "feat(client): activity feed with filters, infinite scroll, broker pinning"
```

---

### Task 20: Finish — docs, CI action bump, full verification

**Files:**
- Modify: `README.md` (feature notes), `docs/superpowers/plans/2026-07-09-roadmap.md` (mark Stage 2 planned/done)
- Modify: `.github/workflows/ci.yml:10-11` (Node-20 deprecation bump promised after the Stage 1 push)

- [ ] **Step 1: Bump deprecated GitHub Actions**

In `.github/workflows/ci.yml` change:

```yaml
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
```

(GitHub's runners warn that v4 of both targets deprecated Node 20.)

- [ ] **Step 2: Update the roadmap**

In `docs/superpowers/plans/2026-07-09-roadmap.md` change the Stage 2 heading to:

```markdown
## Stage 2 — Communications ✦ plan: `2026-07-10-stage-2-communications.md`
```

- [ ] **Step 3: Update `README.md`**

Add to the Docs list:

```markdown
- [docs/superpowers/plans/2026-07-10-stage-2-communications.md](docs/superpowers/plans/2026-07-10-stage-2-communications.md) — Stage 2 implementation plan
```

If the README describes current features anywhere, extend it with one line: message board with rich-text announcements and comments, in-app + email notifications, activity feed with RSS ingestion (hourly background job).

- [ ] **Step 4: Full verification**

Run: `npm run lint && npm run test && npm run build`
Expected: all green — treat any failure as a blocker, not a note.

Then a live smoke check (two terminals or `npm run dev`):
1. Sign in as the seeded broker → create a post with formatting and an image → it appears on `/board`, the activity feed shows "New announcement", and a second (invited) user gets a bell notification.
2. Schedule a post 2 minutes out → it stays hidden from an agent until Agenda fires (within ~1 minute of `publishAt`, given `processEvery: '1 minute'`), then announces once.
3. Add an RSS feed URL in Admin → Settings, restart the dev server (boot triggers the hourly job) → external items appear under `/feed`.
4. Toggle "Important announcements" off on your profile → publish an important post from the other account → in-app notification arrives, no email logged for you (console driver logs sends in dev).

- [ ] **Step 5: Commit and finish the branch**

```bash
git add README.md docs/superpowers/plans/2026-07-09-roadmap.md .github/workflows/ci.yml
git commit -m "docs: stage 2 notes; chore: bump CI actions off deprecated Node 20"
```

Then follow **superpowers:finishing-a-development-branch** — push the branch, open a PR into `main`, confirm CI is green before merging:

```bash
git push -u origin feat/stage-2-communications
gh pr create --title "Stage 2 — Communications" --body "Message board, notifications, activity feed, RSS ingestion, Agenda jobs. See docs/superpowers/plans/2026-07-10-stage-2-communications.md"
```

---

## Deferred to later stages (do NOT build now)

- Dashboard widgets for feed preview / pinned announcements (Stage 5 wires them; the dashboard placeholder stays).
- Retention jobs: activity events 90d, RSS items 30d (Stage 5).
- Notification triggers for tasks/calendar/resources (Stages 3–4 extend `NOTIFICATION_TYPES` and `ACTIVITY_TYPES`).
- Engagement `pageView` logging (Stage 5).
- Group targeting for posts (Phase 2).

## Carried backlog (unchanged from Stage 1, still not in scope)

Dummy-scrypt timing hardening · accent default deduplication · React Router v7 future flags · Escape/scrim for the mobile sidebar overlay · admin-set avatars server route.







