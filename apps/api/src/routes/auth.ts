import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { acceptInviteInput, loginInput, setupInput } from '@rm/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { createSession, loadCtx, COOKIE, hashPassword, newToken, requireAuth, sha256, verifyLogin } from '../auth.js';
import { db, schema } from '../db/client.js';
import { audit } from '../services/audit.js';
import { ctxOf, DEFAULT_SETTINGS, HttpError, parse, wrap } from '../http.js';
import { effectiveCapabilities } from '@rm/shared';

export const authRouter = Router();
const limiter = (max: number) => rateLimit({ windowMs: 15 * 60_000, max, standardHeaders: true, legacyHeaders: false, skip: () => !config.rateLimitEnabled, message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } } });

export function meView(ctx: ReturnType<typeof ctxOf>) {
  return {
    user: { id: ctx.userId, name: ctx.userName, email: ctx.userEmail, locale: ctx.locale }, tenant: { id: ctx.tenantId, name: ctx.tenantName, demo: !!ctx.tenantSettings.demo, company: ctx.tenantSettings.company },
    role: ctx.role, capabilities: ctx.caps, allPlants: ctx.allPlants, plantIds: ctx.plantIds, csrfToken: ctx.csrf,
    settings: { staleAfterDays: ctx.tenantSettings.staleAfterDays, defaultValidityDays: ctx.tenantSettings.defaultValidityDays },
  };
}

authRouter.post('/auth/login', limiter(20), wrap(async (req, res) => {
  const body = parse(loginInput, req.body);
  const { user, membership } = await verifyLogin(body.email, body.password, body.tenantSlug);
  const { token } = await createSession(res, user.id, { id: membership.id, tenantId: membership.tenantId }, req.headers['user-agent']);
  const ctx = await loadCtx(token);
  await audit(db, ctx!, 'user', user.id, 'login', {});
  res.json(meView(ctx!));
}));

authRouter.post('/auth/logout', wrap(async (req, res) => {
  const ctx = req.ctx;
  if (ctx) await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, ctx.sessionId));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/auth/me', requireAuth, wrap(async (req, res) => { res.json(meView(ctxOf(req))); }));

authRouter.post('/auth/locale', requireAuth, wrap(async (req, res) => {
  const { locale } = parse(z.object({ locale: z.enum(['en', 'ar']) }), req.body);
  await db.update(schema.users).set({ locale }).where(eq(schema.users.id, ctxOf(req).userId));
  res.json({ ok: true });
}));

authRouter.get('/auth/invitations/:token', limiter(60), wrap(async (req, res) => {
  const [inv] = await db.select({ i: schema.invitations, t: schema.tenants }).from(schema.invitations).innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
    .where(and(eq(schema.invitations.tokenHash, sha256(String(req.params.token))), isNull(schema.invitations.usedAt), gt(schema.invitations.expiresAt, new Date())));
  if (!inv) throw new HttpError(404, 'invalid_invitation', 'This invitation is invalid or has expired.');
  res.json({ email: inv.i.email, company: inv.t.name, role: inv.i.role });
}));

authRouter.post('/auth/invitations/accept', limiter(20), wrap(async (req, res) => {
  const body = parse(acceptInviteInput, req.body);
  const result = await db.transaction(async (tx) => {
    // atomically consume the one-time token
    const [inv] = await tx.update(schema.invitations).set({ usedAt: new Date() })
      .where(and(eq(schema.invitations.tokenHash, sha256(body.token)), isNull(schema.invitations.usedAt), gt(schema.invitations.expiresAt, new Date()))).returning();
    if (!inv) throw new HttpError(404, 'invalid_invitation', 'This invitation is invalid or has expired.');
    let [user] = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${inv.email.toLowerCase()}`);
    if (user) {
      const { default: argon2 } = await import('argon2');
      if (!(await argon2.verify(user.passwordHash, body.password).catch(() => false))) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password.');
    } else {
      [user] = await tx.insert(schema.users).values({ email: inv.email, name: body.name, passwordHash: await hashPassword(body.password) }).returning();
    }
    const [m] = await tx.insert(schema.memberships).values({ tenantId: inv.tenantId, userId: user!.id, role: inv.role, allPlants: inv.allPlants }).returning();
    for (const pid of inv.plantIds as string[]) await tx.insert(schema.plantAssignments).values({ tenantId: inv.tenantId, membershipId: m!.id, plantId: pid });
    await audit(tx, { tenantId: inv.tenantId, userId: user!.id, userName: user!.name }, 'user', user!.id, 'invitation_accepted', { role: inv.role });
    return { user: user!, m: m! };
  });
  await createSession(res, result.user.id, { id: result.m.id, tenantId: result.m.tenantId }, req.headers['user-agent']);
  res.json({ ok: true });
}));

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest(), hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

authRouter.get('/setup/status', wrap(async (_req, res) => {
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.tenants)) as [{ n: number }];
  res.json({ needsSetup: n === 0 && !!config.setupToken, signupEnabled: config.allowTenantSignup, demoMode: config.demoMode });
}));

async function createTenantWithAdmin(b: { companyName: string; slug: string; adminName: string; adminEmail: string; password: string }, onlyIfEmpty: boolean) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
    if (onlyIfEmpty) {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.tenants)) as [{ n: number }];
      if (n > 0) throw new HttpError(409, 'already_initialized', 'Setup has already been completed.');
    }
    const [t] = await tx.insert(schema.tenants).values({ name: b.companyName, slug: b.slug, settings: { ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, name: b.companyName } } }).returning();
    const existing = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${b.adminEmail.toLowerCase()}`);
    if (existing.length) throw new HttpError(409, 'duplicate', 'An account with this email already exists.');
    const [u] = await tx.insert(schema.users).values({ email: b.adminEmail, name: b.adminName, passwordHash: await hashPassword(b.password) }).returning();
    const [m] = await tx.insert(schema.memberships).values({ tenantId: t!.id, userId: u!.id, role: 'admin', allPlants: true }).returning();
    await audit(tx, { tenantId: t!.id, userId: u!.id, userName: u!.name }, 'tenant', t!.id, 'created', { by: 'setup' });
    return { t: t!, u: u!, m: m! };
  });
}

authRouter.post('/setup', limiter(10), wrap(async (req, res) => {
  if (!config.setupToken) throw new HttpError(404, 'not_found', 'Not found');
  const b = parse(setupInput, req.body);
  if (!safeEqual(b.token, config.setupToken)) throw new HttpError(403, 'forbidden', 'Invalid setup token.');
  const r = await createTenantWithAdmin(b, true);
  await createSession(res, r.u.id, { id: r.m.id, tenantId: r.t.id }, req.headers['user-agent']);
  res.status(201).json({ ok: true });
}));

authRouter.post('/signup', limiter(5), wrap(async (req, res) => {
  if (!config.allowTenantSignup) throw new HttpError(404, 'not_found', 'Not found');
  const b = parse(setupInput.omit({ token: true }), req.body);
  const r = await createTenantWithAdmin(b, false);
  await createSession(res, r.u.id, { id: r.m.id, tenantId: r.t.id }, req.headers['user-agent']);
  res.status(201).json({ ok: true });
}));
export { effectiveCapabilities, newToken };
