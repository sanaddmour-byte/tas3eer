import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import path from 'node:path';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/readymix_test';
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;');
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../drizzle') });
  await pool.end();
}
