import argon2 from 'argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { effectiveCapabilities, type Role } from '@rm/shared';
import { config } from './config.js';
import { db, schema } from './db/client.js';
import { DEFAULT_SETTINGS, HttpError, type Ctx, type TenantSettings } from './http.js';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
// precomputed hash so unknown-email logins cost the same time as wrong-password logins
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });

export const COOKIE = 'rm_sid';
export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', expires });
}

export async function createSession(res: Response, userId: string, membership: { id: string; tenantId: string }, userAgent?: string) {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  const csrf = newToken();
  await db.insert(schema.sessions).values({ id: sha256(token), userId, tenantId: membership.tenantId, membershipId: membership.id, csrfToken: csrf, expiresAt: expires, userAgent: userAgent?.slice(0, 200) });
  setSessionCookie(res, token, expires);
  return { csrf, token };
}

export async function verifyLogin(email: string, password: string, tenantSlug?: string) {
  const [user] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
  const generic = new HttpError(401, 'invalid_credentials', 'Invalid email or password.');
  if (!user) { await argon2.verify(DUMMY_HASH, password).catch(() => false); throw generic; }
  if (user.disabled || (user.lockedUntil && user.lockedUntil > new Date())) { await argon2.verify(DUMMY_HASH, password).catch(() => false); throw generic; }
  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) {
    const n = user.failedLogins + 1;
    await db.update(schema.users).set({ failedLogins: n, lockedUntil: n >= 10 ? new Date(Date.now() + 15 * 60_000) : null }).where(eq(schema.users.id, user.id));
    throw generic;
  }
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
  const rows = await db.select({ m: schema.memberships, t: schema.tenants }).from(schema.memberships).innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, 'active')));
  const chosen = tenantSlug ? rows.find((r) => r.t.slug === tenantSlug) : rows[0];
  if (!chosen) throw generic;
  return { user, membership: chosen.m };
}

function buildCtx(u: typeof schema.users.$inferSelect, m: typeof schema.memberships.$inferSelect, t: typeof schema.tenants.$inferSelect, plantIds: string[], csrf: string, sessionId: string): Ctx {
  const settings: TenantSettings = { ...DEFAULT_SETTINGS, ...(t.settings as object), company: { ...DEFAULT_SETTINGS.company, ...((t.settings as any)?.company ?? {}) }, demo: t.isDemo };
  return {
    userId: u.id, userName: u.name, userEmail: u.email, locale: u.locale, tenantId: t.id, tenantName: t.name, membershipId: m.id,
    role: m.role, caps: effectiveCapabilities(m.role as Role, m.grant, m.revoke), allPlants: m.allPlants || m.role === 'admin', plantIds, csrf, sessionId, tenantSettings: settings,
  };
}
async function plantIdsFor(m: typeof schema.memberships.$inferSelect) {
  if (m.allPlants) return [];
  const rows = await db.select({ p: schema.plantAssignments.plantId }).from(schema.plantAssignments).where(and(eq(schema.plantAssignments.tenantId, m.tenantId), eq(schema.plantAssignments.membershipId, m.id)));
  return rows.map((p) => p.p);
}
/** Build a request context directly from a membership (used by seeding and tests; no session involved). */
export async function ctxFromMembership(membershipId: string): Promise<Ctx> {
  const [row] = await db.select({ u: schema.users, m: schema.memberships, t: schema.tenants }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId)).where(eq(schema.memberships.id, membershipId));
  if (!row) throw new Error('membership not found');
  return buildCtx(row.u, row.m, row.t, await plantIdsFor(row.m), '', '');
}

export async function loadCtx(token: string): Promise<Ctx | null> {
  const [row] = await db.select({ s: schema.sessions, u: schema.users, m: schema.memberships, t: schema.tenants }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.memberships, and(eq(schema.memberships.id, schema.sessions.membershipId), eq(schema.memberships.tenantId, schema.sessions.tenantId)))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.sessions.tenantId))
    .where(and(eq(schema.sessions.id, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
  if (!row || row.u.disabled || row.m.status !== 'active') return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > config.sessionIdleMinutes * 60_000) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > 60_000) await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, row.s.id));
  return buildCtx(row.u, row.m, row.t, await plantIdsFor(row.m), row.s.csrfToken, row.s.id);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) req.ctx = (await loadCtx(token)) ?? undefined;
    next();
  } catch (e) { next(e); }
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.ctx) return next(new HttpError(401, 'unauthenticated', 'Authentication required'));
  next();
}
/** CSRF: unsafe methods need the per-session token header AND a same-origin Origin (when present). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.ctx) return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    const allowed = new Set([`http://${host}`, `https://${host}`, config.webOrigin]);
    if (!allowed.has(origin)) return next(new HttpError(403, 'csrf', 'Cross-origin request rejected.'));
  }
  const t = req.headers['x-csrf-token'];
  if (typeof t !== 'string' || t.length !== req.ctx.csrf.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(req.ctx.csrf))) return next(new HttpError(403, 'csrf', 'Missing or invalid CSRF token.'));
  next();
}
