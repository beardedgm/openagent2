import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

export async function seed(opts: {
  email: string;
  password: string;
  displayName: string;
  brandName?: string;
}): Promise<string> {
  const settings = await getSettings();
  if (opts.brandName && settings.brandName === 'My Brokerage') {
    settings.brandName = opts.brandName;
    await settings.save();
  }
  const existing = await User.findOne({ email: opts.email.toLowerCase() });
  if (existing) {
    return `Broker ${opts.email} already exists — nothing to do.`;
  }
  await User.create({
    email: opts.email,
    hashedPassword: await hashPassword(opts.password),
    role: 'broker',
    displayName: opts.displayName,
  });
  return `Created broker account ${opts.email}.`;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const email = process.env.SEED_BROKER_EMAIL;
  const password = process.env.SEED_BROKER_PASSWORD;
  if (!email || !password) {
    console.error('Set SEED_BROKER_EMAIL and SEED_BROKER_PASSWORD in .env, then re-run: npm run seed');
    process.exit(1);
  }
  await mongoose.connect(env.MONGODB_URI);
  const message = await seed({
    email,
    password,
    displayName: process.env.SEED_BROKER_NAME ?? 'Broker',
    brandName: process.env.SEED_BRAND_NAME,
  });
  console.log(message);
  await mongoose.disconnect();
}
