# Brokerage Workspace

Single-tenant real estate brokerage intranet — announcements, shared calendar, resource hub, tasks, and onboarding for one brokerage. Free to run: Render free tier + MongoDB Atlas M0 + Cloudflare R2 free tier.

**Status:** planning complete; Stage 1 (Foundation) ready for implementation.

| Document | Purpose |
| --- | --- |
| [workspace_prd_v2.md](workspace_prd_v2.md) | Product requirements (Phase 1 scope) |
| [docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md](docs/superpowers/specs/2026-07-09-brokerage-workspace-design.md) | Approved design spec & decisions log |
| [docs/superpowers/plans/2026-07-09-roadmap.md](docs/superpowers/plans/2026-07-09-roadmap.md) | Five-stage delivery roadmap |
| [docs/superpowers/plans/2026-07-09-stage-1-foundation.md](docs/superpowers/plans/2026-07-09-stage-1-foundation.md) | Stage 1 implementation plan |
| DESIGN.md (created in Stage 1) | Authoritative UI/UX reference |

## Quick start (after Stage 1 lands)

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `MONGODB_URI`, `SESSION_SECRET`, and the `SEED_*` values.
3. `npm run seed` — creates brokerage settings and the first Broker/Owner account.
4. `npm run dev` — API on :3000, app on http://localhost:5173.
