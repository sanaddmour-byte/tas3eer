import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { effectiveCapabilities, inviteInput, plantInput, policyInput, taxPolicyInput, termsInput, CAPABILITIES, ROLES, uuid, type Role } from '@rm/shared';
import { config } from '../config.js';
import { newToken, sha256 } from '../auth.js';
import { db, schema } from '../db/client.js';
import { audit } from '../services/audit.js';
import { bad, conflict, ctxOf, DEFAULT_SETTINGS, HttpError, need, parse, unprocessable, wrap } from '../http.js';

export const adminRouter = Router();
const S = schema;

// ---------- users ----------
adminRouter.get('/users', wrap(async (req, res) => {
  const ctx = need(req, 'user.manage');
  const rows = await db.select({ m: S.memberships, u: S.users }).from(S.memberships).innerJoin(S.users, eq(S.users.id, S.memberships.userId)).where(eq(S.memberships.tenantId, ctx.tenantId)).orderBy(asc(S.users.name));
  const assigns = await db.select().from(S.plantAssignments).where(eq(S.plantAssignments.tenantId, ctx.tenantId));
  const invites = await db.select({ id: S.invitations.id, email: S.invitations.email, role: S.invitations.role, expiresAt: S.invitations.expiresAt, usedAt: S.invitations.usedAt }).from(S.invitations).where(and(eq(S.invitations.tenantId, ctx.tenantId), isNull(S.invitations.usedAt))).orderBy(desc(S.invitations.createdAt));
  res.json({
    users: rows.map(({ m, u }) => ({ membershipId: m.id, userId: u.id, name: u.name, email: u.email, role: m.role, status: m.status, grant: m.grant, revoke: m.revoke, allPlants: m.allPlants, plantIds: assigns.filter((a) => a.membershipId === m.id).map((a) => a.plantId), capabilities: effectiveCapabilities(m.role as Role, m.grant, m.revoke) })),
    invitations: invites, capabilities: CAPABILITIES, roles: ROLES,
  });
}));

adminRouter.post('/users/invitations', wrap(async (req, res) => {
  const ctx = need(req, 'user.manage');
  const b = parse(inviteInput, req.body);
  if (b.plantIds.length) {
    const found = await db.select({ id: S.plants.id }).from(S.plants).where(and(eq(S.plants.tenantId, ctx.tenantId), inArray(S.plants.id, b.plantIds)));
    if (found.length !== b.plantIds.length) throw unprocessable('One or more plants do not exist in this company.');
  }
  const token = newToken();
  const [inv] = await db.insert(S.invitations).values({ tenantId: ctx.tenantId, email: b.email, role: b.role, plantIds: b.plantIds, allPlants: b.allPlants, tokenHash: sha256(token), expiresAt: new Date(Date.now() + config.inviteTtlHours * 3600_000), createdBy: ctx.userId }).returning();
  await audit(db, ctx, 'invitation', inv!.id, 'created', { email: b.email, role: b.role });
  // No email integration: the link is shown once to the administrator to share through a trusted channel.
  res.status(201).json({ id: inv!.id, link: `${config.webOrigin}/accept-invite?token=${token}`, expiresAt: inv!.expiresAt });
}));

adminRouter.patch('/users/:membershipId', wrap(async (req, res) => {
  const ctx = need(req, 'user.manage');
  const b = parse(z.object({ role: z.enum(['admin', 'pricing', 'technical', 'sales', 'viewer']).optional(), grant: z.array(z.enum(CAPABILITIES)).optional(), revoke: z.array(z.enum(CAPABILITIES)).optional(), allPlants: z.boolean().optional(), plantIds: z.array(uuid).optional(), status: z.enum(['active', 'disabled']).optional() }), req.body);
  const id = String(req.params.membershipId);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(S.memberships).where(and(eq(S.memberships.tenantId, ctx.tenantId), eq(S.memberships.id, id))).for('update');
    if (!m) throw new HttpError(404, 'not_found', 'User not found');
    if (m.userId === ctx.userId && (b.status === 'disabled' || (b.role && b.role !== 'admin'))) throw conflict('You cannot remove your own administrator access.');
    const patch = { ...(b.role ? { role: b.role } : {}), ...(b.grant ? { grant: b.grant } : {}), ...(b.revoke ? { revoke: b.revoke } : {}), ...(b.allPlants !== undefined ? { allPlants: b.allPlants } : {}), ...(b.status ? { status: b.status } : {}) };
    if (Object.keys(patch).length) await tx.update(S.memberships).set(patch).where(eq(S.memberships.id, id));
    if (b.plantIds) {
      await tx.delete(S.plantAssignments).where(and(eq(S.plantAssignments.tenantId, ctx.tenantId), eq(S.plantAssignments.membershipId, id)));
      for (const p of b.plantIds) await tx.insert(S.plantAssignments).values({ tenantId: ctx.tenantId, membershipId: id, plantId: p }); // composite FK rejects foreign plants
    }
    if (b.status === 'disabled' || b.role) await tx.update(S.sessions).set({ revokedAt: new Date() }).where(and(eq(S.sessions.membershipId, id), isNull(S.sessions.revokedAt)));
    await audit(tx, ctx, 'membership', id, 'updated', b);
  });
  res.json({ ok: true });
}));

adminRouter.post('/users/:membershipId/revoke-sessions', wrap(async (req, res) => {
  const ctx = need(req, 'user.manage');
  const r = await db.update(S.sessions).set({ revokedAt: new Date() }).where(and(eq(S.sessions.tenantId, ctx.tenantId), eq(S.sessions.membershipId, String(req.params.membershipId)), isNull(S.sessions.revokedAt))).returning({ id: S.sessions.id });
  await audit(db, ctx, 'membership', String(req.params.membershipId), 'sessions_revoked', { count: r.length });
  res.json({ revoked: r.length });
}));

// ---------- tenant settings ----------
adminRouter.get('/settings', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  res.json({ settings: ctx.tenantSettings, name: ctx.tenantName });
}));
adminRouter.put('/settings', wrap(async (req, res) => {
  const ctx = need(req, 'tenant.manage');
  const b = parse(z.object({
    separateProposerApprover: z.boolean(), separateQuoteSubmitterApprover: z.boolean(), staleAfterDays: z.number().int().min(1).max(730), defaultValidityDays: z.number().int().min(1).max(365), internalDp: z.number().int().min(3).max(6),
    company: z.object({ name: z.string().min(1), address: z.string(), phone: z.string(), email: z.string(), taxNumber: z.string(), logoText: z.string().max(30) }),
  }), req.body);
  await db.update(S.tenants).set({ settings: b, name: b.company.name }).where(eq(S.tenants.id, ctx.tenantId));
  await audit(db, ctx, 'tenant', ctx.tenantId, 'settings_updated', b);
  res.json({ ok: true });
}));

// ---------- plants ----------
adminRouter.get('/plants', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await db.select().from(S.plants).where(eq(S.plants.tenantId, ctx.tenantId)).orderBy(asc(S.plants.code));
  res.json(rows.filter((p) => ctx.allPlants || ctx.plantIds.includes(p.id)));
}));
adminRouter.post('/plants', wrap(async (req, res) => {
  const ctx = need(req, 'tenant.manage');
  const b = parse(plantInput, req.body);
  const [p] = await db.insert(S.plants).values({ ...b, tenantId: ctx.tenantId }).returning();
  await audit(db, ctx, 'plant', p!.id, 'created', b);
  res.status(201).json(p);
}));
adminRouter.put('/plants/:id', wrap(async (req, res) => {
  const ctx = need(req, 'tenant.manage');
  const b = parse(plantInput, req.body);
  const [p] = await db.update(S.plants).set(b).where(and(eq(S.plants.tenantId, ctx.tenantId), eq(S.plants.id, String(req.params.id)))).returning();
  if (!p) throw new HttpError(404, 'not_found', 'Plant not found');
  await audit(db, ctx, 'plant', p.id, 'updated', b);
  res.json(p);
}));

// ---------- audit ----------
adminRouter.get('/audit', wrap(async (req, res) => {
  const ctx = need(req, 'audit.view');
  const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
  const rows = await db.select().from(S.auditEvents).where(and(eq(S.auditEvents.tenantId, ctx.tenantId), q.entityType ? eq(S.auditEvents.entityType, q.entityType) : undefined, q.entityId ? eq(S.auditEvents.entityId, q.entityId) : undefined)).orderBy(desc(S.auditEvents.id)).limit(q.limit);
  res.json(rows);
}));
/** Per-entity timeline, readable by anyone who can see the entity's screens (quotations). */
adminRouter.get('/audit/quotation/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const { loadQuote } = await import('../services/quotes.js');
  await loadQuote(db, ctx, String(req.params.id));
  const rows = await db.select().from(S.auditEvents).where(and(eq(S.auditEvents.tenantId, ctx.tenantId), eq(S.auditEvents.entityType, 'quotation'), eq(S.auditEvents.entityId, String(req.params.id)))).orderBy(asc(S.auditEvents.id));
  res.json(rows.map((r) => ({ ...r, detail: ctx.caps.includes('cost.view') ? r.detail : { comment: (r.detail as any)?.comment, revNo: (r.detail as any)?.revNo } })));
}));

// ---------- tax policies ----------
adminRouter.get('/tax-policies', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await db.select().from(S.taxPolicyVersions).where(eq(S.taxPolicyVersions.tenantId, ctx.tenantId)).orderBy(desc(S.taxPolicyVersions.validFrom)));
}));
adminRouter.post('/tax-policies', wrap(async (req, res) => {
  const ctx = need(req, 'tax.manage');
  const b = parse(taxPolicyInput, req.body);
  const [r] = await db.insert(S.taxPolicyVersions).values({ ...b, tenantId: ctx.tenantId, status: 'draft', createdBy: ctx.userId }).returning();
  await audit(db, ctx, 'tax_policy', r!.id, 'created', b);
  res.status(201).json(r);
}));
adminRouter.post('/tax-policies/:id/verify', wrap(async (req, res) => {
  const ctx = need(req, 'tax.verify');
  const { reference } = parse(z.object({ reference: z.string().min(5, 'Enter the verification source/reference') }), req.body);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(S.taxPolicyVersions).where(and(eq(S.taxPolicyVersions.tenantId, ctx.tenantId), eq(S.taxPolicyVersions.id, String(req.params.id)))).for('update');
    if (!p) throw new HttpError(404, 'not_found', 'Policy not found');
    if (p.status === 'verified') throw conflict('Already verified.');
    if (p.status === 'retired') throw conflict('A retired policy cannot be verified.');
    if (!p.sourceReference.trim()) throw unprocessable('Record the policy source/reference before verification.');
    await tx.update(S.taxPolicyVersions).set({ status: 'verified', verifiedBy: ctx.userId, verifiedAt: new Date(), verificationReference: reference }).where(eq(S.taxPolicyVersions.id, p.id));
    await audit(tx, ctx, 'tax_policy', p.id, 'verified', { reference });
  });
  res.json({ ok: true });
}));
adminRouter.post('/tax-policies/:id/retire', wrap(async (req, res) => {
  const ctx = need(req, 'tax.manage');
  const [p] = await db.update(S.taxPolicyVersions).set({ status: 'retired' }).where(and(eq(S.taxPolicyVersions.tenantId, ctx.tenantId), eq(S.taxPolicyVersions.id, String(req.params.id)))).returning();
  if (!p) throw new HttpError(404, 'not_found', 'Policy not found');
  await audit(db, ctx, 'tax_policy', p.id, 'retired', {});
  res.json({ ok: true });
}));

// ---------- terms ----------
adminRouter.get('/terms', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await db.select().from(S.termsVersions).where(eq(S.termsVersions.tenantId, ctx.tenantId)).orderBy(desc(S.termsVersions.version)));
}));
adminRouter.post('/terms', wrap(async (req, res) => {
  const ctx = need(req, 'terms.manage');
  const b = parse(termsInput, req.body);
  const [{ v }] = (await db.select({ v: sql<number>`coalesce(max(${S.termsVersions.version}),0)::int` }).from(S.termsVersions).where(eq(S.termsVersions.tenantId, ctx.tenantId))) as [{ v: number }];
  const [r] = await db.insert(S.termsVersions).values({ tenantId: ctx.tenantId, version: v + 1, name: b.name, clauses: b.clauses }).returning();
  await audit(db, ctx, 'terms', r!.id, 'created', { version: r!.version });
  res.status(201).json(r);
}));
adminRouter.post('/terms/:id/approve', wrap(async (req, res) => {
  const ctx = need(req, 'terms.manage');
  const [r] = await db.update(S.termsVersions).set({ status: 'approved', approvedBy: ctx.userId, approvedAt: new Date() }).where(and(eq(S.termsVersions.tenantId, ctx.tenantId), eq(S.termsVersions.id, String(req.params.id)), eq(S.termsVersions.status, 'draft'))).returning();
  if (!r) throw conflict('Only draft terms can be approved.');
  await audit(db, ctx, 'terms', r.id, 'approved', { version: r.version });
  res.json(r);
}));

// ---------- commercial pricing policies ----------
adminRouter.get('/pricing-policies', wrap(async (req, res) => {
  const ctx = need(req, 'policy.manage', 'cost.view');
  res.json(await db.select().from(S.pricingPolicies).where(eq(S.pricingPolicies.tenantId, ctx.tenantId)).orderBy(desc(S.pricingPolicies.validFrom)));
}));
adminRouter.post('/pricing-policies', wrap(async (req, res) => {
  const ctx = need(req, 'policy.manage');
  const b = parse(policyInput, req.body);
  const r = await db.transaction(async (tx) => {
    // close the currently open policy for the same key at the new effective date (new immutable version)
    const same = and(eq(S.pricingPolicies.tenantId, ctx.tenantId), b.plantId ? eq(S.pricingPolicies.plantId, b.plantId) : isNull(S.pricingPolicies.plantId), b.mixId ? eq(S.pricingPolicies.mixId, b.mixId) : isNull(S.pricingPolicies.mixId), isNull(S.pricingPolicies.validTo));
    const [prev] = await tx.select().from(S.pricingPolicies).where(same).orderBy(desc(S.pricingPolicies.version)).limit(1);
    if (prev && prev.validFrom >= b.validFrom) throw conflict('The new policy must take effect after the current one.');
    if (prev) await tx.update(S.pricingPolicies).set({ validTo: b.validFrom }).where(eq(S.pricingPolicies.id, prev.id));
    const [row] = await tx.insert(S.pricingPolicies).values({ ...b, tenantId: ctx.tenantId, version: (prev?.version ?? 0) + 1, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, 'pricing_policy', row!.id, 'created', b);
    return row;
  });
  res.status(201).json(r);
}));
