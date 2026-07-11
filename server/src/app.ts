import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { feedRouter } from './routes/feed.js';
import { notificationsRouter } from './routes/notifications.js';
import { postsRouter } from './routes/posts.js';
import { adminSettingsRouter, settingsRouter } from './routes/settings.js';
import { taskTemplatesRouter } from './routes/taskTemplates.js';
import { tasksRouter } from './routes/tasks.js';
import { uploadsRouter } from './routes/uploads.js';
import { usersRouter } from './routes/users.js';
import { LOCAL_UPLOAD_DIR } from './services/storage.js';

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
      store: MongoStore.create({
        client: mongoose.connection.getClient() as never,
        autoRemove: env.NODE_ENV === 'test' ? 'disabled' : 'native',
      }),
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
  app.use('/api/v1/posts', postsRouter);
  app.use('/api/v1/uploads', uploadsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/admin/settings', adminSettingsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/feed', feedRouter);
  app.use('/api/v1/events', eventsRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/task-templates', taskTemplatesRouter);
  if (env.STORAGE_DRIVER === 'local') {
    // Protected files live under uploads/private/ and are served ONLY through
    // authorized download routes — never by the public static mount.
    app.use('/files', (req, res, next) => {
      if (req.path.startsWith('/private/')) return res.status(404).json({ error: 'Not found' });
      next();
    });
    app.use('/files', express.static(LOCAL_UPLOAD_DIR));
  }

  if (prod) {
    // compiled file lives at server/dist/src/app.js → repo root is ../../..
    const clientDist = fileURLToPath(new URL('../../../client/dist', import.meta.url));
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) return next();
      res.sendFile(join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
