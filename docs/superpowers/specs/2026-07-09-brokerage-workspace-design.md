# Brokerage Workspace — Design Spec

**Date:** 2026-07-09
**Status:** Approved (chat, 2026-07-09)
**Feature source of truth:** `workspace_prd_v2.md` (PRD v2.0), Phase 1 scope, as amended below.

This spec records the approved deltas and architecture decisions. Where this document is silent, the PRD governs.

## 1. Approved Deltas from the PRD

The product is **free and single-client**. This removes:

- **Multi-tenancy** — no `tenantId` fields, no tenant-scoping middleware, no subdomain routing, no wildcard DNS, no "brokerage not found" page. One `Settings` singleton document holds all brokerage configuration (brand name, logo, accent color, offices, RSS feeds, homepage layout, onboarding template).
- **Stripe / billing** — removed entirely, including `subscriptionStatus`.
- **Super Admin role & console** — removed. A one-time idempotent seed script creates the Settings document and the first Broker/Owner account.

Everything else in PRD Phase 1 (sections 5.1–5.10) ships unchanged.

## 2. Decisions Log (from PRD Section 11 + follow-ups)

| # | Question | Decision |
|---|----------|----------|
| 1 | Billing | None. Free product. |
| 2 | Super Admin console | Not built; seed script instead. |
| 3 | Multi-office agents | One office per agent (`officeId`, nullable). |
| 4 | Comment moderation | Comments post immediately; author/admin can delete retroactively. |
| 5 | Leaderboard widget | Out of scope. |
| 6 | Timezones | All datetimes stored UTC; rendered in viewer's browser timezone. Office `timezone` kept for display context. |
| 7 | Retention | Internal activity events 90 days, RSS items 30 days, task history 2 years. Everything else indefinite. |
| 8 | Calendar resource reservation | In scope, Phase 1, per PRD 5.4.2. |
| — | Language | TypeScript strict, client and server. |
| — | Architecture | Fully single-tenant (no dormant tenant plumbing). |
| — | Hosting | $0: Render free web service + MongoDB Atlas M0 + Cloudflare R2 free tier + Resend free tier + Turnstile. |
| — | Job queue | Agenda (MongoDB-backed persistent queue with retries). No Redis. |
| — | Roles | Enum: `broker`, `officeAdmin`, `agent`, plus dormant `tc`, `external` (Phase 2). No Super Admin. |

## 3. Architecture

- **One Render service.** Express (TypeScript, ESM) serves `/api/v1` and, in production, the built React SPA with an SPA fallback route.
- **Monorepo** via npm workspaces: `client/`, `server/` (config, middleware, models, routes, services, validators, utils, scripts), `docs/`. A `shared/` package is added only when something real needs sharing (YAGNI).
- **Auth:** `express-session` + `connect-mongo`, `crypto.scrypt` password hashing with `timingSafeEqual` comparison, session regeneration on login, invite-only registration (7-day tokenized links, tokens stored as SHA-256 hashes), Turnstile verification env-gated (off when no secret configured), MongoDB sliding-window rate limiting on public auth endpoints.
- **Validation:** Zod on every request body via a `validate(schema)` middleware, before business logic. Structured 400 responses.
- **Storage:** `StoragePort` adapter — local disk in dev (served at `/files`), Cloudflare R2 in production. Public assets (logo, avatars, banner/post images) use public URLs; protected files (resources, attachments — Stage 4) use 15-minute signed URLs.
- **Email:** Resend when `RESEND_API_KEY` is set, console transport otherwise. User email preferences honored (PRD 5.9.3).
- **Background jobs (Stage 2+):** Agenda. RSS polling hourly, reminder scans, recurring-task spawner, retention cleanup. All jobs idempotent with catch-up-on-boot because the free host sleeps; a free uptime pinger (UptimeRobot, 5-min interval) keeps the service awake within Render's 750 free instance-hours/month.
- **Engagement logging from day one:** `EngagementEvents` collection records `login`, `pageView`, `download`, `taskComplete`, `bannerClick` (PRD 6.3 architecture note), even though the Insights dashboard is Phase 2.
- **Frontend:** React 18 + Vite + TypeScript, React Router 6, TanStack Query 5 (server state), Zustand (UI state), shared Axios instance (`withCredentials`), TipTap rich text (sanitized server-side, Stage 2), Lucide icons. Brokerage accent color applied via CSS custom property at runtime. WCAG 2.1 AA: visible focus states, 44px touch targets, keyboard navigable.
- **Observability:** Sentry and PostHog wired but optional — active only when DSN/key env vars are present.

## 4. Delivery Stages

Each stage ends usable and testable; each gets its own implementation plan.

1. **Foundation** — tooling, CI, auth, invitations, user management, brokerage settings, uploads (logo/avatar), seed script, branded app shell, login/registration, directory, profile, admin Users + Settings pages.
2. **Communications** — message board + comments, notification system (in-app bell + email prefs), activity feed (internal events), RSS ingestion job, "invitation accepted" notification trigger.
3. **Coordination** — calendar (month/week/day, RSVP, reservable resources with conflict check, reminders, mandatory events), tasks (templates, recurrence, per-assignee completion, reminders, overdue), onboarding auto-assignment + progress bar.
4. **Content** — resource hub (categories, versioning, bookmarks, featured, download tracking, signed URLs), banner ads (scheduling, rotation, click tracking).
5. **Polish** — dashboard widget assembly + admin homepage layout config (incl. welcome message + quick links editors), engagement `pageView` logging, retention jobs, accessibility pass, deploy docs (Render + R2 + UptimeRobot).

## 5. Environment

All configuration via env vars, documented in `.env.example`. Currently present in `.env`: `APP_DOMAIN`, `MONGODB_URI`. Required additionally before first run: `SESSION_SECRET`; for seeding: `SEED_BROKER_EMAIL`, `SEED_BROKER_PASSWORD`. All third-party keys optional in development (console email, local storage, Turnstile off).
