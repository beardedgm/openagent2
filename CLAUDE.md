# Universal Project Agent Instructions

This file is the primary developer reference for this repository. Read it in full before writing any code.

This universal version is **Node/React-first**. It assumes a modern web application built with Node.js, Express, React, and MongoDB unless explicitly overridden below. When a project includes a `DESIGN.md`, that file is authoritative for all UI, visual, interaction, and UX decisions.

For product overview, setup notes, and user-facing documentation, see `README.md`. For environment variables, see `.env.example`.

---

## Core Philosophy

1. **One source of truth per concern.** Each important domain should have one authoritative file, module, or config location.
2. **Prefer explicit conventions over flexibility.** Do not invent new patterns when an existing one already works in the repo.
3. **Security and billing logic are server-enforced.** Never trust the client for permissions, subscription state, or protected business rules.
4. **Keep architecture boring and durable.** Choose proven tools, clear structure, and maintainable defaults over novelty.
5. **Capture hard-earned lessons.** Encode known gotchas in this file rather than rediscovering them.

---

## Default Stack

Use these as defaults unless the repository says otherwise.

### Backend
- **Node.js 20+**
- **Express.js** for HTTP APIs
- **MongoDB Atlas** with **Mongoose**
- **Session-based auth** — sessions stored in MongoDB via connect-mongo
- **Stripe** for billing, webhooks, and customer portal
- **Cloudflare R2** for object storage when files or media are involved
- **Cloudflare Turnstile** for public form bot protection
- **Resend** for transactional email
- **Helmet** for security headers
- **Pino** for structured logging

### Frontend
- **React 18+**
- **Vite** (no Next.js unless explicitly documented)
- **React Router** for routing
- **TanStack Query** for server state
- **Zustand** for client state
- **Axios** with `withCredentials: true` for all requests
- **Zod** for validation
- **Lucide React** for icons

### Infra & Tooling
- **Render** for deployment
- **GitHub Actions** for CI/CD
- **ESLint** + **Prettier**
- **Vitest** for unit tests

---

## Repo Structure

```text
/
├── client/
│   └── src/
│       ├── api/            # Axios instance, query hooks
│       ├── components/     # Reusable and feature components
│       ├── hooks/          # Custom React hooks
│       ├── pages/          # Route-level pages
│       ├── store/          # Zustand stores
│       └── utils/          # Pure utilities
├── server/
│   ├── config/            # DB, env, logger, third-party setup
│   ├── middleware/        # Auth, rate limiting, error handling
│   ├── models/            # Mongoose models
│   ├── routes/            # Thin route definitions only
│   ├── services/          # Business logic
│   ├── validators/        # Zod schemas
│   └── utils/             # Server helpers
├── shared/                # Pure functions shared across environments
├── docs/                  # ADRs, deep dives, technical notes
├── .github/workflows/
├── .env.example
├── DESIGN.md              # Authoritative for all UI/UX when present
└── CLAUDE.md
```

---

## Behavior Rules

These govern how agents work in this repo. They are non-negotiable.

### Surgical Changes — Do Not Over-Engineer

- **Make the smallest change that satisfies the request.** Do not refactor, rename, reformat, or "improve" code you were not asked to touch.
- **Do not refactor for the sake of refactoring.** If working code follows an existing pattern, leave it alone. Refactoring is a deliberate task, not a side effect of unrelated work.
- **Do not create new files unless strictly required.** Prefer editing an existing file over adding a new one. If a new file seems necessary, say so before creating it.
- **Do not add abstractions for a single use case.** Inline first. Abstract only when a pattern has appeared three or more times in real code.
- **Do not add error handling, fallbacks, retries, or defensive guards** unless the input is genuinely untrusted or you are explicitly asked to. No try/catch around code that cannot throw.
- **Do not add caching, memoization, or batching** unless a performance requirement is explicitly named.
- **Match existing style, naming, and patterns in the surrounding code.** Convention beats preference. If the codebase uses one approach, use that approach.
- **If you notice unrelated dead code, mention it. Do not delete it.** Removal of unrelated code is a separate task requiring explicit approval.
- **Deleting code is a valid outcome.** When your changes make code obsolete, remove it. But do not delete code outside the scope of the request.
- **If a change feels like it needs more than ~20 lines or a new file, stop and propose a plan first** instead of writing it.

### Think Before Coding

- **State assumptions explicitly.** If something is ambiguous, ask rather than guess. Do not proceed silently on an uncertain interpretation.
- **Present multiple interpretations** when genuine ambiguity exists. Let the developer choose.
- **Push back when a simpler approach exists.** Say so before writing the complex version.
- **Stop when confused.** Name what is unclear and ask for clarification rather than hedging with extra code.

### Goal-Driven Execution

- Understand what "done" means before writing anything.
- For multi-step tasks, confirm the plan and verifiable checkpoints before executing.
- Do not declare a task complete without running the relevant tests or verifying the outcome.
- "Migration complete" is wrong if records were skipped. "Tests pass" is wrong if any were skipped. "Feature works" is wrong if edge cases were not checked. Surface uncertainty explicitly.

### Scope Discipline

- Touch only the layer or file the task requires.
- Do not fix unrelated issues in the same pass, even if you notice them.
- Do not introduce new dependencies without stating them explicitly in your response and confirming they are needed.
- Do not restructure existing modules or move files unless that is the explicit task.
- Do not touch more than one architectural layer — auth, storage, API, data — per task unless explicitly required.
- Do not modify or rewrite existing tests when your changes cause failures. Surface the failure and let the developer decide.

---

## Architecture Rules

1. **No framework drift.** If the repo is React + Vite, do not introduce Next.js or another frontend framework.
2. **No unnecessary persistence layers.** Do not add Redis, Postgres, queues, or extra databases without a documented reason.
3. **No business logic in route handlers.** Routes parse input, call services, and return responses.
4. **Server truth wins.** Subscription state, plan gating, roles, quotas, and privileged operations are always enforced on the server.
5. **Environment-driven configuration only.** Secrets and environment-specific values belong in env vars, not hardcoded source.
6. **Authoritative config files matter.** If the project defines a source-of-truth file for tiers, labels, limits, or system behavior, use it instead of duplicating logic.
7. **Prefer config-driven branching over scattered conditionals.** Centralize differences in config rather than spreading one-off conditionals across components.
8. **When UI work is involved, consult `DESIGN.md`.** It is authoritative for layout, styling, visual hierarchy, components, responsive behavior, motion, and UX when present.

---

## Security Rules

### Always
- Use secure, HTTP-only cookies for session flows.
- Validate all user input server-side.
- Use strict CORS for known origins only — never `origin: '*'` in production.
- Verify Stripe webhook signatures with the raw request body.
- Use idempotency protection for webhook processing.
- Apply rate limiting to auth and abuse-prone endpoints.
- Verify Turnstile server-side on public-facing forms.
- Hash passwords with a vetted approach and compare secrets in constant time.
- Scope resource queries to the authenticated user — never use a broad lookup to authorize access.
- Return sanitized production errors — never expose stack traces to users.

### Never
- Never trust client-sent plan, role, quota, or billing state.
- Never rely on the Stripe success redirect to grant access. Webhook only.
- Never send email to an address where bounce or suppression flags are set.
- Never commit `.env` files or secrets.
- Never put direct database logic in route handlers when the repo uses a service layer.

### Ask Before Changing
- Auth strategy
- Billing flow or webhook behavior
- Core user/account schema fields
- New infrastructure dependencies
- A second persistence system

---

## Frontend Conventions

- All network requests go through the shared Axios instance.
- Route-level guards should be centralized, not scattered.
- Use TanStack Query for server-derived data and Zustand for local app state.
- Do not bypass the query layer with direct fetch calls unless there is a documented reason.
- Every interactive element must have a visible focus state and a touch target of at least 44×44px.
- Use Lucide React for icons. Icon-only buttons must have an `aria-label`.
- If the repo has `DESIGN.md`, read it before touching any component or style.

---

## Code Standards

- Prefer TypeScript strict mode unless the repo is intentionally JavaScript-only.
- Use `async/await` instead of raw promise chains.
- Remove debug logging before committing.
- Keep utility functions pure where practical.
- Follow the file naming conventions the repo already uses.
- Do not introduce new naming conventions without raising them first.

---

## Testing Rules

- Unit test utilities, validators, hooks, and service logic.
- Run lint before opening a PR.
- Run build checks for frontend changes.
- For seed or migration scripts, verify dry-run behavior before running destructive operations.
- If a change causes test failures, report them — do not silently fix or delete the failing tests.

---

## Workflow Rules

1. **Never push directly to `main`.** Work on a branch, commit locally, push the branch, then open a PR into `main`.
2. **Prefer one coherent PR per feature, fix, or refactor.** Group related work together so there are fewer open PRs, but do not mix unrelated changes into the same branch.
3. **Run lint and relevant tests before PR.**
4. **Use clear branch names:** `feat/`, `fix/`, `chore/`, `docs/`, `test/`.
5. **Keep PRs reviewable.** Use a clear title and description, and make sure automated checks (lint, tests, CI) pass and any failures are addressed before merge.
6. **Check existing patterns before introducing a new one.**
7. **If a script can delete or mutate production data, require a dry-run path.**

---

## Deployment & Env

- `.env.example` documents every required env var.
- Production env vars belong in the hosting provider, not in source control.
- Client-exposed env vars must use the appropriate public prefix such as `VITE_`.
- CI must verify: install, lint, tests, and build at minimum.

---

## What Not to Build

Unless explicitly documented:

- Do not add a second frontend framework.
- Do not introduce a second database by default.
- Do not replace the repo's auth model without explicit approval.
- Do not hardcode pricing, tier limits, or model IDs if the project already externalizes them.
- Do not create parallel component systems when one already exists.
- Do not bypass service layers with direct DB access in unrelated places.
- Do not build around client-side trust for protected functionality.

---

## Project Override Section

Replace or extend the following when a project differs from these defaults:

- Product overview and repo context
- Exact stack versions and any deviations from defaults
- Actual route and folder structure
- Auth strategy if different
- Billing rules, webhook events, and tier tables
- Known gotchas and migration notes
- Deployment commands and CI specifics
- Any repo-specific hard rules that add to or override behavior rules above

---

## Maintenance

Review this file after major refactors, auth changes, billing changes, deployment changes, or infrastructure changes. Aim to keep this file under ~300 lines and move deep implementation detail into `docs/`. Last verified: 2026-07-12.
