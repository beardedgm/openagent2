# Stage 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the runnable single-tenant brokerage workspace skeleton: tooling + CI, Express/Mongo API with session auth, invitations, user management, brokerage settings, public-asset uploads, seed script, and the branded React shell with login/registration, directory, profile, and admin Users + Settings pages.

**Architecture:** npm-workspaces monorepo (`server/`, `client/`). Express (TypeScript, ESM) serves `/api/v1` and, in production, the built SPA. Sessions via express-session + connect-mongo; scrypt hashing; Zod validation middleware; Mongo-backed sliding-window rate limiter; storage adapter (local disk dev / Cloudflare R2 prod) for public assets. React 18 + Vite + React Router 6 + TanStack Query 5 + Zustand.

**Tech Stack:** Node 20+, TypeScript 5 strict, Express 4, Mongoose 8, express-session + connect-mongo 5, Zod 3, pino, helmet, multer 2, @aws-sdk/client-s3 (R2), Resend, Vitest 2 + Supertest + mongodb-memory-server 10, React 18, Vite 6.

**Conventions for every task:**
- Run all commands from the repo root (`C:\Users\derri\OneDrive\Desktop\openagent`). Bash syntax.
- Server relative imports MUST use `.js` extensions (ESM + NodeNext) even in `.ts` source.
- Work on branch `feat/stage-1-foundation` (created in Task 1). Commit after each green task. Never commit `.env`.
- Server tests: `npm -w server run test`. One test file per task where noted; `tests/setup.ts` (Task 4) provides an in-memory Mongo per run and wipes collections between tests.
- "Expected: PASS" means zero failures; if a test unexpectedly passes before implementation exists, stop and check you wrote the test against the right import path.

**Prerequisite (user):** `.env` at repo root must contain `MONGODB_URI` (present), `APP_DOMAIN` (present), and `SESSION_SECRET` (any random string ≥16 chars — add before running the dev server; tests don't need it).

---

### Task 1: Monorepo scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/stage-1-foundation
```

- [ ] **Step 2: Write root `package.json`**

```json
{
  "name": "brokerage-workspace",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "workspaces": ["server", "client"],
  "scripts": {
    "dev": "npm-run-all --parallel dev:server dev:client",
    "dev:server": "npm -w server run dev",
    "dev:client": "npm -w client run dev",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "npm -w server run test && npm -w client run test",
    "build": "npm -w server run build && npm -w client run build",
    "start": "node server/dist/index.js",
    "seed": "npm -w server run seed"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "npm-run-all2": "^7.0.2",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Write `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/uploads/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-namespace': 'off'
    }
  }
);
```

- [ ] **Step 5: Write `.prettierrc`**

```json
{ "singleQuote": true, "printWidth": 100 }
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npm run lint`
Expected: install succeeds; eslint exits 0 (no source files yet).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json eslint.config.js .prettierrc
git commit -m "chore: monorepo scaffold with eslint, prettier, typescript"
```

---

### Task 2: Server package, env config, logger

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/config/env.ts`, `server/src/config/logger.ts`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.716.0",
    "connect-mongo": "^5.1.0",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-session": "^1.18.1",
    "helmet": "^8.0.0",
    "mongoose": "^8.9.3",
    "multer": "^2.0.0",
    "pino": "^9.6.0",
    "pino-http": "^10.3.0",
    "resend": "^4.0.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/express-session": "^1.18.1",
    "@types/multer": "^1.4.12",
    "@types/node": "^20.17.10",
    "@types/supertest": "^6.0.2",
    "mongodb-memory-server": "^10.1.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "scripts"],
  "exclude": ["tests"]
}
```

- [ ] **Step 3: Write `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['tests/setup.ts'], hookTimeout: 120000, fileParallelism: false },
});
```

- [ ] **Step 4: Write `server/src/config/env.ts`**

Loads `.env` from `server/` or repo root (dev runs with cwd `server/`, prod with cwd repo root), then validates. A missing required var fails fast with a readable Zod error.

```ts
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

for (const p of ['.env', '../.env']) {
  const full = resolve(process.cwd(), p);
  if (existsSync(full)) {
    config({ path: full });
    break;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_DOMAIN: z.string().default('http://localhost:5173'),
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('workspace@localhost'),
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
```

- [ ] **Step 5: Write `server/src/config/logger.ts`**

```ts
import { pino } from 'pino';
import { env } from './env.js';

export const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
```

- [ ] **Step 6: Install and typecheck**

Run: `npm install && npm -w server run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add server package-lock.json
git commit -m "chore(server): package scaffold, env validation, logger"
```

---

### Task 3: Password hashing utility (TDD)

**Files:**
- Create: `server/src/utils/password.ts`
- Test: `server/tests/password.test.ts`
- Create (stub for now, full version in Task 4): `server/tests/setup.ts`

- [ ] **Step 1: Write minimal `server/tests/setup.ts`** (env vars must exist before any `env.ts` import; Mongo pieces arrive in Task 4)

```ts
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
process.env.MONGODB_URI = 'mongodb://placeholder:27017/test';
```

- [ ] **Step 2: Write the failing test `server/tests/password.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('password', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(await verifyPassword('hunter2!secret', hash)).toBe(true);
  });

  it('rejects wrong passwords and malformed hashes', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:zz:zz')).toBe(false);
  });

  it('produces unique salts', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm -w server run test`
Expected: FAIL — cannot find module `../src/utils/password.js`.

- [ ] **Step 4: Write `server/src/utils/password.ts`**

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, keyHex] = stored.split(':');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return timingSafeEqual(key, expected);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm -w server run test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/password.ts server/tests
git commit -m "feat(server): scrypt password hashing with constant-time verify"
```

---

### Task 4: App bootstrap, error handling, test harness

**Files:**
- Create: `server/src/app.ts`, `server/src/index.ts`, `server/src/config/db.ts`, `server/src/middleware/errorHandler.ts`, `server/src/middleware/asyncHandler.ts`
- Modify: `server/tests/setup.ts`
- Test: `server/tests/health.test.ts`

- [ ] **Step 1: Complete `server/tests/setup.ts`** (in-memory Mongo per run, clean collections between tests)

```ts
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
process.env.MONGODB_URI = 'mongodb://placeholder:27017/test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
```

- [ ] **Step 2: Write the failing test `server/tests/health.test.ts`**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('app', () => {
  it('serves health check', async () => {
    const res = await request(createApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns structured 404 for unknown API routes', async () => {
    const res = await request(createApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
```

Run: `npm -w server run test` — Expected: FAIL (no `app.ts`).

- [ ] **Step 3: Write `server/src/middleware/errorHandler.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  logger.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 4: Write `server/src/middleware/asyncHandler.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
```

- [ ] **Step 5: Write `server/src/config/db.ts`**

```ts
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function connectDb(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  logger.info('mongo connected');
}
```

- [ ] **Step 6: Write `server/src/app.ts`**

`createApp()` must be called after Mongo is connected (the session store reuses mongoose's client). Routers from later tasks are mounted in the marked block, always above `notFound`.

```ts
import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

export function createApp(): express.Express {
  const app = express();
  const prod = env.NODE_ENV === 'production';
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: prod
        ? {
            directives: {
              ...helmet.contentSecurityPolicy.getDefaultDirectives(),
              'img-src': ["'self'", 'data:', 'https:'],
            },
          }
        : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({ client: mongoose.connection.getClient() as never }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: prod,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- routers (mounted by later tasks) ---

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 7: Write `server/src/index.ts`**

```ts
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start(): Promise<void> {
  await connectDb();
  const app = createApp();
  app.listen(env.PORT, () => logger.info(`listening on :${env.PORT}`));
}

void start();
```

- [ ] **Step 8: Run tests**

Run: `npm -w server run test`
Expected: PASS (password + health suites). First run downloads a mongod binary — allow a minute.

- [ ] **Step 9: Commit**

```bash
git add server/src server/tests
git commit -m "feat(server): express app bootstrap with sessions, error handling, test harness"
```

---

### Task 5: Validation middleware (TDD)

**Files:**
- Create: `server/src/middleware/validate.ts`
- Test: `server/tests/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { validate } from '../src/middleware/validate.js';

function testApp() {
  const app = express();
  app.use(express.json());
  app.post('/echo', validate(z.object({ name: z.string().min(1) })), (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler);
  return app;
}

describe('validate', () => {
  it('passes valid bodies through (stripped to schema shape)', async () => {
    const res = await request(testApp()).post('/echo').send({ name: 'Ann', extra: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Ann' });
  });

  it('rejects invalid bodies with structured 400', async () => {
    const res = await request(testApp()).post('/echo').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.issues[0].path).toBe('name');
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/middleware/validate.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body);
    next();
  };
}
```

(Zod's throw is synchronous, so Express 4 forwards it to `errorHandler` without a wrapper.)

- [ ] **Step 3: Run tests** — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/middleware/validate.ts server/tests/validate.test.ts
git commit -m "feat(server): zod validation middleware"
```

---

### Task 6: Mongo-backed sliding-window rate limiter (TDD)

**Files:**
- Create: `server/src/middleware/rateLimit.ts`
- Test: `server/tests/rateLimit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/middleware/rateLimit.js';

describe('rateLimit', () => {
  it('allows up to max requests then returns 429', async () => {
    const app = express();
    app.get('/limited', rateLimit({ name: 'test', max: 2, windowMs: 60000 }), (_req, res) => {
      res.json({ ok: true });
    });
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(429);
  });

  it('supports custom keys', async () => {
    const app = express();
    app.get(
      '/k',
      rateLimit({ name: 'keyed', max: 1, windowMs: 60000, keyFn: (req) => String(req.query.u) }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    expect((await request(app).get('/k?u=a')).status).toBe(200);
    expect((await request(app).get('/k?u=b')).status).toBe(200);
    expect((await request(app).get('/k?u=a')).status).toBe(429);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/middleware/rateLimit.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

const hitSchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});

export const RateLimitHit = mongoose.model('RateLimitHit', hitSchema);

export interface RateLimitOptions {
  name: string;
  max: number;
  windowMs: number;
  keyFn?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `${opts.name}:${opts.keyFn ? opts.keyFn(req) : (req.ip ?? 'unknown')}`;
      const since = new Date(Date.now() - opts.windowMs);
      const count = await RateLimitHit.countDocuments({ key, createdAt: { $gt: since } });
      if (count >= opts.max) {
        res.status(429).json({ error: 'Too many requests. Try again later.' });
        return;
      }
      await RateLimitHit.create({ key });
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

(TTL of 3600s bounds collection growth; the sliding window itself is the `createdAt > since` count. Window must be ≤ 1 hour.)

- [ ] **Step 3: Run tests** — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/middleware/rateLimit.ts server/tests/rateLimit.test.ts
git commit -m "feat(server): mongo sliding-window rate limiter"
```

---

### Task 7: Core models + engagement service (TDD)

**Files:**
- Create: `server/src/models/User.ts`, `server/src/models/Settings.ts`, `server/src/models/Invitation.ts`, `server/src/models/EngagementEvent.ts`, `server/src/services/engagementService.ts`
- Test: `server/tests/models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { logEngagement } from '../src/services/engagementService.js';

describe('models', () => {
  it('getSettings creates then reuses a singleton', async () => {
    const a = await getSettings();
    const b = await getSettings();
    expect(b.id).toBe(a.id);
    expect(a.primaryColor).toBe('#1d4ed8');
  });

  it('rejects duplicate user emails', async () => {
    await User.init();
    const base = { hashedPassword: 'x', role: 'agent', displayName: 'A' };
    await User.create({ ...base, email: 'dup@x.com' });
    await expect(User.create({ ...base, email: 'DUP@x.com' })).rejects.toThrow();
  });

  it('logEngagement writes an event', async () => {
    const u = await User.create({ email: 'e@x.com', hashedPassword: 'x', role: 'agent', displayName: 'E' });
    logEngagement('login', u.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(await EngagementEvent.countDocuments({ type: 'login' })).toBe(1);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/models/User.ts`**

```ts
import mongoose from 'mongoose';

export const ROLES = ['broker', 'officeAdmin', 'agent', 'tc', 'external'] as const;
export type Role = (typeof ROLES)[number];
// tc/external are dormant Phase 2 roles (PRD §3); rank 0 = no intranet access.
export const ROLE_RANK: Record<Role, number> = { external: 0, tc: 0, agent: 1, officeAdmin: 2, broker: 3 };

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hashedPassword: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['active', 'deactivated'], default: 'active', index: true },
    displayName: { type: String, required: true },
    phone: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    bio: { type: String, default: '' },
    emailPrefs: { type: Map, of: Boolean, default: {} },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
export type UserDoc = InstanceType<typeof User>;

export function toPublicUser(u: UserDoc) {
  return {
    id: u.id as string,
    email: u.email,
    role: u.role,
    officeId: u.officeId,
    status: u.status,
    displayName: u.displayName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    bio: u.bio,
    emailPrefs: Object.fromEntries(u.emailPrefs ?? []),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.get('createdAt') as Date,
  };
}
```

(Mongoose's inferred types omit timestamp fields — hence `u.get('createdAt')`.)

- [ ] **Step 3: Write `server/src/models/Settings.ts`**

```ts
import mongoose from 'mongoose';

const officeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, default: '' },
  timezone: { type: String, default: 'America/Chicago' },
});

const quickLinkSchema = new mongoose.Schema({ label: String, url: String }, { _id: false });

const settingsSchema = new mongoose.Schema(
  {
    brandName: { type: String, default: 'My Brokerage' },
    logoUrl: { type: String, default: '' },
    primaryColor: { type: String, default: '#1d4ed8', match: /^#[0-9a-fA-F]{6}$/ },
    officeLocations: { type: [officeSchema], default: [] },
    rssFeeds: { type: [String], default: [], validate: [(v: string[]) => v.length <= 10, 'Max 10 RSS feeds'] },
    welcomeMessage: { type: String, default: '' },
    quickLinks: { type: [quickLinkSchema], default: [] },
    homepageLayout: {
      type: [String],
      default: ['welcome', 'banners', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks'],
    },
    onboardingTaskTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const Settings = mongoose.model('Settings', settingsSchema);
export type SettingsDoc = InstanceType<typeof Settings>;

export async function getSettings(): Promise<SettingsDoc> {
  return (await Settings.findOne()) ?? (await Settings.create({}));
}
```

(`welcomeMessage`, `quickLinks`, `homepageLayout`, `onboardingTaskTemplateId` are consumed by Stages 3/5 — fields exist now so the seed and admin settings won't need migrations.)

- [ ] **Step 4: Write `server/src/models/Invitation.ts`**

```ts
import mongoose from 'mongoose';
import { ROLES } from './User.js';

const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Invitation = mongoose.model('Invitation', invitationSchema);
export type InvitationDoc = InstanceType<typeof Invitation>;
```

- [ ] **Step 5: Write `server/src/models/EngagementEvent.ts`**

```ts
import mongoose from 'mongoose';

export const ENGAGEMENT_TYPES = ['login', 'pageView', 'download', 'taskComplete', 'bannerClick'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

const engagementEventSchema = new mongoose.Schema({
  type: { type: String, enum: ENGAGEMENT_TYPES, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});
engagementEventSchema.index({ type: 1, createdAt: -1 });
engagementEventSchema.index({ userId: 1, createdAt: -1 });

export const EngagementEvent = mongoose.model('EngagementEvent', engagementEventSchema);
```

- [ ] **Step 6: Write `server/src/services/engagementService.ts`**

```ts
import { logger } from '../config/logger.js';
import { EngagementEvent, type EngagementType } from '../models/EngagementEvent.js';

export function logEngagement(type: EngagementType, userId: string, meta: Record<string, unknown> = {}): void {
  EngagementEvent.create({ type, userId, meta }).catch((err) => logger.error(err, 'engagement log failed'));
}
```

(Fire-and-forget by design: engagement logging must never fail a user request.)

- [ ] **Step 7: Run tests** — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/models server/src/services/engagementService.ts server/tests/models.test.ts
git commit -m "feat(server): settings, user, invitation, engagement models"
```

---

### Task 8: Turnstile verification helper (TDD)

**Files:**
- Create: `server/src/utils/turnstile.ts`
- Test: `server/tests/turnstile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { verifyTurnstile } from '../src/utils/turnstile.js';

describe('turnstile', () => {
  it('passes when no secret is configured (dev mode)', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe(true);
    expect(await verifyTurnstile('any-token', '1.2.3.4')).toBe(true);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/utils/turnstile.ts`**

```ts
import { env } from '../config/env.js';

export async function verifyTurnstile(token: string | undefined, ip: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    }),
  });
  const data = (await res.json()) as { success: boolean };
  return data.success;
}
```

- [ ] **Step 3: Run tests** — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/utils/turnstile.ts server/tests/turnstile.test.ts
git commit -m "feat(server): env-gated turnstile verification"
```

---

### Task 9: Auth — middleware, service, routes (TDD)

**Files:**
- Create: `server/src/middleware/auth.ts`, `server/src/services/authService.ts`, `server/src/validators/auth.ts`, `server/src/routes/auth.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Invitation } from '../src/models/Invitation.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function makeUser(email: string, role = 'agent', status = 'active') {
  return User.create({
    email,
    hashedPassword: await hashPassword('Password1!'),
    role,
    status,
    displayName: 'Test User',
  });
}

describe('auth', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('logs in, reports me, logs out', async () => {
    await makeUser('a@x.com');
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'Password1!' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('a@x.com');
    expect(login.body.user.hashedPassword).toBeUndefined();

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('a@x.com');

    await agent.post('/api/v1/auth/logout');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects bad credentials and deactivated users identically', async () => {
    await makeUser('a@x.com');
    await makeUser('gone@x.com', 'agent', 'deactivated');
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'nope' });
    expect(bad.status).toBe(401);
    const gone = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'gone@x.com', password: 'Password1!' });
    expect(gone.status).toBe(401);
    expect(gone.body.error).toBe(bad.body.error);
  });

  it('registers via a valid invitation and rejects reuse', async () => {
    const admin = await makeUser('admin@x.com', 'officeAdmin');
    const token = 'raw-token-for-test';
    await Invitation.create({
      email: 'new@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'Newbie' });
    expect(reg.status).toBe(201);
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('new@x.com');

    const reuse = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'Again' });
    expect(reuse.status).toBe(400);
  });

  it('rejects expired invitations', async () => {
    const admin = await makeUser('admin2@x.com', 'officeAdmin');
    await Invitation.create({
      email: 'late@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update('expired-token').digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ token: 'expired-token', password: 'Password1!', displayName: 'Late' });
    expect(res.status).toBe(400);
  });

  it('rate limits login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'flood@x.com', password: 'x' });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/middleware/auth.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';
import { ROLE_RANK, User, type Role, type UserDoc } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const user = await User.findById(userId);
    if (!user || user.status !== 'active' || ROLE_RANK[user.role as Role] < 1) {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || ROLE_RANK[req.user.role as Role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 3: Write `server/src/validators/auth.ts`**

```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export const registerSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(80),
  turnstileToken: z.string().optional(),
});
```

- [ ] **Step 4: Write `server/src/services/authService.ts`**

```ts
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { Invitation } from '../models/Invitation.js';
import { User, type UserDoc } from '../models/User.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { verifyTurnstile } from '../utils/turnstile.js';
import { logEngagement } from './engagementService.js';

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

export async function login(
  req: Request,
  input: { email: string; password: string; turnstileToken?: string },
): Promise<UserDoc> {
  if (!(await verifyTurnstile(input.turnstileToken, req.ip))) throw new AppError(400, 'Bot check failed');
  const user = await User.findOne({ email: input.email.toLowerCase() });
  const invalid = new AppError(401, 'Invalid email or password');
  if (!user || !(await verifyPassword(input.password, user.hashedPassword))) throw invalid;
  if (user.status !== 'active') throw invalid;
  await regenerate(req);
  req.session.userId = user.id;
  user.lastLoginAt = new Date();
  await user.save();
  logEngagement('login', user.id);
  return user;
}

export async function register(
  req: Request,
  input: { token: string; password: string; displayName: string; turnstileToken?: string },
): Promise<UserDoc> {
  if (!(await verifyTurnstile(input.turnstileToken, req.ip))) throw new AppError(400, 'Bot check failed');
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const invitation = await Invitation.findOne({ tokenHash });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date())
    throw new AppError(400, 'This invitation link is invalid or has expired');
  if (await User.findOne({ email: invitation.email }))
    throw new AppError(409, 'An account with this email already exists');
  const user = await User.create({
    email: invitation.email,
    hashedPassword: await hashPassword(input.password),
    role: invitation.role,
    officeId: invitation.officeId,
    displayName: input.displayName,
  });
  invitation.acceptedAt = new Date();
  await invitation.save();
  await regenerate(req);
  req.session.userId = user.id;
  logEngagement('login', user.id);
  // Stage 2 wiring: notify invitation.invitedBy ("invitation accepted") once Notifications exist.
  // Stage 3 wiring: auto-assign Settings.onboardingTaskTemplateId once Tasks exist.
  return user;
}

export function logout(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
}
```

- [ ] **Step 5: Write `server/src/routes/auth.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { toPublicUser } from '../models/User.js';
import { login, logout, register } from '../services/authService.js';
import { loginSchema, registerSchema } from '../validators/auth.js';

export const authRouter = Router();

const authLimiter = rateLimit({ name: 'auth', max: 10, windowMs: 15 * 60 * 1000 });

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await login(req, req.body);
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const user = await register(req, req.body);
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await logout(req);
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});
```

- [ ] **Step 6: Mount in `server/src/app.ts`** — add import and, in the routers block:

```ts
import { authRouter } from './routes/auth.js';
// ...inside createApp(), in the routers block:
app.use('/api/v1/auth', authRouter);
```

- [ ] **Step 7: Run tests** — Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add server/src server/tests/auth.test.ts
git commit -m "feat(server): session auth with login, logout, me, invite-based registration"
```

---

### Task 10: Email service

**Files:**
- Create: `server/src/services/emailService.ts`
- Test: `server/tests/email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { invitationEmail } from '../src/services/emailService.js';

describe('email templates', () => {
  it('builds an invitation email containing the link and brand', () => {
    const { subject, html } = invitationEmail('Acme Realty', 'http://localhost:5173/register?token=abc');
    expect(subject).toContain('Acme Realty');
    expect(html).toContain('http://localhost:5173/register?token=abc');
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/services/emailService.ts`**

```ts
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    logger.info({ to, subject, html }, 'email (console driver)');
    return;
  }
  await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
}

export function invitationEmail(brandName: string, link: string): { subject: string; html: string } {
  return {
    subject: `You're invited to join ${brandName}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>${brandName}</h2>
      <p>You've been invited to the ${brandName} workspace.</p>
      <p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
      <p style="color:#64748b;font-size:13px">This link expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
    </div>`,
  };
}
```

- [ ] **Step 3: Run tests** — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/emailService.ts server/tests/email.test.ts
git commit -m "feat(server): email service with resend and console drivers"
```

---

### Task 11: Invitations & user management routes (TDD)

**Files:**
- Create: `server/src/services/invitationService.ts`, `server/src/validators/users.ts`, `server/src/routes/users.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/tests/users.test.ts`

- [ ] **Step 1: Write the failing test** (mocks the email module to capture invite links)

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const sent: { to: string; html: string }[] = [];
vi.mock('../src/services/emailService.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/emailService.js')>();
  return {
    ...mod,
    sendEmail: vi.fn(async (to: string, _subject: string, html: string) => {
      sent.push({ to, html });
    }),
  };
});

const { createApp } = await import('../src/app.js');

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('users & invitations', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
    sent.length = 0;
  });

  it('officeAdmin can invite; agent cannot; token in email registers the user', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'agent@x.com', 'agent');

    expect(
      (await agent.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).status,
    ).toBe(403);

    const res = await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' });
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    const token = sent[0].html.match(/token=([A-Za-z0-9_-]+)/)![1];

    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'New Agent' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('agent');
  });

  it('rejects duplicate invites and invites for existing users', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'admin@x.com', role: 'agent' })).status,
    ).toBe(409);
    await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' });
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).status,
    ).toBe(409);
  });

  it('only broker can invite a broker', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'b@x.com', role: 'broker' })).status,
    ).toBe(403);
    const broker = await loginAs(app, 'broker@x.com', 'broker');
    expect(
      (await broker.post('/api/v1/users/invite').send({ email: 'b@x.com', role: 'broker' })).status,
    ).toBe(201);
  });

  it('resend reissues a working token', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const inv = (await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).body
      .invitation;
    await admin.post(`/api/v1/users/invitations/${inv.id}/resend`);
    expect(sent).toHaveLength(2);
    const token2 = sent[1].html.match(/token=([A-Za-z0-9_-]+)/)![1];
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ token: token2, password: 'Password1!', displayName: 'N' });
    expect(reg.status).toBe(201);
  });

  it('lists users (deactivated only for admins), updates profiles, enforces edit rules', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'agent@x.com', 'agent');
    const other = await User.create({
      email: 'other@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'agent',
      displayName: 'Other',
      status: 'deactivated',
    });

    const agentList = await agent.get('/api/v1/users');
    expect(agentList.body.users.every((u: { status: string }) => u.status === 'active')).toBe(true);
    const adminList = await admin.get('/api/v1/users?includeDeactivated=true');
    expect(adminList.body.users.some((u: { id: string }) => u.id === other.id)).toBe(true);

    const meId = agentList.body.users.find((u: { email: string }) => u.email === 'agent@x.com').id;
    expect((await agent.patch(`/api/v1/users/${meId}`).send({ bio: 'Hi' })).status).toBe(200);
    expect((await agent.patch(`/api/v1/users/${meId}`).send({ role: 'broker' })).status).toBe(403);
    expect((await agent.patch(`/api/v1/users/${other.id}`).send({ bio: 'x' })).status).toBe(403);
    expect((await admin.patch(`/api/v1/users/${meId}`).send({ role: 'officeAdmin' })).status).toBe(200);
  });

  it('deactivates users with guards', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const broker = await User.create({
      email: 'boss@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'broker',
      displayName: 'Boss',
    });
    const target = await User.create({
      email: 't@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'agent',
      displayName: 'T',
    });
    expect((await admin.delete(`/api/v1/users/${broker.id}`)).status).toBe(403);
    expect((await admin.delete(`/api/v1/users/${target.id}`)).status).toBe(200);
    const adminId = (await admin.get('/api/v1/auth/me')).body.user.id;
    expect((await admin.delete(`/api/v1/users/${adminId}`)).status).toBe(400);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/services/invitationService.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { Invitation, type InvitationDoc } from '../models/Invitation.js';
import { getSettings } from '../models/Settings.js';
import { User, type Role } from '../models/User.js';
import { invitationEmail, sendEmail } from './emailService.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function issueAndSend(invitation: InvitationDoc): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  invitation.tokenHash = createHash('sha256').update(token).digest('hex');
  invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await invitation.save();
  const settings = await getSettings();
  const link = `${env.APP_DOMAIN}/register?token=${token}`;
  const { subject, html } = invitationEmail(settings.brandName, link);
  await sendEmail(invitation.email, subject, html);
}

export async function createInvitation(
  input: { email: string; role: Role; officeId?: string | null },
  invitedById: string,
): Promise<InvitationDoc> {
  const email = input.email.toLowerCase();
  if (await User.findOne({ email })) throw new AppError(409, 'A user with this email already exists');
  if (await Invitation.findOne({ email, acceptedAt: null }))
    throw new AppError(409, 'An invitation for this email is already pending');
  const invitation = new Invitation({
    email,
    role: input.role,
    officeId: input.officeId ?? null,
    invitedBy: invitedById,
    tokenHash: `pending:${randomBytes(8).toString('hex')}`,
    expiresAt: new Date(),
  });
  await issueAndSend(invitation);
  return invitation;
}

export async function resendInvitation(id: string): Promise<InvitationDoc> {
  const invitation = await Invitation.findById(id);
  if (!invitation || invitation.acceptedAt) throw new AppError(404, 'Invitation not found');
  await issueAndSend(invitation);
  return invitation;
}
```

- [ ] **Step 3: Write `server/src/validators/users.ts`**

```ts
import { z } from 'zod';

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['broker', 'officeAdmin', 'agent']),
  officeId: z.string().nullable().optional(),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  phone: z.string().max(30).optional(),
  bio: z.string().max(1000).optional(),
  emailPrefs: z.record(z.boolean()).optional(),
  role: z.enum(['broker', 'officeAdmin', 'agent']).optional(),
  officeId: z.string().nullable().optional(),
});
```

- [ ] **Step 4: Write `server/src/routes/users.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Invitation } from '../models/Invitation.js';
import { toPublicUser, User } from '../models/User.js';
import { createInvitation, resendInvitation } from '../services/invitationService.js';
import { inviteSchema, updateUserSchema } from '../validators/users.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeDeactivated = isAdmin(req.user!.role) && req.query.includeDeactivated === 'true';
    const users = await User.find(includeDeactivated ? {} : { status: 'active' }).sort({ displayName: 1 });
    res.json({ users: users.map(toPublicUser) });
  }),
);

usersRouter.post(
  '/invite',
  requireRole('officeAdmin'),
  validate(inviteSchema),
  asyncHandler(async (req, res) => {
    if (req.body.role === 'broker' && req.user!.role !== 'broker')
      throw new AppError(403, 'Only a broker can invite another broker');
    const invitation = await createInvitation(req.body, req.user!.id);
    res.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    });
  }),
);

usersRouter.get(
  '/invitations',
  requireRole('officeAdmin'),
  asyncHandler(async (_req, res) => {
    const invitations = await Invitation.find({ acceptedAt: null }).sort({ createdAt: -1 });
    res.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        officeId: i.officeId,
        expiresAt: i.expiresAt,
      })),
    });
  }),
);

usersRouter.post(
  '/invitations/:id/resend',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const invitation = await resendInvitation(req.params.id);
    res.json({ invitation: { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt } });
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, 'User not found');
    res.json({ user: toPublicUser(user) });
  }),
);

usersRouter.patch(
  '/:id',
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw new AppError(404, 'User not found');
    const me = req.user!;
    const isSelf = target.id === me.id;
    if (!isSelf && !isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
    const { role, officeId, ...profile } = req.body;
    if (role !== undefined || officeId !== undefined) {
      if (!isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
      if ((role === 'broker' || target.role === 'broker') && me.role !== 'broker')
        throw new AppError(403, 'Only a broker can change broker roles');
      if (role !== undefined) target.role = role;
      if (officeId !== undefined) target.officeId = officeId as never;
    }
    Object.assign(target, profile);
    await target.save();
    res.json({ user: toPublicUser(target) });
  }),
);

usersRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw new AppError(404, 'User not found');
    if (target.id === req.user!.id) throw new AppError(400, 'You cannot deactivate your own account');
    if (target.role === 'broker' && req.user!.role !== 'broker')
      throw new AppError(403, 'Only a broker can deactivate a broker');
    target.status = 'deactivated';
    await target.save();
    res.json({ user: toPublicUser(target) });
  }),
);
```

- [ ] **Step 5: Mount in `server/src/app.ts`** routers block:

```ts
import { usersRouter } from './routes/users.js';
app.use('/api/v1/users', usersRouter);
```

- [ ] **Step 6: Run tests** — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src server/tests/users.test.ts
git commit -m "feat(server): invitations and user management with role guards"
```

---

### Task 12: Storage adapter & uploads (TDD)

**Files:**
- Create: `server/src/services/storage.ts`, `server/src/routes/uploads.ts`
- Modify: `server/src/app.ts` (mount router + local `/files` static)
- Test: `server/tests/uploads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('uploads', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('broker uploads a logo; url saved to settings and file is served', async () => {
    const broker = await loginAs(app, 'b@x.com', 'broker');
    const res = await broker
      .post('/api/v1/uploads/logo')
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/files\/logo\//);
    expect((await getSettings()).logoUrl).toBe(res.body.url);
    expect((await broker.get(res.body.url)).status).toBe(200);
  });

  it('agent cannot upload a logo but can upload an avatar', async () => {
    const agent = await loginAs(app, 'a@x.com', 'agent');
    expect(
      (
        await agent
          .post('/api/v1/uploads/logo')
          .attach('file', PNG, { filename: 'l.png', contentType: 'image/png' })
      ).status,
    ).toBe(403);
    const res = await agent
      .post('/api/v1/uploads/avatar')
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).body.user.photoUrl).toBe(res.body.url);
  });

  it('rejects non-image mimetypes', async () => {
    const broker = await loginAs(app, 'b2@x.com', 'broker');
    const res = await broker
      .post('/api/v1/uploads/avatar')
      .attach('file', Buffer.from('plain'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/services/storage.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export interface StoragePort {
  putPublic(key: string, body: Buffer, contentType: string): Promise<string>;
}

export const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');

class LocalStorage implements StoragePort {
  async putPublic(key: string, body: Buffer): Promise<string> {
    const path = join(LOCAL_UPLOAD_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return `/files/${key}`;
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
}

export const storage: StoragePort = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();

export function makeKey(prefix: string, originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const ext =
    dot >= 0
      ? originalName
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      : 'bin';
  return `${prefix}/${randomBytes(12).toString('hex')}.${ext || 'bin'}`;
}
```

(Signed-URL reads for protected files are added in Stage 4; Stage 1 only needs public assets.)

- [ ] **Step 3: Write `server/src/routes/uploads.ts`**

```ts
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSettings } from '../models/Settings.js';
import { makeKey, storage } from '../services/storage.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireImage(file?: Express.Multer.File): Express.Multer.File {
  if (!file) throw new AppError(400, 'File is required');
  if (!IMAGE_TYPES.has(file.mimetype)) throw new AppError(400, 'Only PNG, JPEG, or WebP images are allowed');
  return file;
}

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post(
  '/logo',
  requireRole('broker'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('logo', file.originalname), file.buffer, file.mimetype);
    const settings = await getSettings();
    settings.logoUrl = url;
    await settings.save();
    res.json({ url });
  }),
);

uploadsRouter.post(
  '/avatar',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('avatars', file.originalname), file.buffer, file.mimetype);
    req.user!.photoUrl = url;
    await req.user!.save();
    res.json({ url });
  }),
);
```

- [ ] **Step 4: Mount in `server/src/app.ts`** routers block:

```ts
import express from 'express'; // already imported
import { uploadsRouter } from './routes/uploads.js';
import { LOCAL_UPLOAD_DIR } from './services/storage.js';
app.use('/api/v1/uploads', uploadsRouter);
if (env.STORAGE_DRIVER === 'local') app.use('/files', express.static(LOCAL_UPLOAD_DIR));
```

- [ ] **Step 5: Add `uploads/` to `.gitignore`** (already present from repo bootstrap — verify).

- [ ] **Step 6: Run tests** — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src server/tests/uploads.test.ts
git commit -m "feat(server): storage adapter (local/R2) with logo and avatar uploads"
```

---

### Task 13: Settings routes (TDD)

**Files:**
- Create: `server/src/validators/settings.ts`, `server/src/routes/settings.ts`
- Modify: `server/src/app.ts` (mount routers)
- Test: `server/tests/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('settings', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('serves public branding without auth', async () => {
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.settings.brandName).toBe('My Brokerage');
    expect(res.body.settings.primaryColor).toBe('#1d4ed8');
  });

  it('broker updates settings; officeAdmin cannot', async () => {
    const broker = await loginAs(app, 'b@x.com', 'broker');
    const admin = await loginAs(app, 'a@x.com', 'officeAdmin');
    const patch = {
      brandName: 'Acme Realty',
      primaryColor: '#0f766e',
      officeLocations: [{ name: 'HQ', address: '1 Main St', timezone: 'America/New_York' }],
      rssFeeds: ['https://example.com/feed.xml'],
    };
    expect((await admin.patch('/api/v1/admin/settings').send(patch)).status).toBe(403);
    const res = await broker.patch('/api/v1/admin/settings').send(patch);
    expect(res.status).toBe(200);
    expect(res.body.settings.brandName).toBe('Acme Realty');
    expect(res.body.settings.officeLocations[0].name).toBe('HQ');
    expect((await request(app).get('/api/v1/settings/public')).body.settings.primaryColor).toBe('#0f766e');
  });

  it('rejects invalid colors and >10 rss feeds', async () => {
    const broker = await loginAs(app, 'b2@x.com', 'broker');
    expect((await broker.patch('/api/v1/admin/settings').send({ primaryColor: 'red' })).status).toBe(400);
    const feeds = Array.from({ length: 11 }, (_, i) => `https://e.com/${i}.xml`);
    expect((await broker.patch('/api/v1/admin/settings').send({ rssFeeds: feeds })).status).toBe(400);
  });

  it('authenticated users can read full settings', async () => {
    const agent = await loginAs(app, 'ag@x.com', 'agent');
    const res = await agent.get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings.homepageLayout).toContain('welcome');
  });
});
```

Run: `npm -w server run test` — Expected: FAIL.

- [ ] **Step 2: Write `server/src/validators/settings.ts`**

```ts
import { z } from 'zod';

export const updateSettingsSchema = z.object({
  brandName: z.string().min(1).max(100).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #1a2b3c').optional(),
  officeLocations: z
    .array(
      z.object({
        _id: z.string().optional(),
        name: z.string().min(1).max(100),
        address: z.string().max(300).default(''),
        timezone: z.string().min(1),
      }),
    )
    .max(50)
    .optional(),
  rssFeeds: z.array(z.string().url()).max(10).optional(),
  welcomeMessage: z.string().max(20000).optional(),
  quickLinks: z.array(z.object({ label: z.string().min(1).max(60), url: z.string().url() })).max(12).optional(),
});
```

- [ ] **Step 3: Write `server/src/routes/settings.ts`**

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { updateSettingsSchema } from '../validators/settings.js';

export const settingsRouter = Router();

settingsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    res.json({ settings: { brandName: s.brandName, logoUrl: s.logoUrl, primaryColor: s.primaryColor } });
  }),
);

settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings() });
  }),
);

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAuth, requireRole('broker'));

adminSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings() });
  }),
);

adminSettingsRouter.patch(
  '/',
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    Object.assign(s, req.body);
    await s.save();
    res.json({ settings: s });
  }),
);
```

- [ ] **Step 4: Mount in `server/src/app.ts`** routers block:

```ts
import { adminSettingsRouter, settingsRouter } from './routes/settings.js';
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/admin/settings', adminSettingsRouter);
```

- [ ] **Step 5: Run tests** — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src server/tests/settings.test.ts
git commit -m "feat(server): settings routes with public branding endpoint"
```

---

### Task 14: Seed script

**Files:**
- Create: `server/scripts/seed.ts`

- [ ] **Step 1: Write `server/scripts/seed.ts`**

```ts
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const email = process.env.SEED_BROKER_EMAIL;
const password = process.env.SEED_BROKER_PASSWORD;
const displayName = process.env.SEED_BROKER_NAME ?? 'Broker';
const brandName = process.env.SEED_BRAND_NAME;

if (!email || !password) {
  console.error('Set SEED_BROKER_EMAIL and SEED_BROKER_PASSWORD in .env, then re-run: npm run seed');
  process.exit(1);
}

await mongoose.connect(env.MONGODB_URI);
const settings = await getSettings();
if (brandName && settings.brandName === 'My Brokerage') {
  settings.brandName = brandName;
  await settings.save();
  console.log(`Brand set to "${brandName}".`);
}
const existing = await User.findOne({ email: email.toLowerCase() });
if (existing) {
  console.log(`Broker ${email} already exists — nothing to do.`);
} else {
  await User.create({
    email,
    hashedPassword: await hashPassword(password),
    role: 'broker',
    displayName,
  });
  console.log(`Created broker account ${email}.`);
}
await mongoose.disconnect();
```

- [ ] **Step 2: Verify against the real database** (requires `SESSION_SECRET`, `SEED_BROKER_EMAIL`, `SEED_BROKER_PASSWORD` in `.env`)

Run: `npm run seed`
Expected: `Created broker account <email>.` — run again, expected: `Broker <email> already exists — nothing to do.`

- [ ] **Step 3: Commit**

```bash
git add server/scripts/seed.ts
git commit -m "feat(server): idempotent seed script for settings and first broker"
```

---

### Task 15: Client scaffold

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/api/client.ts`, `client/src/api/types.ts`, `client/src/test/setup.ts`

- [ ] **Step 1: Write `client/package.json`**

```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.11",
    "axios": "^1.7.9",
    "lucide-react": "^0.469.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.1",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `client/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
    },
  },
  test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'] },
});
```

- [ ] **Step 4: Write `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `client/src/api/client.ts`**

```ts
import axios from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });
```

- [ ] **Step 6: Write `client/src/api/types.ts`**

```ts
export type Role = 'broker' | 'officeAdmin' | 'agent' | 'tc' | 'external';

export interface User {
  id: string;
  email: string;
  role: Role;
  officeId: string | null;
  status: 'active' | 'deactivated';
  displayName: string;
  phone: string;
  photoUrl: string;
  bio: string;
  emailPrefs: Record<string, boolean>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Office {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

export interface Settings {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  officeLocations: Office[];
  rssFeeds: string[];
  welcomeMessage: string;
  quickLinks: { label: string; url: string }[];
  homepageLayout: string[];
}

export interface PublicSettings {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  officeId: string | null;
  expiresAt: string;
}
```

- [ ] **Step 7: Write `client/src/main.tsx`, `client/src/App.tsx`, `client/src/test/setup.ts`**

`main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

`App.tsx` (placeholder — real routes in Tasks 17–19):

```tsx
export function App() {
  return <div>Workspace</div>;
}
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom';
```

Also create empty placeholder files `client/src/styles/tokens.css` and `client/src/styles/base.css` (filled in Task 16) so the imports resolve.

- [ ] **Step 8: Install and build**

Run: `npm install && npm -w client run build`
Expected: build succeeds, `client/dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add client package-lock.json
git commit -m "chore(client): vite react scaffold with router, query, axios"
```

---

### Task 16: Design tokens, base styles, UI primitives, DESIGN.md

**Files:**
- Create: `client/src/styles/tokens.css` (fill), `client/src/styles/base.css` (fill), `client/src/components/ui/Button.tsx`, `client/src/components/ui/Field.tsx`, `client/src/components/ui/Card.tsx`, `client/src/components/ui/Badge.tsx`, `client/src/components/ui/Spinner.tsx`, `client/src/components/ui/Modal.tsx`, `client/src/utils/applyAccentColor.ts`, `DESIGN.md`
- Test: `client/src/utils/applyAccentColor.test.ts`

- [ ] **Step 1: Write `client/src/styles/tokens.css`**

```css
:root {
  --color-accent: #1d4ed8;
  --color-bg: #f6f7f9;
  --color-surface: #ffffff;
  --color-border: #e3e6ea;
  --color-text: #1a202c;
  --color-text-muted: #5b6572;
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #b45309;
  --radius-sm: 6px;
  --radius-md: 10px;
  --shadow-sm: 0 1px 2px rgb(16 24 40 / 6%);
  --shadow-md: 0 4px 12px rgb(16 24 40 / 10%);
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
}
```

- [ ] **Step 2: Write `client/src/styles/base.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.5;
}

h1, h2, h3 {
  line-height: 1.25;
  margin: 0 0 var(--space-3);
}

a {
  color: var(--color-accent);
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

/* WCAG touch targets */
button,
[role='button'],
input,
select {
  min-height: 44px;
}
```

- [ ] **Step 3: Write the primitives** (each in its own file under `client/src/components/ui/`)

`Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const styles: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--color-accent)', color: '#fff', border: '1px solid transparent' },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
  danger: { background: 'var(--color-danger)', color: '#fff', border: '1px solid transparent' },
};

export function Button({
  variant = 'primary',
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      style={{
        ...styles[variant],
        borderRadius: 'var(--radius-sm)',
        padding: '0 var(--space-4)',
        fontWeight: 600,
        opacity: props.disabled ? 0.6 : 1,
        ...style,
      }}
    />
  );
}
```

`Field.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
      <label htmlFor={id} style={{ fontWeight: 600, fontSize: 14 }}>
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={!!error}
        style={{
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0 var(--space-3)',
          background: 'var(--color-surface)',
        }}
      />
      {hint && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{hint}</span>}
      {error && (
        <span role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>
          {error}
        </span>
      )}
    </div>
  );
}
```

`Card.tsx`:

```tsx
import type { HTMLAttributes } from 'react';

export function Card({ style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-5)',
        ...style,
      }}
    />
  );
}
```

`Badge.tsx`:

```tsx
import type { ReactNode } from 'react';

const colors = {
  neutral: 'var(--color-text-muted)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  accent: 'var(--color-accent)',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof colors }) {
  return (
    <span
      style={{
        color: colors[tone],
        border: `1px solid ${colors[tone]}`,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
```

`Spinner.tsx`:

```tsx
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}
```

`Modal.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      style={{
        border: 'none',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--space-5)',
        width: 'min(480px, 90vw)',
      }}
    >
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {open && children}
    </dialog>
  );
}
```

- [ ] **Step 4: Write `client/src/utils/applyAccentColor.ts` + failing test**

```ts
export function applyAccentColor(hex: string): void {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    document.documentElement.style.setProperty('--color-accent', hex);
  }
}
```

`applyAccentColor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAccentColor } from './applyAccentColor';

describe('applyAccentColor', () => {
  it('sets the accent variable for valid hex', () => {
    applyAccentColor('#0f766e');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#0f766e');
  });

  it('ignores invalid values', () => {
    applyAccentColor('#0f766e');
    applyAccentColor('javascript:alert(1)');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#0f766e');
  });
});
```

Run: `npm -w client run test` — Expected: PASS (write test first, watch it fail on missing module, then add the util).

- [ ] **Step 5: Write `DESIGN.md`** at repo root — document: purpose (authoritative UI reference per CLAUDE.md), token table (colors, spacing, radii, shadows, font), accent-color mechanism (tenant `primaryColor` → `--color-accent` at runtime via `applyAccentColor`), component inventory (Button variants, Field, Card, Badge, Spinner, Modal) with usage rules, accessibility commitments (44px targets, `:focus-visible` outlines, WCAG AA contrast, `aria-label` on icon-only buttons), and layout conventions (sidebar 240px + header 64px shell, content max-width 1100px, page padding `--space-5`). Grows with each stage.

- [ ] **Step 6: Verify** — `npm -w client run build && npm -w client run test` — Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src DESIGN.md
git commit -m "feat(client): design tokens, base styles, ui primitives, DESIGN.md"
```

---

### Task 17: Auth UI — hooks, guards, login & register pages

**Files:**
- Create: `client/src/api/hooks.ts`, `client/src/components/RequireAuth.tsx`, `client/src/components/TurnstileWidget.tsx`, `client/src/pages/LoginPage.tsx`, `client/src/pages/RegisterPage.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Write `client/src/api/hooks.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Invitation, PublicSettings, Settings, User } from './types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: User }>('/auth/me')).data.user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<{ settings: PublicSettings }>('/settings/public')).data.settings,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<{ settings: Settings }>('/settings')).data.settings,
  });
}

export function useUsers(includeDeactivated = false) {
  return useQuery({
    queryKey: ['users', { includeDeactivated }],
    queryFn: async () =>
      (await api.get<{ users: User[] }>(`/users?includeDeactivated=${includeDeactivated}`)).data.users,
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get<{ invitations: Invitation[] }>('/users/invitations')).data.invitations,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.post('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}
```

- [ ] **Step 2: Write `client/src/components/RequireAuth.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/hooks';
import type { Role } from '../api/types';
import { Spinner } from './ui/Spinner';

const RANK: Record<Role, number> = { external: 0, tc: 0, agent: 1, officeAdmin: 2, broker: 3 };

export function RequireAuth({ children, min }: { children: ReactNode; min?: Role }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (min && RANK[user.role] < RANK[min]) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Write `client/src/components/TurnstileWidget.tsx`** (renders nothing when no site key — dev mode)

```tsx
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const render = () => window.turnstile?.render(ref.current!, { sitekey: SITE_KEY, callback: onToken });
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [onToken]);
  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}
```

- [ ] **Step 4: Write `client/src/pages/LoginPage.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePublicSettings } from '../api/hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { TurnstileWidget } from '../components/TurnstileWidget';

export function LoginPage() {
  const { data: branding } = usePublicSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: () => api.post('/auth/login', { email, password, turnstileToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  const errorMessage =
    login.isError && isAxiosError(login.error)
      ? ((login.error.response?.data as { error?: string })?.error ?? 'Login failed')
      : undefined;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-4)' }}>
      <Card style={{ width: 'min(400px, 100%)' }}>
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt={`${branding.brandName} logo`} style={{ maxHeight: 48, marginBottom: 12 }} />
        )}
        <h1 style={{ fontSize: 22 }}>{branding?.brandName ?? 'Workspace'}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            error={errorMessage}
          />
          <TurnstileWidget onToken={setTurnstileToken} />
          <Button type="submit" disabled={login.isPending} style={{ width: '100%' }}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Write `client/src/pages/RegisterPage.tsx`** (same shape: reads `token` from `useSearchParams()`, fields for display name / password / confirm password with client-side match check, posts to `/auth/register` with `{ token, password, displayName, turnstileToken }`, on success invalidates `['me']` and navigates to `/`. Shows a clear full-card error state when the server returns 400 — "This invitation link is invalid or has expired." Reuse `Card`, `Field`, `Button`, `TurnstileWidget` exactly as in LoginPage.)

- [ ] **Step 6: Wire routes in `client/src/App.tsx`**

```tsx
import { Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RequireAuth } from './components/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <div>Signed in</div>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

(The `/*` element is replaced by the AppShell in Task 18.)

- [ ] **Step 7: Verify end-to-end manually**

Run: `npm run dev` (needs `.env` complete + seed run). Visit `http://localhost:5173/login`, sign in with the seeded broker, confirm redirect and "Signed in". Confirm a bad password shows the error inline.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "feat(client): auth hooks, guards, login and register pages"
```

---

### Task 18: App shell, dashboard placeholder, profile, directory

**Files:**
- Create: `client/src/components/AppShell.tsx`, `client/src/pages/DashboardPage.tsx`, `client/src/pages/ProfilePage.tsx`, `client/src/pages/DirectoryPage.tsx`, `client/src/store/uiStore.ts`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Write `client/src/store/uiStore.ts`**

```ts
import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

- [ ] **Step 2: Write `client/src/components/AppShell.tsx`**

Layout: header (64px: menu toggle, logo+brand from `usePublicSettings`, spacer, bell placeholder `<Bell />` icon-button with `aria-label="Notifications"` disabled until Stage 2, user menu with avatar/displayName linking to own profile + Sign out via `useLogout`), collapsible sidebar (240px) and `<main>` with `<Outlet />`. Applies accent color:

```tsx
import { Bell, LayoutDashboard, LogOut, Menu, Settings as SettingsIcon, Users, UserSquare } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useMe, usePublicSettings } from '../api/hooks';
import { useUiStore } from '../store/uiStore';
import { applyAccentColor } from '../utils/applyAccentColor';

const linkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: '10px var(--space-3)',
  borderRadius: 'var(--radius-sm)',
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 500,
  color: isActive ? 'var(--color-accent)' : 'var(--color-text)',
  background: isActive ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
});

export function AppShell() {
  const { data: me } = useMe();
  const { data: branding } = usePublicSettings();
  const { sidebarOpen, toggleSidebar } = useUiStore();
  const logout = useLogout();
  const navigate = useNavigate();

  useEffect(() => {
    if (branding?.primaryColor) applyAccentColor(branding.primaryColor);
  }, [branding?.primaryColor]);

  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {sidebarOpen && (
        <nav
          aria-label="Main navigation"
          style={{
            width: 240,
            padding: 'var(--space-4)',
            borderRight: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <NavLink to="/" end style={linkStyle}>
            <LayoutDashboard size={18} /> Home
          </NavLink>
          <NavLink to="/directory" style={linkStyle}>
            <UserSquare size={18} /> Directory
          </NavLink>
          {isAdmin && (
            <>
              <div style={{ margin: 'var(--space-4) 0 var(--space-2)', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700 }}>
                ADMIN
              </div>
              <NavLink to="/admin/users" style={linkStyle}>
                <Users size={18} /> Users
              </NavLink>
              {me?.role === 'broker' && (
                <NavLink to="/admin/settings" style={linkStyle}>
                  <SettingsIcon size={18} /> Settings
                </NavLink>
              )}
            </>
          )}
        </nav>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '0 var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <button onClick={toggleSidebar} aria-label="Toggle navigation" style={{ background: 'none', border: 'none' }}>
            <Menu size={20} />
          </button>
          {branding?.logoUrl && <img src={branding.logoUrl} alt="" style={{ height: 32 }} />}
          <strong>{branding?.brandName}</strong>
          <div style={{ flex: 1 }} />
          <button aria-label="Notifications" disabled title="Coming soon" style={{ background: 'none', border: 'none' }}>
            <Bell size={20} />
          </button>
          <button
            onClick={() => navigate(`/profile/${me?.id}`)}
            style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {me?.photoUrl ? (
              <img src={me.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <span aria-hidden style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {me?.displayName?.[0] ?? '?'}
              </span>
            )}
            {me?.displayName}
          </button>
          <button
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            aria-label="Sign out"
            style={{ background: 'none', border: 'none' }}
          >
            <LogOut size={20} />
          </button>
        </header>
        <main style={{ flex: 1, padding: 'var(--space-5)', maxWidth: 1100, width: '100%', margin: '0 auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `client/src/pages/DashboardPage.tsx`** — greeting (`Welcome back, {displayName}`) plus, when `useSettings().data.welcomeMessage` is non-empty, a Card titled with the brand name rendering the welcome message as plain paragraphs (split on newlines — rich text arrives in Stage 5). Add a muted note-card: "Announcements, tasks, and events will appear here as they're added." (replaced by real widgets in Stage 5).

- [ ] **Step 4: Write `client/src/pages/DirectoryPage.tsx`** — `useUsers()` + `useSettings()` (for office names); local state for a search input (filters `displayName`/`email`, case-insensitive) and role/office `<select>` filters; responsive grid of Cards each showing avatar/initial, displayName (link to `/profile/:id`), role Badge, office name, email + phone.

- [ ] **Step 5: Write `client/src/pages/ProfilePage.tsx`** — loads `useParams().id` via `GET /users/:id` query. Shows avatar, displayName, role Badge, office, email, phone, bio. When viewing self (or as admin), an "Edit profile" toggle reveals a form (displayName, phone, bio fields) that PATCHes `/users/:id` and invalidates `['users']` + `['me']`, and an avatar file input (`accept="image/png,image/jpeg,image/webp"`) that posts `FormData` with key `file` to `/uploads/avatar`.

- [ ] **Step 6: Replace the `/*` route in `App.tsx`**

```tsx
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { ProfilePage } from './pages/ProfilePage';

// inside <Routes>, replacing the previous "/*" route:
<Route
  element={
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  }
>
  <Route path="/" element={<DashboardPage />} />
  <Route path="/directory" element={<DirectoryPage />} />
  <Route path="/profile/:id" element={<ProfilePage />} />
</Route>
```

- [ ] **Step 7: Verify manually** — sign in; confirm branding + accent color apply, sidebar/header render, directory lists users, own profile edits save, avatar upload displays.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "feat(client): app shell with branded navigation, dashboard, directory, profile"
```

---

### Task 19: Admin pages — Users & Settings

**Files:**
- Create: `client/src/pages/admin/UsersPage.tsx`, `client/src/pages/admin/SettingsPage.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Write `client/src/pages/admin/UsersPage.tsx`**

Content (all mutations invalidate `['users']` / `['invitations']`):
- **Invite** Button opening the `Modal` with a form: email (`Field type="email"`), role `<select>` (agent / officeAdmin / broker — broker option only rendered when `me.role === 'broker'`), office `<select>` (from `useSettings().data.officeLocations`, optional). Submits `POST /users/invite`; shows server error text (409s) inline.
- **Pending invitations** Card (from `useInvitations()`): email, role, expiry date (flag "Expired" in danger tone when `expiresAt < now`), Resend button → `POST /users/invitations/:id/resend`.
- **Users table** (from `useUsers(true)`): avatar+name (link to profile), email, role `<select>` and office `<select>` inline (PATCH on change; both disabled for broker rows when `me.role !== 'broker'`), status Badge, Deactivate Button (`variant="danger"`, `window.confirm` guard, hidden on own row) → `DELETE /users/:id`. Wrap the table in a `div` with `overflowX: 'auto'`.

- [ ] **Step 2: Write `client/src/pages/admin/SettingsPage.tsx`**

Loads via `GET /admin/settings` into local form state; single Save Button issues one `PATCH /admin/settings`; invalidates `['settings']` + `['settings', 'public']` on success. Sections:
- **Brand:** brandName Field; primaryColor as `<input type="color">` + hex Field kept in sync; logo `<img>` preview + file input posting FormData to `/uploads/logo` (updates immediately, separate from Save).
- **Offices:** editable rows (name, address, timezone `<select>` of common IANA zones e.g. America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix), Remove per row, "Add office" button.
- **RSS feeds:** URL Field rows with Remove, "Add feed" disabled at 10, hint "Feeds appear in the Activity Feed (coming in the next release)."

- [ ] **Step 3: Add routes in `App.tsx`** inside the AppShell route group:

```tsx
<Route
  path="/admin/users"
  element={
    <RequireAuth min="officeAdmin">
      <UsersPage />
    </RequireAuth>
  }
/>
<Route
  path="/admin/settings"
  element={
    <RequireAuth min="broker">
      <SettingsPage />
    </RequireAuth>
  }
/>
```

(Nested `RequireAuth min` inside the shell group is fine — `useMe` is cached.)

- [ ] **Step 4: Verify manually** — as broker: change brand name + color (UI accent updates after save), upload logo, add an office, add an RSS feed; invite a test user (email prints to the server console in dev), open the printed link in a private window, register, confirm the new agent appears in the table; change their role; deactivate them and confirm they can't log in.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): admin users and settings pages"
```

---

### Task 20: Production static serving

**Files:**
- Modify: `server/src/app.ts`

- [ ] **Step 1: Add SPA serving to `createApp()`** — after the routers block, before `notFound`:

```ts
import { fileURLToPath } from 'node:url';
// ...
if (prod) {
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) return next();
    res.sendFile(fileURLToPath(new URL('../../client/dist/index.html', import.meta.url)));
  });
}
```

(Path resolves relative to the compiled file `server/dist/src/app.js` — verify: `server/dist/src/../../client` lands at `server/client`… **it does not**. Compute from the compiled layout: `app.js` lives at `server/dist/src/app.js`, so `../../..` reaches the repo root. Use `new URL('../../../client/dist', import.meta.url)` and add a comment in code: `// server/dist/src/app.js -> repo root -> client/dist`. During `vitest`/`tsx` runs the file lives at `server/src/app.ts` where `../../../` would escape the repo — but this branch only runs when `NODE_ENV === 'production'`, i.e., compiled.)

- [ ] **Step 2: Verify production serving locally**

```bash
npm run build
NODE_ENV=production node server/dist/src/index.js
```

Note: `tsc` with `rootDir: "."` emits to `dist/src/` and `dist/scripts/` — the root `start` script must be `node server/dist/src/index.js`. Update root `package.json` `start` accordingly.
Visit `http://localhost:3000` — the SPA loads and login works. Ctrl-C afterwards.

- [ ] **Step 3: Commit**

```bash
git add server/src/app.ts package.json
git commit -m "feat(server): serve built SPA in production with API passthrough"
```

---

### Task 21: CI workflow & README

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Expand `README.md`** — project summary (single-tenant brokerage workspace, PRD reference), prerequisites (Node 20+, MongoDB URI), setup steps (`npm install` → fill `.env` from `.env.example` → `npm run seed` → `npm run dev` → visit `http://localhost:5173`), test/lint/build commands, repo layout table, links to `DESIGN.md`, spec, roadmap, and Stage 1 plan.

- [ ] **Step 3: Full verification sweep**

Run: `npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add .github README.md
git commit -m "chore: ci workflow and readme"
```

---

### Task 22: Stage acceptance & merge readiness

- [ ] **Step 1: End-to-end acceptance pass** (dev mode, seeded DB):
  1. Broker signs in → branded shell, accent color correct.
  2. Broker sets brand/color/logo/office/RSS in Admin → Settings; login page reflects branding.
  3. Broker invites an agent → console shows email → register via link → agent lands on dashboard.
  4. Agent edits profile + avatar; appears in Directory; cannot see Admin nav or reach `/admin/users` (redirected), API returns 403.
  5. Broker deactivates agent → agent's next request logs them out; they cannot log back in; still listed under "include deactivated".
  6. `EngagementEvents` contains `login` documents (verify in mongosh/Compass or a quick script).
- [ ] **Step 2: Run the verify skill** (if executing inside Claude Code) to exercise the flows against the running app.
- [ ] **Step 3: Push branch and open PR** per CLAUDE.md workflow (`git push -u origin feat/stage-1-foundation`, PR into `main`) once a GitHub remote exists; otherwise merge locally: `git checkout main && git merge --no-ff feat/stage-1-foundation`.
- [ ] **Step 4: Write the Stage 2 plan** (`docs/superpowers/plans/<date>-stage-2-communications.md`) referencing the now-real codebase.

---

## Self-Review Notes

- **Spec coverage (Stage 1 scope):** PRD 4.4 auth (sessions, scrypt, invite tokens hashed + 7-day expiry, Turnstile env-gated, rate limiting) → Tasks 3, 6, 8, 9, 11. PRD 5.8 user management (invite flow, resend, profile, directory, deactivation-preserves-data) → Tasks 11, 18, 19. PRD 5.10 admin panel (Brokerage Settings, User Management sections) → Tasks 13, 19; remaining admin sections arrive with their features (Stages 2–5). PRD 6.3 note (EngagementEvents from day one) → Tasks 7, 9. Onboarding progress bar and "invitation accepted" notification depend on Tasks/Notifications systems → explicitly deferred to Stages 3/2 with wiring notes in the code and roadmap.
- **Known deviations:** none from the approved spec. Profile-completion prompt on first login (PRD 5.8.1) is satisfied minimally by the profile edit page; a dedicated first-login prompt is listed for Stage 5 polish.
- **Type consistency check:** `toPublicUser` shape matches client `User` interface; `RANK` in `RequireAuth.tsx` matches `ROLE_RANK` in `User.ts`; upload field name `file` consistent across routes and client FormData.
