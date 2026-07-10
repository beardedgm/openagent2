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
