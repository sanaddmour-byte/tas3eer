import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { createClientProject, createTenant, createUser, seedCatalog, seedTaxAndTerms } from '../src/seed/fixture.js';

export const app = createApp();
export const PW = 'Test!Passw0rd-1234';
export const uniq = () => crypto.randomBytes(4).toString('hex');

export async function loginAs(email: string, tenantSlug?: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PW, tenantSlug });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => { const r = (agent as any)[m](url); if (m !== 'get') r.set('X-CSRF-Token', csrf); return r as request.Test; };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete'), me: res.body, raw: agent };
}
export type Session = Awaited<ReturnType<typeof loginAs>>;

/** A full tenant: admin, pricing(2), technical(2), sales(2), viewer + catalog + verified tax + approved terms. */
export async function makeTenant(opts: { verified?: boolean; slug?: string } = {}) {
  const id = uniq();
  const t = await createTenant(`Test Co ${id}`, opts.slug ?? `t-${id}`);
  const admin = await createUser(t.id, `admin-${id}@t.example`, 'Admin', 'admin', PW);
  const cat = await seedCatalog(t.id, admin.user.id, [{ code: 'MRK', nameEn: 'Marka', nameAr: 'ماركا' }, { code: 'SHB', nameEn: 'Sahab', nameAr: 'سحاب' }]);
  const { taxId, termsId } = await seedTaxAndTerms(t.id, admin.user.id, { verified: opts.verified ?? true });
  const users = {
    admin: admin,
    pricing: await createUser(t.id, `pricing-${id}@t.example`, 'Pricing', 'pricing', PW),
    finance: await createUser(t.id, `finance-${id}@t.example`, 'Finance', 'pricing', PW),
    tech: await createUser(t.id, `tech-${id}@t.example`, 'Tech', 'technical', PW),
    qa: await createUser(t.id, `qa-${id}@t.example`, 'QA', 'technical', PW),
    sales: await createUser(t.id, `sales-${id}@t.example`, 'Sales', 'sales', PW, { plantIds: [cat.plants.MRK!] }),
    sales2: await createUser(t.id, `sales2-${id}@t.example`, 'Sales2', 'sales', PW, { plantIds: [cat.plants.MRK!, cat.plants.SHB!] }),
    viewer: await createUser(t.id, `viewer-${id}@t.example`, 'Viewer', 'viewer', PW, { plantIds: [cat.plants.MRK!] }),
  };
  const cp = await createClientProject(t.id);
  const email = (k: keyof typeof users) => users[k].user.email;
  return { t, id, cat, taxId, termsId, users, email, ...cp };
}
export type TenantFx = Awaited<ReturnType<typeof makeTenant>>;

export function quoteDoc(fx: TenantFx, over: Record<string, unknown> = {}) {
  return {
    clientId: fx.clientId, projectId: fx.projectId, plantId: fx.cat.plants.MRK, scope: 'supply_only', taxPolicyId: null, termsVersionId: fx.termsId, validityDays: 14,
    paymentTerms: '[test payment terms]', supplySchedule: '', customerNotes: 'Test note', internalNotes: 'secret internal note', pinnedReference: false,
    lines: [{ id: 'l1', mixRevisionId: fx.cat.mixes.C30!.revId, quantityM3: '50', priceOverride: null, costOverride: null }], services: [], ...over,
  };
}
export async function createQuote(s: Session, doc: unknown) {
  const r = await s.post('/api/quotations').send({ doc });
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; revNo: number; version: number; result: any };
}
