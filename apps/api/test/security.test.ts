import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { db, schema } from '../src/db/client.js';
import { eq, sql } from 'drizzle-orm';
import { app, createQuote, loginAs, makeTenant, PW, quoteDoc, uniq, type TenantFx } from './helpers.js';

let A: TenantFx, B: TenantFx;
beforeAll(async () => { A = await makeTenant(); B = await makeTenant(); });

describe('authentication', () => {
  it('gives the same generic error for unknown email and wrong password', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'nobody@x.example', password: 'whatever-long' });
    const b = await request(app).post('/api/auth/login').send({ email: A.email('sales'), password: 'wrong-password-123' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
  it('sets an HttpOnly session cookie and rejects unsafe requests without CSRF token', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/login').send({ email: A.email('sales'), password: PW });
    expect(r.status).toBe(200);
    const cookie = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('rm_sid='))!;
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await agent.post('/api/clients').send({ name: 'x' })).status).toBe(403);
    expect((await agent.post('/api/clients').set('X-CSRF-Token', 'bad').send({ name: 'x' })).status).toBe(403);
    expect((await agent.post('/api/clients').set('X-CSRF-Token', r.body.csrfToken).set('Origin', 'http://evil.example').send({ name: 'x' })).status).toBe(403);
    expect((await agent.post('/api/clients').set('X-CSRF-Token', r.body.csrfToken).send({ name: 'Created ok' })).status).toBe(201);
  });
  it('logout and admin revocation end the session; disabling a user kills sessions', async () => {
    const s = await loginAs(A.email('viewer'));
    expect((await s.get('/api/auth/me')).status).toBe(200);
    const admin = await loginAs(A.email('admin'));
    const users = (await admin.get('/api/users')).body.users;
    const mid = users.find((u: any) => u.email === A.email('viewer')).membershipId;
    expect((await admin.post(`/api/users/${mid}/revoke-sessions`).send({})).body.revoked).toBeGreaterThan(0);
    expect((await s.get('/api/auth/me')).status).toBe(401);
    const s2 = await loginAs(A.email('viewer'));
    await admin.patch(`/api/users/${mid}`).send({ status: 'disabled' });
    expect((await s2.get('/api/auth/me')).status).toBe(401);
    await admin.patch(`/api/users/${mid}`).send({ status: 'active' });
  });
  it('public signup is disabled by default; first-run setup needs the deployment token and an empty database', async () => {
    expect((await request(app).post('/api/signup').send({})).status).toBe(404);
    const body = { companyName: 'Init Co', slug: `init-${uniq()}`, adminName: 'Boss', adminEmail: `boss-${uniq()}@x.example`, password: 'Long!Passw0rd-123' };
    expect((await request(app).post('/api/setup').send({ ...body, token: 'wrong' })).status).toBe(403);
    // database already has tenants → setup refuses even with a valid token
    const r = await request(app).post('/api/setup').send({ ...body, token: 'test-setup-token' });
    expect(r.status).toBe(409);
    expect((await request(app).get('/api/setup/status')).body.needsSetup).toBe(false);
  });
  it('invitation links are one-time and expiring', async () => {
    const admin = await loginAs(A.email('admin'));
    const inv = await admin.post('/api/users/invitations').send({ email: `new-${uniq()}@x.example`, role: 'sales', plantIds: [A.cat.plants.MRK] });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.link).searchParams.get('token')!;
    expect((await request(app).get(`/api/auth/invitations/${token}`)).status).toBe(200);
    const ok = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'New User', password: 'Another!Passw0rd1' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Again', password: 'Another!Passw0rd1' })).status).toBe(404);
    const inv2 = await admin.post('/api/users/invitations').send({ email: `exp-${uniq()}@x.example`, role: 'viewer' });
    const t2 = new URL(inv2.body.link).searchParams.get('token')!;
    await db.execute(sql`update invitations set expires_at = now() - interval '1 minute' where id = ${inv2.body.id}`);
    expect((await request(app).post('/api/auth/invitations/accept').send({ token: t2, name: 'Late', password: 'Another!Passw0rd1' })).status).toBe(404);
  });
  it('locks an account for 15 minutes after 10 failures, still answering with the same generic error', async () => {
    const email = A.email('viewer').replace('viewer-', 'lock-');
    const { createUser } = await import('../src/seed/fixture.js');
    await createUser(A.t.id, email, 'Lock Test', 'viewer', PW, { plantIds: [A.cat.plants.MRK!] });
    for (let i = 0; i < 10; i++) expect((await request(app).post('/api/auth/login').send({ email, password: 'wrong-password-123' })).status).toBe(401);
    const locked = await request(app).post('/api/auth/login').send({ email, password: PW });
    expect(locked.status).toBe(401); expect(locked.body.error.message).toBe('Invalid email or password.');
    await db.execute(sql`update users set locked_until = null, failed_logins = 0 where lower(email) = ${email.toLowerCase()}`);
    expect((await request(app).post('/api/auth/login').send({ email, password: PW })).status).toBe(200);
  });
  it('passwords are stored with argon2id', async () => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, A.email('sales')));
    expect(u!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});

describe('tenant isolation', () => {
  it('rejects cross-tenant references even when the IDs exist', async () => {
    const sA = await loginAs(A.email('sales'));
    // quote using tenant B's mix revision / client / project / plant
    const r1 = await sA.post('/api/quotations').send({ doc: quoteDoc(A, { lines: [{ id: 'l1', mixRevisionId: B.cat.mixes.C30!.revId, quantityM3: '10', priceOverride: null, costOverride: null }] }) });
    expect(r1.status).toBeGreaterThanOrEqual(400); expect(r1.status).toBeLessThan(500);
    const r2 = await sA.post('/api/quotations').send({ doc: quoteDoc(A, { clientId: B.clientId, projectId: B.projectId }) });
    expect(r2.status).toBeGreaterThanOrEqual(400); expect(r2.status).toBeLessThan(500);
    const r3 = await sA.post('/api/quotations').send({ doc: quoteDoc(A, { plantId: B.cat.plants.MRK }) });
    expect(r3.status).toBeGreaterThanOrEqual(400); expect(r3.status).toBeLessThan(500);
    const adminA = await loginAs(A.email('admin'));
    const p = await adminA.post('/api/projects').send({ clientId: B.clientId, name: 'Hijack' });
    expect(p.status).toBe(422);
    const m = await loginAs(A.email('tech'));
    const mix = await m.post('/api/mixes').send({ code: 'X1', nameEn: 'X', grade: 'C20', plantIds: [A.cat.plants.MRK], ingredients: [{ materialId: B.cat.materials.CEM, dosage: '300' }] });
    expect(mix.status).toBe(422);
    const asg = await adminA.patch(`/api/users/${(await adminA.get('/api/users')).body.users[0].membershipId}`).send({ plantIds: [B.cat.plants.MRK] });
    expect(asg.status).toBe(422);
  });
  it('database composite foreign keys reject cross-tenant rows directly', async () => {
    await expect(db.insert(schema.materialPriceVersions).values({ tenantId: A.t.id, materialId: B.cat.materials.CEM!, plantId: A.cat.plants.MRK!, price: '10', basis: 'delivered_plant', validFrom: '2030-01-01' })).rejects.toThrow();
  });
  it("cannot read another tenant's quotation, mixes or prices", async () => {
    const sA = await loginAs(A.email('sales'));
    const q = await createQuote(sA, quoteDoc(A));
    const sB = await loginAs(B.email('sales'));
    expect((await sB.get(`/api/quotations/${q.id}`)).status).toBe(404);
    const mixesB = (await sB.get('/api/mixes')).body;
    expect(mixesB.every((m: any) => B.cat.mixes[m.code]?.mixId === m.id)).toBe(true);
    const sync = await sB.put(`/api/quotations/${q.id}/revisions/1`).send({ baseVersion: 1, doc: quoteDoc(B) });
    expect(sync.status).toBe(404);
    const op = await sB.post('/api/sync/operations').send({ idempotencyKey: 'abcdefgh1234', type: 'quotation.save', quotationId: q.id, revNo: 1, baseVersion: 0, create: true, doc: quoteDoc(B) });
    expect(op.status).toBe(409);
  });
});

describe('role, plant and field-level visibility', () => {
  it('sales cannot retrieve internal costs through any endpoint', async () => {
    const s = await loginAs(A.email('sales'));
    expect((await s.get('/api/price-book')).status).toBe(403);
    expect((await s.get(`/api/plant-costs?plantId=${A.cat.plants.MRK}`)).status).toBe(403);
    expect((await s.get('/api/price-batches')).status).toBe(403);
    expect((await s.get('/api/pricing-policies')).status).toBe(403);
    const q = await createQuote(s, quoteDoc(A));
    expect(q.result.lines[0].internal).toBeUndefined();
    expect(q.result.internal).toBeUndefined();
    const detail = (await s.get(`/api/quotations/${q.id}`)).body;
    const dump = JSON.stringify(detail);
    expect(dump).not.toMatch(/costPerM3|fullCostPerM3|marginPct|contributionBeforeFixed|fixedAllocated|effectivePricePerPurchaseUnit/);
    const rev = (await s.get(`/api/mix-revisions/${A.cat.mixes.C30!.revId}/pricing`)).body;
    expect(rev.pricing[0].customerRatePerM3).toBeTruthy();
    expect(rev.pricing[0].internal).toBeUndefined();
    const mix = (await s.get(`/api/mixes/${A.cat.mixes.C30!.mixId}`)).body;
    expect(mix.recipeVisible).toBe(false);
    expect(JSON.stringify(mix)).not.toMatch(/"dosage"/);
    const ref = (await s.get('/api/reference/sales')).body;
    const refDump = JSON.stringify(ref);
    expect(refDump).not.toMatch(/monthlyJod|"fixedCosts":\[\{|jodPerM3/);
    expect(ref.plants.every((p: any) => p.id === A.cat.plants.MRK)).toBe(true); // plant scope
  });
  it('pricing users do see costs; sales cannot override cost or exceed plant scope', async () => {
    const p = await loginAs(A.email('pricing'));
    const book = await p.get('/api/price-book'); expect(book.status).toBe(200);
    const s = await loginAs(A.email('sales'));
    const costOv = await s.post('/api/quotations').send({ doc: quoteDoc(A, { lines: [{ id: 'l1', mixRevisionId: A.cat.mixes.C30!.revId, quantityM3: '5', priceOverride: null, costOverride: { perM3: '10', reason: 'x' } }] }) });
    expect(costOv.status).toBe(403);
    const shb = await s.post('/api/quotations').send({ doc: quoteDoc(A, { plantId: A.cat.plants.SHB }) });
    expect(shb.status).toBe(403);
    const pr = await p.post('/api/quotations').send({ doc: quoteDoc(A) });
    expect(pr.status).toBe(403); // pricing has no quote.create
  });
  it('sales only see their own quotations; viewer is read-only', async () => {
    const s1 = await loginAs(A.email('sales')); const s2 = await loginAs(A.email('sales2'));
    const q = await createQuote(s1, quoteDoc(A));
    expect((await s2.get(`/api/quotations/${q.id}`)).status).toBe(404);
    const list = (await s2.get('/api/quotations')).body;
    expect(list.find((x: any) => x.id === q.id)).toBeUndefined();
    const v = await loginAs(A.email('viewer'));
    expect((await v.get(`/api/quotations/${q.id}`)).status).toBe(200);
    expect((await v.post('/api/quotations').send({ doc: quoteDoc(A) })).status).toBe(403);
    expect((await v.get('/api/price-book')).status).toBe(403);
  });
});
