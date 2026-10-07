import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { db, pool } from './client.js';

function findMigrations() {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) if (fs.existsSync(path.join(dir, 'drizzle', 'meta', '_journal.json'))) return path.join(dir, 'drizzle');
  throw new Error('drizzle migrations folder not found; set MIGRATIONS_DIR');
}
export async function runMigrations() {
  await migrate(db, { migrationsFolder: findMigrations() });
}
if (process.argv[1] && /(^|[\/])migrate.[tj]s$/.test(process.argv[1])) {
  runMigrations().then(() => { console.log('migrations applied'); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
