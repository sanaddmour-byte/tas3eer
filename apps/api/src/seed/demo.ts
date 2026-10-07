import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ctxFromMembership } from '../auth.js';
import { db, pool, schema } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import * as Q from '../services/quotes.js';
import { createClientProject, createTenant, createUser, iso, seedCatalog, seedTaxAndTerms } from './fixture.js';
import type { QuoteDocument } from '@rm/shared';

const S = schema;
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo!Passw0rd2026';

/** Clearly labelled DEMO tenant. All figures are illustrative assumptions — not company-approved values. */
export async function seedDemo() {
  const existing = await db.select().from(S.tenants).where(eq(S.tenants.slug, 'demo-readymix'));
  if (existing.length) { console.log('Demo tenant already exists — skipping.'); return; }
  const t = await createTenant('DEMO Ready Mix Co. (illustrative data)', 'demo-readymix', { demo: true });
  const admin = await createUser(t.id, 'admin@demo.example', 'Dana Admin', 'admin', DEMO_PASSWORD);
  const cat = await seedCatalog(t.id, admin.user.id, [
    { code: 'MRK', nameEn: 'Marka', nameAr: 'ماركا' }, { code: 'SHB', nameEn: 'Sahab', nameAr: 'سحاب' }, { code: 'AQB', nameEn: 'Aqaba', nameAr: 'العقبة' },
  ]);
  const { taxId, termsId } = await seedTaxAndTerms(t.id, admin.user.id);
  await db.insert(S.taxPolicyVersions).values({ tenantId: t.id, policyKey: 'demo-deduction', name: 'DEMO — deduction mechanism example (16 JOD per m³; NOT a verified rule)', status: 'draft', ratePct: '16', taxableComponents: ['concrete', 'delivery', 'pumping', 'other'], deductionAmount: '16', deductionBasis: 'per_m3', nonNegativeBase: true, sourceReference: '', isDemo: true, validFrom: iso(-365), createdBy: admin.user.id });
  const pricing = await createUser(t.id, 'pricing@demo.example', 'Pia Pricing', 'pricing', DEMO_PASSWORD);
  const finance = await createUser(t.id, 'finance@demo.example', 'Faris Finance', 'pricing', DEMO_PASSWORD);
  const tech = await createUser(t.id, 'technical@demo.example', 'Tala Technical', 'technical', DEMO_PASSWORD);
  const tech2 = await createUser(t.id, 'qa@demo.example', 'Qasem QA', 'technical', DEMO_PASSWORD);
  const sales = await createUser(t.id, 'sales@demo.example', 'Sami Sales', 'sales', DEMO_PASSWORD, { plantIds: [cat.plants.MRK!, cat.plants.SHB!] });
  const sales2 = await createUser(t.id, 'sales2@demo.example', 'Salma Sales', 'sales', DEMO_PASSWORD, { plantIds: [cat.plants.SHB!, cat.plants.AQB!] });
  await createUser(t.id, 'viewer@demo.example', 'Vera Viewer', 'viewer', DEMO_PASSWORD, { plantIds: [cat.plants.MRK!] });
  const { clientId, projectId } = await createClientProject(t.id);
  const c2 = await createClientProject(t.id, 'Jordan Valley Builders', 'Warehouse – Sahab');
  const c3 = await createClientProject(t.id, 'Petra Infrastructure', 'Road bridge – Aqaba');

  // draft mix revision (C30 rev 2) + a mix with missing information
  const [r2] = await db.insert(S.mixRevisions).values({ tenantId: t.id, mixId: cat.mixes.C30!.mixId, revNo: 2, status: 'draft', spec: { strengthMpa: '37', slumpMm: '', maxAggregateMm: '19', cementType: 'CEM I 42.5', exposure: 'XC2', notes: 'Trial: reduce cement 10 kg' }, createdBy: tech.user.id }).returning();
  for (const [m, d] of [['CEM', '340'], ['WATER', '180'], ['SAND', '825'], ['AGG19', '600'], ['AGG10', '420'], ['ADM', '3.0']] as const) await db.insert(S.mixIngredients).values({ tenantId: t.id, mixRevisionId: r2!.id, materialId: cat.materials[m]!, dosage: d });
  const [mx] = await db.insert(S.mixes).values({ tenantId: t.id, code: 'C50', nameEn: 'C50/60 (draft – data incomplete)', nameAr: '', grade: 'C50/60' }).returning();
  await db.insert(S.mixPlants).values({ tenantId: t.id, mixId: mx!.id, plantId: cat.plants.MRK! });
  await db.insert(S.mixRevisions).values({ tenantId: t.id, mixId: mx!.id, revNo: 1, status: 'draft', spec: { strengthMpa: '60', slumpMm: '', maxAggregateMm: '', cementType: '', exposure: '', notes: '' }, createdBy: tech.user.id });

  // price update proposals
  const mk = async (name: string, status: 'submitted' | 'draft', pct: number, by: typeof pricing) => {
    const [b] = await db.insert(S.priceBatches).values({ tenantId: t.id, name, plantId: cat.plants.MRK!, status: 'draft', effectiveFrom: iso(1), createdBy: by.user.id, history: [{ at: new Date().toISOString(), by: by.user.name, byUserId: by.user.id, action: 'created', comment: null }] }).returning();
    const [cur] = await db.select().from(S.materialPriceVersions).where(eq(S.materialPriceVersions.materialId, cat.materials.CEM!));
    const cems = await db.select().from(S.materialPriceVersions).where(eq(S.materialPriceVersions.plantId, cat.plants.MRK!));
    const c = cems.find((x) => x.materialId === cat.materials.CEM!)!;
    await db.insert(S.priceBatchItems).values({ tenantId: t.id, batchId: b!.id, rowNo: 1, materialId: c.materialId, plantId: c.plantId, baseVersionId: c.id, basePrice: c.price, baseBasis: c.basis, baseFreight: c.freight, proposedPrice: (Number(c.price) * (1 + pct / 100)).toFixed(3), proposedBasis: c.basis, proposedFreight: c.freight, effectiveFrom: iso(1), impact: [] });
    if (status === 'submitted') await db.update(S.priceBatches).set({ status: 'submitted', submittedBy: by.user.id, submittedAt: new Date() }).where(eq(S.priceBatches.id, b!.id));
    void cur;
  };
  await mk('Marka cement +6% (supplier notice) — demo', 'submitted', 6, pricing);
  await mk('Marka cement review (draft) — demo', 'draft', 2, finance);

  // quotations through the real service layer
  const sCtx = await ctxFromMembership(sales.membership.id);
  const s2Ctx = await ctxFromMembership(sales2.membership.id);
  const fCtx = await ctxFromMembership(finance.membership.id);
  const base = (over: Partial<QuoteDocument>): QuoteDocument => ({ clientId, projectId, plantId: cat.plants.MRK!, scope: 'supply_only', taxPolicyId: null, termsVersionId: termsId, validityDays: 14, paymentTerms: 'Payment terms: [to be confirmed by company]', supplySchedule: '', customerNotes: '', internalNotes: '', lines: [], services: [], pinnedReference: false, ...over });
  const line = (id: string, mix: string, q: string, extra: object = {}) => ({ id, mixRevisionId: cat.mixes[mix]!.revId, quantityM3: q, priceOverride: null, costOverride: null, ...extra });
  const mkQuote = async (ctx: typeof sCtx, doc: QuoteDocument, steps: ('submit' | 'approve' | 'return')[] = []) => {
    const id = crypto.randomUUID();
    await db.transaction((tx) => Q.saveDraft(tx, ctx, { quotationId: id, revNo: 1, baseVersion: 0, doc, create: true }));
    for (const s of steps) {
      if (s === 'submit') await db.transaction((tx) => Q.submitRevision(tx, ctx, id, 1, {}));
      if (s === 'approve') await db.transaction((tx) => Q.decideApproval(tx, fCtx, id, 1, 'approved', 'Approved in demo seed'));
      if (s === 'return') await db.transaction((tx) => Q.decideApproval(tx, fCtx, id, 1, 'returned', 'Please confirm quantity with the client.'));
    }
    return id;
  };
  await mkQuote(sCtx, base({ lines: [line('l1', 'C30', '120')] }));
  await mkQuote(sCtx, base({ clientId: c2.clientId, projectId: c2.projectId, plantId: cat.plants.SHB!, scope: 'supply_delivery_pumping', lines: [line('l1', 'C25', '60'), line('l2', 'C35', '40')], services: [{ id: 's1', type: 'delivery', method: 'zone', zoneCode: 'Z2' }, { id: 's2', type: 'pumping', units: 2 }] }));
  await mkQuote(sCtx, base({ lines: [line('l1', 'C35', '80', { priceOverride: { perM3: '58', reason: 'Competitor offered a lower rate; keep the project.' } })], scope: 'supply_delivery', services: [{ id: 's1', type: 'delivery', method: 'per_m3' }] }), ['submit']);
  await mkQuote(s2Ctx, base({ clientId: c3.clientId, projectId: c3.projectId, plantId: cat.plants.AQB!, lines: [line('l1', 'C40', '250')] }), ['submit']); // within policy → auto-approved
  await mkQuote(sCtx, base({ lines: [line('l1', 'C25', '30', { priceOverride: { perM3: '52', reason: 'Volume discount for repeat client.' } })] }), ['submit', 'return']);
  console.log('Demo tenant seeded: DEMO Ready Mix Co. (slug demo-readymix)');
  console.log(`Users (password: ${DEMO_PASSWORD}): admin@, pricing@, finance@, technical@, qa@, sales@, sales2@, viewer@demo.example`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations().then(seedDemo).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
