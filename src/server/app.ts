import express from 'express';
import type { AppConfig } from './config.js';
import type { DB } from './db.js';
import { buildApiRouter } from './routes.js';
import { requestLoggerMiddleware, securityHeadersMiddleware } from './security.js';

export function createApp(db: DB, config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLoggerMiddleware(config.env));
  app.use(buildApiRouter(db, config));

  // Global safe error handler — never leaks stack traces in prod
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({
      error: config.env === 'prod' ? 'Internal server error' : msg,
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}
