import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

function testApp() {
  const app = express();
  app.get('/boom', () => {
    throw new Error('boom');
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('returns the sanitized 500 body for unhandled errors when SENTRY_DSN is unset', async () => {
    expect(process.env.SENTRY_DSN).toBeUndefined();
    const res = await request(testApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
