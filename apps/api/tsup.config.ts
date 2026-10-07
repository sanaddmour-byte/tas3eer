import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/server.ts'], format: ['esm'], target: 'node20', outDir: 'dist', clean: true, noExternal: [/^@rm\//], external: ['argon2', 'pg', 'playwright-core', 'exceljs', 'express', 'helmet', 'multer', 'cookie-parser', 'express-rate-limit', 'drizzle-orm', 'zod'], sourcemap: true });
