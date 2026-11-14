import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './src/server/app.js';
import { loadConfig } from './src/server/config.js';
import { initDatabase } from './src/server/db.js';
import { runSlaSweep } from './src/server/engine.js';
import { bootstrapOperators } from './src/server/seed.js';

async function startServer() {
  const config = loadConfig();
  const db = initDatabase(config.databasePath);

  // Start clean with zero sample figures on every screen; operators can load data/dummy-data.json from UI/API
  bootstrapOperators(db, config);

  const app = createApp(db, config);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
          return next();
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  // Optional automated SLA sweep scheduler with advisory deduplication window
  if (config.slaSweepMinutes > 0) {
    const intervalMs = config.slaSweepMinutes * 60_000;
    setInterval(() => {
      try {
        const last = db
          .prepare('SELECT ran_at FROM sla_sweep_runs ORDER BY ran_at DESC LIMIT 1')
          .get() as { ran_at: string } | undefined;
        if (last && Date.now() - new Date(last.ran_at).getTime() < intervalMs * 0.85) {
          return;
        }
        runSlaSweep(db, 'scheduler.sla_sweep');
      } catch (err) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'Scheduled SLA sweep failed',
            error: String(err),
          })
        );
      }
    }, intervalMs).unref();
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'IAMOps server listening',
        port: config.port,
        env: config.env,
        database: config.databasePath,
      })
    );
  });
}

startServer().catch((err) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      message: 'Failed to start IAMOps server',
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
