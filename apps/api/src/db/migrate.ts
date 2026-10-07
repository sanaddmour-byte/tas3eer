import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, pool } from './client.js';

export async function runMigrations() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.MIGRATIONS_DIR ?? '../../drizzle');
  await migrate(db, { migrationsFolder: dir });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations().then(() => { console.log('migrations applied'); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
