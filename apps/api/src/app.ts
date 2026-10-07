import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { authenticate, csrfGuard, requireAuth } from './auth.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { catalogRouter } from './routes/catalog.js';
import { batchRouter } from './routes/priceBatches.js';
import { clientRouter, quoteRouter } from './routes/quotes.js';
import { dashboardRouter } from './routes/dashboard.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], scriptSrc: ["'self'"], workerSrc: ["'self'"] } } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(authenticate);
  api.use(csrfGuard);
  api.use(authRouter); // login/setup/invitation endpoints are public; others guard themselves
  api.use(requireAuth);
  api.use(adminRouter, catalogRouter, batchRouter, quoteRouter, clientRouter, dashboardRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }));
  if (config.webDist && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
