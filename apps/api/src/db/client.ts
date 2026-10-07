import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/readymix', max: 10 });
// numeric → string by default in pg; keep it (decimal strings end-to-end)
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
