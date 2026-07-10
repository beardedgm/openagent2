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
