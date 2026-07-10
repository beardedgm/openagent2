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
