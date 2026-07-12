# Stage 5 — Polish & Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PRD Phase 1: assemble the real homepage dashboard driven by `Settings.homepageLayout` (feed preview, upcoming events, pinned announcements, quick links, rich-text welcome message, plus the existing banner slot / my-tasks / onboarding widgets), give the broker admin editors for layout/welcome/quick-links and brokerage-wide notification defaults, start `pageView` engagement logging, add the retention sweep (90d activity / 30d RSS / 2y tasks), close the structural accessibility gaps (sidebar overlay, notifications drawer, calendar grid), split the oversized client bundle, wire optional Sentry, and ship the deployment runbook.

**Architecture:** Everything extends Stage 1–4 machinery — no new collections. `homepageLayout` (a Stage 1 field, default `['welcome','banners','announcements','myTasks','events','feed','quickLinks']`) becomes the single source of widget order + enablement. `Settings.notificationDefaults` (new Map field) slots between per-user prefs and the hardcoded `?? true` fallback in `notificationService.notify`. Retention is one daily Agenda job. `pageView` reuses the Stage 1 `ENGAGEMENT_TYPES` enum via one new authenticated route. Code-splitting is route-level `React.lazy` (TipTap moves out of the entry chunk).

**Tech Stack:** No new runtime deps except **optional, env-gated Sentry** (`@sentry/node` server, `@sentry/react` client — dynamically imported, dead weight only when `SENTRY_DSN`/`VITE_SENTRY_DSN` are set). Everything else: existing Express 4 / Mongoose 8 / Zod 3 / Agenda / React 18 / TanStack Query 5 / TipTap / vitest stack.

**Conventions for every task:**
- Run all commands from the repo root (`C:\Users\derri\OneDrive\Desktop\openagent`). Bash syntax.
- Server relative imports use `.js` extensions (ESM + NodeNext).
- Work on branch `feat/stage-5-polish` (created in Task 1). Commit after each green task. Never commit `.env`. Never push — the controller pushes.
- Server tests: `npm -w server run test` (baseline **201**). Client: `npm -w client run test` (baseline **82**). Client typecheck: `npx tsc --noEmit` from `client/` (no typecheck script). Each task states an expected test DELTA — report exact totals; if lower than expected, a test was skipped.
- Match established patterns exactly: `toPublicX` mappers, role gates mirrored client/server, `role="alert"` + `isAxiosError` surfacing, 44px targets + aria-labels, query keys invalidated by exact prefix, sanitized rich text only via the commented `dangerouslySetInnerHTML` pattern, `vi.hoisted` URL-switching api mocks + `wrap()` helpers in tests (mirror `BannersPage.test.tsx` / `DashboardPage.test.tsx`).
- Injected git-status snapshots go stale — run `git status` yourself; ignore phantom files.

**Stage-5 scope decisions (locked — do not relitigate during implementation):**
1. **`homepageLayout` governs order AND enablement of all seven widget keys** (`welcome`, `banners`, `announcements`, `myTasks`, `events`, `feed`, `quickLinks`). A key absent from the array = widget disabled. Unknown keys are rejected by the validator and ignored defensively by the renderer. The **onboarding progress card is NOT layout-governed** — PRD 5.1.2 mandates it unconditionally until onboarding completes; it always renders first when applicable.
2. **`welcomeMessage` becomes sanitized rich HTML in the same field.** PATCH `/admin/settings` runs it through `sanitizePostHtml` (bold/italic/links per PRD 5.1.2 are a subset of the post config; reusing it keeps one trust boundary). The dashboard renders it via the established commented `dangerouslySetInnerHTML` pattern. Pre-existing plain-text values render unformatted until the broker re-saves via the new editor — acceptable for a single-tenant app; note it in the admin editor's hint text.
3. **Announcements widget = the 3 most recent pinned posts** (`Post.pinnedAt != null`). `GET /posts` already sorts `{pinnedAt: -1, publishAt: -1}`, so the widget filters page 1 of the existing `usePosts` result client-side — no new endpoint. (The FEED pin feature — ActivityEvents `pinnedUntil` — is a different mechanism and stays untouched.)
4. **Events widget = next 5 occurrences** from `GET /events?from=now&to=now+30d` (the route requires from/to; 92-day max honored), sliced client-side via a thin `useUpcomingEvents` wrapper over the existing `useEvents`.
5. **Feed preview = first 5 items of the first feed page** via a new shared `useFeedPreview` hook (`GET /feed`, no cursor; pinned items first, then items, sliced to 5). FeedPage's inline `useInfiniteQuery` is NOT refactored — out of scope.
6. **`notificationDefaults`:** `Settings.notificationDefaults` is a `Map<NotificationType, boolean>` defaulting empty. Effective email decision in `notify()` becomes: `user.emailPrefs.get(type) ?? settings.notificationDefaults.get(type) ?? true`. `nonDisableable` (task overdue) bypasses both, unchanged. The admin card lives on the broker-only Settings page (matches the existing `/admin/settings` gate); `taskOverdue` renders as a locked "always on" row.
7. **Retention sweep (daily Agenda job `retention-sweep`):** deletes `ActivityEvent` with `createdAt < now-90d` **and not currently pinned** (`pinnedUntil` null or `<= now`); `RssItem` with `createdAt < now-30d`; `Task` with `createdAt < now-2y` **and** `nextRecurrenceAt == null` (never delete an actively recurring task). Logs deleted counts per collection. No TTL indexes — the job is the single retention mechanism (auditable, testable).
8. **`pageView`:** `POST /engagement/page-view` (requireAuth, body `{path: string ≤300}`) fire-and-forgets `logEngagement('pageView', userId, {path})`. The client emits from `AppShell` on `location.pathname` change (consecutive duplicates skipped). No sampling, no debounce beyond dedupe — a dozens-of-users intranet.
9. **Sentry both sides, env-gated; PostHog intentionally omitted.** PRD NFR 9.3 names Sentry for error tracking → implemented (server: init + capture in the errorHandler 500 branch when `SENTRY_DSN` set; client: dynamic `import('@sentry/react')` in `main.tsx` only when `VITE_SENTRY_DSN` set, so the bundle pays nothing otherwise). The roadmap's "PostHog if keys provided" is **deliberately dropped**: `EngagementEvents` is the PRD's own analytics store (§6.3 reads exclusively from it) and a second analytics pipe adds a dependency with no Phase 1 consumer. Recorded here as the decision of record.
10. **Code-splitting:** every authenticated page becomes `React.lazy` (login/register stay eager for first paint); one `Suspense` fallback (`Spinner`) around the routes. Acceptance: the entry chunk drops below Vite's 500 kB warning threshold (currently 732 kB) and no route is broken.
11. **A11y scope (structural fixes only — labeling is already clean):** (a) sidebar off-canvas overlay gets a scrim (click-to-close), Escape-to-close, initial focus + focus restore, and Tab containment via a new shared `useFocusTrap` hook; (b) `NotificationsDrawer` upgrades its partial handling to the same hook (its code comment already promises this); (c) CalendarPage month grid gets `role="grid"/"row"/"columnheader"/"gridcell"` semantics and roving-tabindex arrow-key navigation (Left/Right/Up/Down between day cells, Enter/Space opens the day's first action). Nothing else structural.
12. **Cleanups folded in:** `BannerSlot.tsx` stale comment (says `sanitizePostHtml`, actual is `sanitizeBannerHtml`); remove the now-dead `remove` mutation from `useResourceMutations` (ResourceDetailPage owns a local delete since the Stage 4 fix round).

**API surface added (all under `/api/v1`):**

| Method & path | Who | Purpose |
|---|---|---|
| `POST /engagement/page-view` | any authenticated user | logs a `pageView` engagement event |
| `PATCH /admin/settings` (extended) | broker | now also accepts `homepageLayout` (validated key set) and `notificationDefaults` (record of NotificationType→boolean); `welcomeMessage` is sanitized server-side |

---

### Task 1: Branch, notificationDefaults model field + notify() consult

**Files:**
- Modify: `server/src/models/Settings.ts` (field), `server/src/services/notificationService.ts` (consult)
- Test: `server/tests/notificationDefaults.test.ts` (new)

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b feat/stage-5-polish`

- [ ] **Step 2 (failing test first):** new `server/tests/notificationDefaults.test.ts`. Mirror `server/tests/` conventions (in-memory harness; read an existing notificationService test if one exists and reuse its helpers). Mock/capture `sendEmail` the way existing notification tests do. Cases:
  1. user pref unset + default unset → email sent (`?? true` fallback intact);
  2. user pref unset + `notificationDefaults.set('postPublished', false)` → email suppressed;
  3. user pref TRUE + default false → email sent (user wins);
  4. user pref FALSE + default true → suppressed (user wins);
  5. `nonDisableable` email with both user pref and default false → still sent.
  In-app notifications insert in all five cases.

- [ ] **Step 3:** `Settings.ts` — add to the schema (after `onboardingTaskTemplateId`):
```ts
    // Brokerage-wide email defaults per notification type (PRD 5.10.2). A user's own
    // emailPrefs entry always wins; this map only fills the gap when the user never chose.
    notificationDefaults: { type: Map, of: Boolean, default: {} },
```

- [ ] **Step 4:** `notificationService.ts` — inside `notify()`, load the singleton once per call (`const settings = await getSettings();` — import from the model) and change the decision line to:
```ts
      const wantsEmail =
        (u.emailPrefs as Map<string, boolean>).get(input.type) ??
        (settings.notificationDefaults as Map<string, boolean>).get(input.type) ??
        true;
```
Keep the `nonDisableable` bypass exactly as-is (it must short-circuit before this).

- [ ] **Step 5:** `npm -w server run test` — expected **+5** (report exact; baseline 201 → 206). Typecheck + root lint clean.

- [ ] **Step 6:** Commit: `feat(server): brokerage-wide notification email defaults` (+ Co-Authored-By trailer, as with every commit in this plan).

---

### Task 2: Settings validator + welcomeMessage sanitization (server)

**Files:**
- Modify: `server/src/validators/settings.ts`, `server/src/routes/settings.ts`
- Test: extend `server/tests/settings.test.ts`

- [ ] **Step 1 (failing tests):** extend `server/tests/settings.test.ts`:
  1. PATCH `homepageLayout: ['welcome','myTasks']` → 200, persisted verbatim; GET returns it.
  2. PATCH `homepageLayout: ['welcome','bogus']` → 400.
  3. PATCH `homepageLayout: ['welcome','welcome']` (duplicate) → 400.
  4. PATCH `welcomeMessage: '<p>Hi <script>alert(1)</script><a href="https://x.example.com">team</a></p>'` → 200 and the stored/returned value has the script stripped and the anchor kept (assert on actual `sanitizePostHtml` output).
  5. PATCH `notificationDefaults: { postPublished: false }` → 200, round-trips.
  6. PATCH `notificationDefaults: { notARealType: true }` → 400.

- [ ] **Step 2:** `validators/settings.ts` — add to `updateSettingsSchema` (import `NOTIFICATION_TYPES` from the Notification model and define the widget keys here as the source of truth for the client to mirror):
```ts
export const HOMEPAGE_WIDGETS = [
  'welcome', 'banners', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks',
] as const;

  homepageLayout: z
    .array(z.enum(HOMEPAGE_WIDGETS))
    .max(HOMEPAGE_WIDGETS.length)
    .refine((a) => new Set(a).size === a.length, 'Duplicate widgets')
    .optional(),
  notificationDefaults: z.record(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
```

- [ ] **Step 3:** `routes/settings.ts` — in the PATCH handler, before `Object.assign`:
```ts
    if (typeof req.body.welcomeMessage === 'string') {
      req.body.welcomeMessage = sanitizePostHtml(req.body.welcomeMessage);
    }
```
(with the import; add a one-line comment: welcome message renders as rich HTML on the dashboard — same trust boundary as post bodies).

- [ ] **Step 4:** `npm -w server run test` — expected **+6** (→ 212, report exact). Lint clean.

- [ ] **Step 5:** Commit: `feat(server): homepage layout + notification defaults in settings; rich welcome message`.

---

### Task 3: pageView route (server)

**Files:**
- Create: `server/src/routes/engagement.ts`
- Modify: `server/src/app.ts` (mount)
- Test: `server/tests/engagement.test.ts` (new)

- [ ] **Step 1 (failing test):** `server/tests/engagement.test.ts`: (1) authenticated POST `/api/v1/engagement/page-view` `{path: '/board'}` → 204 and an `EngagementEvent` `{type:'pageView', meta.path:'/board'}` exists for that user (allow the fire-and-forget a short settle, mirroring `models.test.ts`'s 50ms pattern); (2) unauthenticated → 401; (3) `path` longer than 300 chars → 400.

- [ ] **Step 2:** `server/src/routes/engagement.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logEngagement } from '../services/engagementService.js';

const pageViewSchema = z.object({ path: z.string().min(1).max(300) });

export const engagementRouter = Router();
engagementRouter.use(requireAuth);

engagementRouter.post('/page-view', validate(pageViewSchema), (req, res) => {
  logEngagement('pageView', req.user!.id, { path: req.body.path });
  res.status(204).end();
});
```

- [ ] **Step 3:** Mount in `app.ts` routers block: `app.use('/api/v1/engagement', engagementRouter);`

- [ ] **Step 4:** `npm -w server run test` — expected **+3** (→ 215, report exact). Commit: `feat(server): pageView engagement endpoint`.

---

### Task 4: Retention sweep job (server)

**Files:**
- Create: `server/src/jobs/retentionSweep.ts`
- Modify: `server/src/jobs/index.ts` (define), `server/src/config/agenda.ts` (schedule daily)
- Test: `server/tests/retentionSweep.test.ts` (new)

- [ ] **Step 1 (failing test):** seed fixtures with hand-set `createdAt` values (use `collection.insertMany` or `Model.create` then `updateOne({$set:{createdAt}})` — `timestamps` blocks create-time overrides; check how existing job tests seed dates and mirror). Cases:
  1. ActivityEvent 91 days old (unpinned) deleted; 89 days old kept; 91 days old but `pinnedUntil` in the future kept.
  2. RssItem 31 days old deleted; 29 days kept.
  3. Task 25 months old with `nextRecurrenceAt: null` deleted; 25 months old with `nextRecurrenceAt` set kept; 23 months old kept.
  4. The function returns/logs the per-collection deleted counts.

- [ ] **Step 2:** `server/src/jobs/retentionSweep.ts` (mirror `taskSweep.ts`'s style — single exported function):
```ts
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
```
(If `ActivityEvent.pinnedUntil`'s unset representation differs — e.g. missing vs null — assert the real shape in the test first and adjust the `$or` accordingly; report what you found.)

- [ ] **Step 3:** `jobs/index.ts`: `agenda.define('retention-sweep', ...)` calling `sweepRetention()` — mirror the existing define wrappers. `config/agenda.ts`: `await agenda.every('24 hours', 'retention-sweep');` alongside the existing `every` lines.

- [ ] **Step 4:** `npm -w server run test` — expected **+4 or more** (→ ~219, report exact). Commit: `feat(server): daily retention sweep for activity, rss, and task history`.

---

### Task 5: Optional Sentry (server) + env docs

**Files:**
- Modify: `server/package.json` (dep), `server/src/config/env.ts` (key), `server/src/index.ts` (init), `server/src/middleware/errorHandler.ts` (capture), `.env.example`
- Test: extend `server/tests/health.test.ts` or new small test

- [ ] **Step 1:** `npm -w server i @sentry/node` (state the added dependency in your report).

- [ ] **Step 2:** `env.ts`: `SENTRY_DSN: z.string().optional(),`. `.env.example`: add `SENTRY_DSN=` and `VITE_SENTRY_DSN=` under the optional-integrations block with a comment ("error tracking; leave empty to disable").

- [ ] **Step 3:** `index.ts` — inside `start()` before `createApp()`:
```ts
  if (env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
    logger.info('sentry enabled');
  }
```
`errorHandler.ts` — in the final 500 branch only, before the response:
```ts
  if (env.SENTRY_DSN) {
    import('@sentry/node').then((S) => S.captureException(err)).catch(() => {});
  }
```
(dynamic import keeps the module unloaded when disabled; the `.catch` keeps error handling from ever throwing).

- [ ] **Step 4 (test):** one test: with `SENTRY_DSN` unset (test env), a route that throws still returns the sanitized 500 (i.e., the new branch doesn't break the path). Full suite green — expected **+1** (report exact). Lint clean.

- [ ] **Step 5:** Commit: `feat(server): optional env-gated sentry error tracking`.

---

### Task 6: Client widget hooks + components

**Files:**
- Modify: `client/src/api/hooks.ts` (add `useFeedPreview`, `useUpcomingEvents`)
- Create: `client/src/components/widgets/FeedPreviewWidget.tsx`, `EventsWidget.tsx`, `AnnouncementsWidget.tsx`, `QuickLinksWidget.tsx`, `WelcomeWidget.tsx`
- Test: `client/src/components/widgets/widgets.test.tsx` (one file, one render test per widget)

- [ ] **Step 1 (failing tests):** `widgets.test.tsx` — standard `vi.hoisted` api mock + `wrap()`; five tests:
  1. FeedPreviewWidget renders ≤5 feed item titles (mock `/feed` → `{pinned:[...], items:[...], nextCursor:null}`) and a "View all" link to `/feed`.
  2. EventsWidget renders the next occurrences' titles + a link to `/calendar` (mock `/events?...` → `{occurrences:[{event:{id,title},startAt,endAt}]}`).
  3. AnnouncementsWidget renders only pinned post titles, max 3, linking to `/board/:id` (mock `/posts?...` with 2 pinned + 2 unpinned).
  4. QuickLinksWidget renders settings quickLinks as external-safe anchors (target _blank rel noopener for http(s), router Link for '/'-prefixed).
  5. WelcomeWidget renders sanitized HTML (mock settings.welcomeMessage `<p><strong>Hi</strong></p>` → strong element present).

- [ ] **Step 2:** hooks —
```ts
export function useFeedPreview() {
  return useQuery({
    queryKey: ['feed', 'preview'],
    queryFn: async () => {
      const { data } = await api.get<{ pinned: FeedItem[]; items: FeedItem[] }>('/feed');
      return [...data.pinned, ...data.items].slice(0, 5);
    },
    staleTime: 60_000,
  });
}

export function useUpcomingEvents(days = 30, limit = 5) {
  const from = useMemo(() => new Date(), []);
  const to = useMemo(() => new Date(from.getTime() + days * 86_400_000), [from, days]);
  const q = useEvents(from.toISOString(), to.toISOString());
  return { ...q, data: q.data ? q.data.slice(0, limit) : undefined };
}
```
(`FeedItem` — reuse the type FeedPage uses; if it's currently inline in FeedPage, lift it to `api/types.ts` and have FeedPage import it. Report what you did. `useMemo` on dates keeps the query key stable for the component's lifetime.)

- [ ] **Step 3:** widgets — each a `Card` with an `<h2>` title, muted empty-state line, and a compact list; all rows 44px min, links via router `Link` (internal) or safe anchors (external). Follow DashboardPage's existing card style. WelcomeWidget renders `settings.welcomeMessage` via the established commented `dangerouslySetInnerHTML` pattern with the brand name heading (this REPLACES the current inline plain-text card in Task 7).

- [ ] **Step 4:** `npm -w client run test` — expected **+5** (→ 87, report exact). tsc + lint clean. Commit: `feat(client): dashboard widget components and preview hooks`.

---

### Task 7: Dashboard assembly driven by homepageLayout

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`, `client/src/pages/DashboardPage.test.tsx`

- [ ] **Step 1 (failing tests):** extend the dashboard test file (its mock already URL-switches; add `/feed`, `/events?`, `/posts?` branches returning empty shapes):
  1. default layout renders the widget order from settings (`homepageLayout: ['welcome','banners','myTasks']` mock → welcome card, banner region, my-tasks card appear; feed/events/announcements/quickLinks absent).
  2. a layout omitting `myTasks` hides the my-tasks card even when tasks exist.
  3. onboarding card still renders when incomplete regardless of layout.

- [ ] **Step 2:** rework `DashboardPage`: keep greeting `<h1>` always; onboarding card always-when-applicable; then map `settings?.homepageLayout ?? DEFAULT_LAYOUT` over a `Record<WidgetKey, () => JSX>` registry:
```tsx
const WIDGETS: Record<string, () => ReactNode> = {
  welcome: () => <WelcomeWidget key="welcome" />,
  banners: () => <BannerSlot key="banners" />,
  announcements: () => <AnnouncementsWidget key="announcements" />,
  myTasks: () => <MyTasksCard key="myTasks" />,   // extract the existing inline my-tasks card into a local component in this file
  events: () => <EventsWidget key="events" />,
  feed: () => <FeedPreviewWidget key="feed" />,
  quickLinks: () => <QuickLinksWidget key="quickLinks" />,
};
// unknown keys (future-proofing) are skipped:
{(settings?.homepageLayout ?? []).map((k) => WIDGETS[k]?.()).filter(Boolean)}
```
The old inline welcome/plain-text card is deleted (WelcomeWidget owns it now). My-tasks logic moves verbatim into the local `MyTasksCard`.

- [ ] **Step 3:** `npm -w client run test` — expected **+3, with the existing 3 dashboard tests updated as needed** (report exact; ~90). tsc + lint clean. Commit: `feat(client): homepage widgets driven by admin-configurable layout`.

---

### Task 8: Admin Homepage card (layout / welcome / quick links)

**Files:**
- Modify: `client/src/pages/admin/SettingsPage.tsx`, `client/src/pages/admin/SettingsPage.test.tsx`

- [ ] **Step 1 (failing tests):** extend SettingsPage tests (mirror its existing seed/save patterns; shallow-mock `RichTextEditor` to a labeled textarea as BannersPage.test does):
  1. Homepage card lists all seven widgets with enabled checkboxes reflecting `homepageLayout`, and Up/Down buttons reorder (assert the PATCH body's `homepageLayout` after a move + save).
  2. Disabling a widget removes it from the PATCHed array.
  3. Welcome editor + quick-links rows round-trip into the PATCH body (`welcomeMessage`, `quickLinks`).
  4. Add-quick-link row with an invalid URL blocks Save with a hint (mirror the RSS-feeds validation pattern).

- [ ] **Step 2:** implement one new "Homepage" `Card` in SettingsPage:
  - **Layout editor:** local state `layout: string[]` seeded via the page's existing `seedFrom`. Render ALL seven keys (a `WIDGET_LABELS` map with human names — mirror `HOMEPAGE_WIDGETS` from the server validator; keep the arrays in the same order); each row: checkbox (`aria-label` = `Show <label> widget`) toggling membership (append at end when re-enabled), Up/Down icon buttons (`aria-label` = `Move <label> up/down`, disabled at edges, only for enabled rows).
  - **Welcome message:** `RichTextEditor` (same usage as PostEditorPage) bound to `welcomeMessage` state; hint: "Shown on everyone's homepage. Existing plain-text messages need a re-save to format."
  - **Quick links:** label+URL input rows with Remove, "Add link" (max 12 per the validator); URL must start `http(s)://` or `/` — invalid blocks Save with a hint (extend the page's `canSave` chain).
  - All three feed the page's single `handleSave` body: `homepageLayout: layout`, `welcomeMessage`, `quickLinks`.

- [ ] **Step 3:** `npm -w client run test` — expected **+4** (report exact; ~94). tsc + lint clean. Commit: `feat(client): admin homepage layout, welcome message, and quick links editors`.

---

### Task 9: Admin notification defaults card

**Files:**
- Modify: `client/src/pages/admin/SettingsPage.tsx`, `client/src/pages/admin/SettingsPage.test.tsx`, `client/src/api/types.ts` (Settings type gains `notificationDefaults`, `homepageLayout` already present — verify)

- [ ] **Step 1 (failing tests):** two tests: (1) the card lists the notification types with toggles seeded from `settings.notificationDefaults` (unset = on), and `taskOverdue` renders disabled with "always sent" text; (2) toggling one off lands `notificationDefaults: { postPublished: false, ... }` in the PATCH body.

- [ ] **Step 2:** new "Email notification defaults" `Card`: rows per notification type (label map with human copy — e.g. `postPublished` → "Important announcements"; check the Notification enum for the full list and write sensible labels), checkbox per row (`aria-label` = `Email agents about <label> by default`), `taskOverdue` row locked (disabled checkbox, checked, hint "Required — overdue task emails cannot be disabled"). Hint under the card title: "Applies to agents who haven't set their own preference. Personal settings on a profile always win."

- [ ] **Step 3:** `npm -w client run test` — expected **+2** (report exact; ~96). Commit: `feat(client): brokerage-wide notification defaults editor`.

---

### Task 10: pageView emission (client)

**Files:**
- Modify: `client/src/components/AppShell.tsx`
- Test: extend `client/src/components/AppShell.test.tsx`

- [ ] **Step 1 (failing test):** AppShell test: rendering at an initial route posts `/engagement/page-view` with `{path}` once; a rerender at the same path does NOT double-post (mock `api.post`; the existing shell tests' router setup may need `MemoryRouter initialEntries`).

- [ ] **Step 2:** in `AppShell`, after the accent effect:
```tsx
  const location = useLocation();
  const lastPath = useRef<string>();
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    // Fire-and-forget engagement beacon (PRD 6.3 note): errors are irrelevant to UX.
    void api.post('/engagement/page-view', { path: location.pathname }).catch(() => {});
  }, [location.pathname]);
```

- [ ] **Step 3:** `npm -w client run test` — expected **+1** (report exact; ~97). Commit: `feat(client): pageView engagement beacon on navigation`.

---

### Task 11: Focus management — sidebar overlay + notifications drawer

**Files:**
- Create: `client/src/hooks/useFocusTrap.ts`
- Modify: `client/src/components/AppShell.tsx`, `client/src/components/NotificationsDrawer.tsx`
- Test: `client/src/hooks/useFocusTrap.test.tsx` (new) + extend `AppShell.test.tsx`

- [ ] **Step 1 (failing tests):**
  1. `useFocusTrap.test.tsx`: renders a trap container with two buttons + an outside button; when active: focus moves to the first focusable on activate; Tab from the last wraps to the first; Shift+Tab from the first wraps to the last; Escape calls `onEscape`; on deactivate focus returns to the previously-focused element.
  2. AppShell test (narrow-mode): with the store forced open at ≤880px equivalent (set the store state directly in the test), a scrim element exists (`aria-hidden`, click closes) and Escape closes the sidebar.

- [ ] **Step 2:** `useFocusTrap.ts`:
```ts
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Contains Tab focus inside `ref` while `active`; Escape calls onEscape; restores focus on deactivate. */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean, onEscape: () => void) {
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      restoreRef.current?.focus();
    };
  }, [active, ref, onEscape]);
}
```

- [ ] **Step 3:** AppShell — track narrow mode (`window.matchMedia('(max-width: 880px)')`, listener-updated state); when `sidebarOpen && narrow`: render a scrim `<div>` (fixed, `rgba(0,0,0,.4)`, zIndex below the sidebar, `onClick={toggleSidebar}`, `aria-hidden="true"`) and apply `useFocusTrap(sidebarRef, sidebarOpen && narrow, toggleSidebar)` to the sidebar `<nav>`. Desktop behavior unchanged (no trap, no scrim). NotificationsDrawer — replace its hand-rolled Escape/initial-focus/restore effect with the hook (delete the superseded code + the "deferred alongside the sidebar-overlay backlog item" comment).

- [ ] **Step 4:** `npm -w client run test` — expected **+3 or more** (report exact; ~100). tsc + lint clean. Commit: `feat(client): focus trapping and scrim for sidebar overlay and notifications drawer`.

---

### Task 12: Calendar grid semantics + keyboard navigation

**Files:**
- Modify: `client/src/pages/CalendarPage.tsx`
- Test: extend `client/src/pages/CalendarPage.test.tsx`

- [ ] **Step 1 (failing tests):**
  1. month view renders `role="grid"` with 7 `columnheader`s (day names) and day cells as `gridcell`s.
  2. ArrowRight from a focused day cell moves focus to the next day; ArrowDown moves +7 (assert `document.activeElement` on the target cell's `aria-label` — give each cell `aria-label` like "July 15, 2 events").
  3. Only one day cell is tabbable at a time (roving tabindex: today or the 1st of the visible month has `tabIndex=0`, others −1).

- [ ] **Step 2:** implement in the month grid: wrap week rows in `role="row"`, headers `role="columnheader"`, cells `role="gridcell"` + `aria-label` (date + event count), roving `tabIndex` with a `focusedDay` state, `onKeyDown` on the grid handling Arrow keys (±1/±7 days, clamped to the visible month or moving month if you can do it cheaply — clamping is acceptable; state which), Enter/Space activates the cell's first event chip or "+N more" if present. Keep all existing mouse/event-chip behavior untouched. Week/day views are out of scope.

- [ ] **Step 3:** `npm -w client run test` — expected **+3** (report exact; ~103). tsc + lint clean. Commit: `feat(client): calendar month grid semantics and arrow-key navigation`.

---

### Task 13: Code-splitting, client Sentry, cleanups

**Files:**
- Modify: `client/src/App.tsx` (lazy routes), `client/src/main.tsx` (Sentry), `client/package.json` (dep), `client/src/components/BannerSlot.tsx` (comment), `client/src/api/hooks.ts` (dead `remove`)

- [ ] **Step 1:** `npm -w client i @sentry/react` (report the added dep). `main.tsx`, before render:
```ts
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  // Dynamically imported so the bundle pays nothing when disabled.
  void import('@sentry/react').then((S) => S.init({ dsn: sentryDsn }));
}
```

- [ ] **Step 2:** App.tsx — convert every authenticated page import to `const X = lazy(() => import('./pages/X').then(m => ({ default: m.X })));` (named exports need the `.then` mapping). Login/Register stay eager. Wrap the `<Routes>` (or the shell's Outlet subtree) in `<Suspense fallback={<Spinner />}>`. Run `npm -w client run build` and record the chunk report: the entry chunk must be **< 500 kB** (expect TipTap/editor pages to split out). Paste the before/after sizes in your report.

- [ ] **Step 3:** cleanups: fix the `BannerSlot.tsx` comment (`sanitizePostHtml` → `sanitizeBannerHtml`); delete the unused `remove` mutation from `useResourceMutations` (grep first to confirm zero call sites; report).

- [ ] **Step 4:** full client suite + tsc + lint green (lazy routes can break tests that import pages directly — they import the module, not the route, so expect no breakage; investigate if any). Root `npm test` fully green. Commit: `perf(client): route-level code splitting; optional sentry; stage 4 cleanups`.

---

### Task 14: Finish — deployment runbook, docs, verification, smoke, PR

**Files:**
- Create: `docs/deploy.md`
- Modify: `README.md` (status + env table + docs links), `docs/superpowers/plans/2026-07-09-roadmap.md` (Stage 5 heading plan link)

- [ ] **Step 1: `docs/deploy.md`** — the full runbook, factual and step-by-step: Render web service (repo, build `npm ci && npm run build`, start `npm start`, health check `/api/v1/health`); complete env table (everything in `.env.example` incl. `NODE_ENV=production`, both Sentry keys, non-SRV `MONGODB_URI` note with the SRV-DNS gotcha called out); MongoDB Atlas M0 (network access, non-SRV string retrieval); R2 setup (public bucket + `R2_PUBLIC_BASE_URL`, private bucket `R2_PRIVATE_BUCKET`, token scopes); Resend (domain verify, `EMAIL_FROM`); Turnstile (both keys); UptimeRobot pinger on `/api/v1/health` (5-min interval, 750-free-hours math); first-boot `npm run seed` via Render shell or a one-off job; post-deploy verification checklist (login, invite email arrives, upload → R2 object visible, banner renders). Link it from README's Deployment section (replace "A full deployment runbook lands in Stage 5").

- [ ] **Step 2: README** — Status paragraph gains Stage 5 (configurable homepage dashboard, notification defaults, retention jobs, pageView analytics, accessibility hardening, code-split bundle, optional Sentry, deployment runbook — phrase to match the existing voice, then state Phase 1 scope is complete); env table gains `SENTRY_DSN`/`VITE_SENTRY_DSN` row in Optional; Docs list gains this plan + `docs/deploy.md`. Roadmap heading becomes `## Stage 5 — Polish & Launch ✦ plan: \`2026-07-11-stage-5-polish-launch.md\``.

- [ ] **Step 3: Full verification** — root `npm run lint`; server typecheck + test; client tsc + test; `npm run build`. Report all exact counts (expected ≈ server 219+ / client 103+ per the task deltas — reconcile any variance to specific approved fix tests).

- [ ] **Step 4: Live smoke (controller runs — ephemeral in-memory Mongo + throwaway creds + STORAGE_DRIVER=local; kill stale daemons on 3000/5173 first).** Headline flows:
  1. Broker reorders the homepage (move quickLinks to top, disable feed) in Admin → Settings → dashboard reflects the new order for the agent too.
  2. Welcome message saved with bold + a link renders formatted on the dashboard.
  3. Quick links tile opens externally; pinned announcement (pin a post) shows in the announcements widget; upcoming event shows in the events widget; feed preview shows 5 with View-all.
  4. Navigating 3 pages as the agent → 3 `pageView` engagement events with correct paths in the DB.
  5. Notification default off (postPublished) + agent with no personal pref → publishing an important post logs NO email in the console driver; agent with explicit pref ON still gets one.
  6. Retention: seed one 91-day-old activity event / 31-day-old RSS item / 25-month-old completed task via script, run `sweepRetention()` directly, confirm deletions + kept guards.
  7. Keyboard pass: narrow-viewport sidebar — open, Tab wraps inside, Escape closes, focus returns; notifications drawer same; calendar month grid arrow-key navigation.
  8. `npm run build` chunk report: entry < 500 kB.
  9. Prod-mode boot (compiled, NODE_ENV=production, in-memory Mongo): SPA + health + a lazy route loads (chunk fetch works under the static server).

- [ ] **Step 5:** Commit docs (`docs: stage 5 notes, deployment runbook, roadmap link`), then controller: final whole-branch review → push → PR into main titled "Stage 5 — Polish & Launch".

---

## Deferred / carried backlog (NOT this stage — Phase 2 or explicit user request)

- Group targeting, Insights dashboard, transactions/TC/external roles, eSignature, calendar external sync → PRD Phase 2.
- Carried engineering notes: dummy-scrypt timing hardening on login; accent default triplication; RR v7 future flags; admin-set avatar route; task DELETE / complete-on-behalf client UI; hub live-search vs board submit-search consistency (deliberate divergence unless the user objects); grouped onboarding notifications.

## Execution notes for the controller

- Same protocol as Stages 2–4: fresh implementer per task → spec review → quality review → fix rounds → final whole-branch review → live smoke → PR.
- Implementers on Tasks 6–12 MUST read the named real files before writing (hooks shapes, SettingsPage seed/save flow, DashboardPage card style, CalendarPage grid markup, existing test mock helpers).
- Machine gotchas: MONGODB_URI stays non-SRV; kill stale tsx/vite daemons on 3000/5173; smoke uses throwaway env only (real `.env` has `STORAGE_DRIVER=r2`); injected git-status snapshots are stale — subagents run git themselves.
