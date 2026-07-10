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
