import session from 'express-session';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// MongoStore's native autoRemove (active outside NODE_ENV=test) starts a background
// index build that races test teardown — these app-level tests don't exercise
// sessions, so use an in-memory store. Auth tests cover the real MongoStore.
vi.mock('connect-mongo', () => ({
  default: { create: () => new session.MemoryStore() },
}));

const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');

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

  it('production CSP allows the Turnstile script and iframe origin', async () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const res = await request(createApp()).get('/api/v1/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
      expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
    } finally {
      env.NODE_ENV = original;
    }
  });
});
