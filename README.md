# Brokerage Workspace

A single-tenant intranet for a real estate brokerage — announcements, shared calendar, resource hub, tasks, and staff onboarding in one workspace. TypeScript MERN monorepo (Express API + React SPA), designed to run for free on Render's free tier, MongoDB Atlas M0, and Cloudflare R2.

**Status:** Stage 1 (Foundation) complete — auth & invitations, user management, staff directory/profiles, brokerage settings & branding, and the admin panel are built and tested. Stage 2 (Communications) complete — message board with rich-text announcements and comments, in-app + email notifications, and an activity feed with hourly RSS ingestion are built and tested. Stage 3 (Coordination) complete — shared calendar with RSVPs, reservable resources, and reminders; task management with templates, recurrence, and attachments; and structured onboarding are built and tested. Stage 4 (Content) complete — a resource hub with two-level categories, file (≤50MB, versioned) or link resources, office targeting, keyword search and filters, up to 6 featured tiles, bookmarks with a My Resources view, signed-URL downloads with engagement logging, and "new resource in a category I follow" notifications; and banner ads with image or rich-text homepage banners, CTAs, scheduling, office targeting, 5-second rotation when more than three are live, and click tracking visible in the admin view are built and tested. Stage 5 (Polish & Launch) complete — a configurable homepage dashboard with admin editors for widget layout, welcome message, and quick links; brokerage-wide notification defaults; `pageView` engagement analytics; retention jobs for activity/RSS/task history; an accessibility hardening pass covering focus management and calendar keyboard navigation; a code-split client bundle; optional Sentry error tracking; and a deployment runbook are built and tested. **Phase 1 of the PRD is complete.**

## Quick start

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the variables below.
3. `npm run seed` — creates the brokerage settings singleton and the first Broker account.
4. `npm run dev` — API on `:3000`, app on http://localhost:5173.

Prerequisites: Node 20+, a MongoDB instance (Atlas M0 free tier or local).

## Environment variables

### Required

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | Connection string for the app database. |
| `SESSION_SECRET` | Session-signing secret, minimum 16 characters. |
| `APP_DOMAIN` | Base URL used to build links (e.g. invitation emails). Defaults to `http://localhost:5173` for local dev; set to your real origin in production. |
| `NODE_ENV` | Set to `production` on your deployment host. Enables SPA serving, the security headers (CSP), and secure session cookies. Leave unset in local dev. |

### Seed-time (used only by `npm run seed`)

| Variable | Notes |
| --- | --- |
| `SEED_BROKER_EMAIL` | Email for the first Broker/Owner account. |
| `SEED_BROKER_PASSWORD` | Password for that account. |
| `SEED_BROKER_NAME` | Optional display name (defaults to `Broker`). |
| `SEED_BRAND_NAME` | Optional brokerage brand name. |

### Optional integrations (all off by default)

| Variable | Behavior when unset |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM` | Without a key, emails are logged to the server console in development; in production they are **not sent** and invitation endpoints report `emailSent: false`. |
| `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` | Bot protection is disabled (Turnstile checks pass through) when unset. |
| `STORAGE_DRIVER=r2` + `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Without `STORAGE_DRIVER=r2`, uploads are written to local disk. Fine for dev; production hosts with ephemeral disks (e.g. Render free tier) need R2 for uploads to persist. |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Error tracking is disabled when unset — the server never initializes Sentry and the client never loads `@sentry/react`. |

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and client dev servers together. |
| `npm test` | Run server and client test suites. |
| `npm run lint` | Lint the whole repo. |
| `npm run build` | Build server and client for production. |
| `npm start` | Serve the built API + SPA from a single process on `PORT`. |
| `npm run seed` | Create the brokerage settings singleton and first Broker account. |

## Repo layout

```text
client/    React SPA (pages, components, UI primitives, hooks)
server/    Express API — config, middleware, models, routes, services, validators, utils, scripts, tests
docs/      ADRs, specs, and delivery plans (docs/superpowers/)
DESIGN.md  Authoritative reference for UI/UX decisions
```

## Deployment

The app builds and runs as a single service: `npm run build` then `npm start` serves both the API and the SPA on `PORT`. On Render's free tier:

- Set `NODE_ENV=production` plus all required/optional env vars in the dashboard (never commit `.env`).
- Render's disk is ephemeral — set `STORAGE_DRIVER=r2` with the R2 variables above so uploads survive redeploys.
- Free instances sleep after idle. A free [UptimeRobot](https://uptimerobot.com/) monitor pinging `/api/v1/health` keeps the service awake, comfortably within Render's 750 free hours/month.

See [docs/deploy.md](docs/deploy.md) for the full deployment runbook.

## Docs

- [workspace_prd_v2.md](workspace_prd_v2.md) — product requirements
- [docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md](docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md) — approved design spec & decisions log
- [docs/superpowers/plans/2026-07-09-roadmap.md](docs/superpowers/plans/2026-07-09-roadmap.md) — five-stage delivery roadmap
- [docs/superpowers/plans/2026-07-09-stage-1-foundation.md](docs/superpowers/plans/2026-07-09-stage-1-foundation.md) — Stage 1 implementation plan
- [docs/superpowers/plans/2026-07-10-stage-2-communications.md](docs/superpowers/plans/2026-07-10-stage-2-communications.md) — Stage 2 implementation plan
- [docs/superpowers/plans/2026-07-10-stage-3-coordination.md](docs/superpowers/plans/2026-07-10-stage-3-coordination.md) — Stage 3 implementation plan
- [docs/superpowers/plans/2026-07-11-stage-4-content.md](docs/superpowers/plans/2026-07-11-stage-4-content.md) — Stage 4 implementation plan
- [docs/superpowers/plans/2026-07-11-stage-5-polish-launch.md](docs/superpowers/plans/2026-07-11-stage-5-polish-launch.md) — Stage 5 implementation plan
- [docs/deploy.md](docs/deploy.md) — deployment runbook
- [DESIGN.md](DESIGN.md) — authoritative UI/UX reference
