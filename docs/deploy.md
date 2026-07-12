# Deployment Runbook

The app is a single Node service: it builds the React SPA and Express API together, then
serves both from one process. This runbook walks through a from-scratch deploy on Render,
MongoDB Atlas, and Cloudflare R2 — the stack the app is designed for on free tiers.

## 1. Render web service

1. Push the repo to GitHub (or GitLab/Bitbucket) if it isn't already.
2. In the Render dashboard: **New → Web Service**, connect the repo, pick the branch to deploy (`main`).
3. Runtime: **Node**. Set:
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start` (runs `node server/dist/src/index.js`)
   - **Node version:** 20 or later (the repo's `engines.node` requires `>=20`).
4. **Health Check Path:** `/api/v1/health`.
5. Do not set env vars yet — add them all in one pass using the table below, then trigger the first deploy.

## 2. Environment variables

Set every variable in the Render dashboard's **Environment** tab. Never commit `.env` or paste secrets into source control — `.env.example` in the repo root documents the same list without values.

### Required

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | Set to `production`. Enables SPA serving (the Express app serves the built client), the Helmet security headers/CSP, and secure (HTTPS-only) session cookies. |
| `MONGODB_URI` | Connection string for the app database. **Must be the standard non-SRV `mongodb://` form** — see the DNS gotcha below. |
| `SESSION_SECRET` | Session-signing secret, minimum 16 characters. Generate a random string; do not reuse across environments. |
| `APP_DOMAIN` | The real public origin of the deployed service (e.g. `https://yourapp.onrender.com` or a custom domain). Used to build links in emails, most notably invitation links — if this is wrong, invited users get broken links. |
| `PORT` | Render sets this automatically; you generally don't need to set it yourself. The app reads `PORT` and defaults to `3000` if unset. |

**MongoDB SRV DNS gotcha:** Atlas's "Connect" dialog defaults to giving you a `mongodb+srv://...` connection string, which relies on a DNS SRV lookup at connect time. Some networks and container/hosting environments fail this lookup with an error like `querySrv ECONNREFUSED`. Avoid the whole class of failure by using the **non-SRV** form instead: in Atlas, go to **Connect → Drivers**, then look for the toggle/link to the standard connection string (it lists all shard hosts directly as `mongodb://host1,host2,host3/...` instead of using SRV). Use that string for `MONGODB_URI`.

### Storage (Cloudflare R2)

Render's disk is ephemeral — anything written to local disk is lost on redeploy or restart. Set `STORAGE_DRIVER=r2` in production so uploads persist in R2 instead.

| Variable | Notes |
| --- | --- |
| `STORAGE_DRIVER` | Set to `r2` in production. If unset (defaults to `local`), uploads go to local disk — fine for local dev only. |
| `R2_ENDPOINT` | Your Cloudflare R2 S3-compatible endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2_ACCESS_KEY_ID` | Access key ID from an R2 API token. |
| `R2_SECRET_ACCESS_KEY` | Secret access key from the same token. |
| `R2_BUCKET` | The **public** bucket — logos, avatars, banner images, and other publicly-servable assets. |
| `R2_PUBLIC_BASE_URL` | The public base URL for `R2_BUCKET` (its custom domain or R2 public-access URL). Public object URLs are built as `{R2_PUBLIC_BASE_URL}/{key}`. |
| `R2_PRIVATE_BUCKET` | The **private** bucket — resources and task attachments. Downloads are served through short-lived (15-minute) presigned URLs, never a public URL. This bucket must have **no public access** configured. |

See the R2 setup section below for how to create the buckets and token.

### Email (Resend)

| Variable | Notes |
| --- | --- |
| `RESEND_API_KEY` | API key from Resend. Without a key, production **sends no email at all** — invitation and other notification endpoints still respond, but report `emailSent: false`. |
| `EMAIL_FROM` | The verified sender address (see Resend setup below). Defaults to `workspace@localhost`, which will fail to send in production. |

### Bot protection (Cloudflare Turnstile)

| Variable | Notes |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | Server-side secret key. Without it, Turnstile verification is skipped (checks pass through) — fine for internal testing, not recommended for a public-facing form in production. |
| `VITE_TURNSTILE_SITE_KEY` | Client-side site key. **This is a build-time variable** — Vite inlines it into the built JS bundle. Set it in Render's environment *before* the build runs (Render applies env vars to both build and runtime by default), or the deployed client will have no site key baked in. |

### Error tracking (optional)

| Variable | Notes |
| --- | --- |
| `SENTRY_DSN` | Server-side Sentry DSN. When set, the server initializes Sentry at boot and captures exceptions in the 500 error-handling path. Leave empty to disable — the server never loads the Sentry SDK when unset. |
| `VITE_SENTRY_DSN` | Client-side Sentry DSN. Like the Turnstile site key, this is inlined **at build time** by Vite — set it before building. Leave empty to disable; the client never imports `@sentry/react` when unset, so the bundle pays nothing for it. |

### Seed-time only (not needed at runtime)

These are only read by `npm run seed` (see "First boot" below), not by the running server.

| Variable | Notes |
| --- | --- |
| `SEED_BROKER_EMAIL` | Email for the first Broker/Owner account. |
| `SEED_BROKER_PASSWORD` | Password for that account. |
| `SEED_BROKER_NAME` | Optional display name (defaults to `Broker`). |
| `SEED_BRAND_NAME` | Optional brokerage brand name. |

## 3. MongoDB Atlas (M0 free tier)

1. Create a free **M0** cluster in Atlas.
2. **Network Access:** add an IP allowlist entry. The simplest option for a Render deployment is `0.0.0.0/0` (allow from anywhere) since Render's outbound IPs aren't static on free/starter plans; if you're on a paid Render plan with static outbound IPs, allowlist those specific IPs instead for tighter security.
3. **Database Access:** create a database user with a strong password, scoped to the app's database.
4. **Get the connection string:** Atlas → **Connect** → **Drivers** → select Node.js. Atlas shows the `mongodb+srv://` form by default — use the non-SRV alternative instead (see the DNS gotcha above) and substitute in your database user's username/password. Set the result as `MONGODB_URI`.

## 4. Cloudflare R2 setup

1. In the Cloudflare dashboard, go to **R2** and create **two buckets**:
   - A **public** bucket (e.g. `brokerage-public`) — for logos, avatars, banner images.
   - A **private** bucket (e.g. `brokerage-private`) — for resources and task attachments.
2. **Public bucket:** enable public access and attach either R2's own public development URL or a custom domain. Use whichever URL R2 gives you as `R2_PUBLIC_BASE_URL` (no trailing slash).
3. **Private bucket:** leave it with no public access and no custom domain — the app only ever accesses it via signed S3 API calls, never a public URL. Set its name as `R2_PRIVATE_BUCKET`.
4. **API token:** create an R2 API token with **Object Read & Write** permission, scoped to both buckets (public and private). Use the resulting Access Key ID / Secret Access Key as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, and the account's R2 S3 API endpoint as `R2_ENDPOINT`.

## 5. Resend (email)

1. Add and verify your sending domain in the Resend dashboard (DNS records for SPF/DKIM).
2. Create an API key and set it as `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on the verified domain (e.g. `notifications@yourdomain.com`).

## 6. Cloudflare Turnstile (bot protection)

1. Create a Turnstile widget in the Cloudflare dashboard for your production domain.
2. Set the **Site Key** as `VITE_TURNSTILE_SITE_KEY` (build-time, client-side) and the **Secret Key** as `TURNSTILE_SECRET_KEY` (runtime, server-side).
3. Remember: because `VITE_TURNSTILE_SITE_KEY` is inlined at build time, changing it later requires a rebuild, not just a restart.

## 7. UptimeRobot (keep-awake)

Render's free tier sleeps services after a period of inactivity, and gives 750 instance-hours/month — enough for one service to run always-on (24 hours × ~31 days ≈ 744 hours), but only if something keeps pinging it so it never goes idle long enough to spin down, and never exceeds the monthly hour budget by running multiple free services simultaneously.

1. Create a free [UptimeRobot](https://uptimerobot.com/) account.
2. Add an **HTTP(s)** monitor pointed at `https://<your-app-domain>/api/v1/health`.
3. Set the check interval to **5 minutes** (the free plan's minimum).

## 8. First boot: seeding

The database starts empty — no brokerage settings, no users. After the first successful deploy:

1. Set `SEED_BROKER_EMAIL`, `SEED_BROKER_PASSWORD` (and optionally `SEED_BROKER_NAME`, `SEED_BRAND_NAME`) as env vars.
2. Run `npm run seed` once, either via Render's **Shell** tab on the service, or as a Render **one-off Job** using the same build output.
3. This creates the Settings singleton and the first Broker/Owner account. Log in with `SEED_BROKER_EMAIL` / `SEED_BROKER_PASSWORD` and invite the rest of the team from there.

You can remove the `SEED_*` env vars afterward if you like — they're only read by the seed script, not the running server.

## 9. Background jobs (Agenda)

The server runs scheduled jobs in-process via Agenda:

- **RSS ingestion** — polls configured feeds hourly.
- **Reminders / task sweeps** — every 15 minutes (event reminders, overdue-task checks).
- **Retention sweep** — daily: deletes activity events older than 90 days (unless still pinned), RSS items older than 30 days, and completed tasks older than 2 years (unless actively recurring).

**Known limitation:** RSS retention is keyed off ingestion time, not the feed's own publish time. If a feed still lists an item after the 30-day retention window deletes it from the database, the next hourly poll will re-ingest it as if it were new — it will reappear in the activity feed. This only affects feeds whose upstream retains items longer than 30 days.

## 10. Post-deploy verification checklist

Run through this after every fresh deploy (and after any deploy touching auth, storage, or email):

- [ ] Log in as the seeded Broker account.
- [ ] Send an invitation to a test address → confirm the email arrives → register through the invite link.
- [ ] Upload a resource file → confirm the object appears in the **private** R2 bucket → confirm the download link works (presigned URL, 15-minute expiry).
- [ ] Upload a logo (or banner image) → confirm the object appears in the **public** R2 bucket and renders via `R2_PUBLIC_BASE_URL`.
- [ ] Confirm a banner renders on the dashboard.
- [ ] Check the UptimeRobot dashboard shows consistent 200 responses from `/api/v1/health`.
