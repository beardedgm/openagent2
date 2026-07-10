import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';

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
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
