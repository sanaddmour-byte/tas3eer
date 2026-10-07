import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { closeBrowser } from './services/pdf.js';

await runMigrations();
const app = createApp();
const server = app.listen(config.port, () => console.log(`Ready-mix API listening on :${config.port} (${config.env})`));
const stop = async () => { server.close(); await closeBrowser().catch(() => {}); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
