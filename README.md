# Brokerage Workspace

A single-tenant intranet for a real estate brokerage — announcements, shared calendar, resource hub, tasks, and staff onboarding in one workspace. TypeScript MERN monorepo (Express API + React SPA), designed to run for free on Render's free tier, MongoDB Atlas M0, and Cloudflare R2.

**Status:** Stage 1 (Foundation) complete — auth & invitations, user management, staff directory/profiles, brokerage settings & branding, and the admin panel are built and tested. Stages 2–5 (communications, calendar/tasks, resource hub/banners, dashboard & polish) are tracked in [docs/superpowers/plans/2026-07-09-roadmap.md](docs/superpowers/plans/2026-07-09-roadmap.md).

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

- Add all required/optional env vars in the dashboard (never commit `.env`).
- Render's disk is ephemeral — set `STORAGE_DRIVER=r2` with the R2 variables above so uploads survive redeploys.
- Free instances sleep after idle. A free [UptimeRobot](https://uptimerobot.com/) monitor pinging `/api/v1/health` keeps the service awake, comfortably within Render's 750 free hours/month.

A full deployment runbook lands in Stage 5.

## Docs

- [workspace_prd_v2.md](workspace_prd_v2.md) — product requirements
- [docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md](docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md) — approved design spec & decisions log
- [docs/superpowers/plans/2026-07-09-roadmap.md](docs/superpowers/plans/2026-07-09-roadmap.md) — five-stage delivery roadmap
- [docs/superpowers/plans/2026-07-09-stage-1-foundation.md](docs/superpowers/plans/2026-07-09-stage-1-foundation.md) — Stage 1 implementation plan
- [DESIGN.md](DESIGN.md) — authoritative UI/UX reference
