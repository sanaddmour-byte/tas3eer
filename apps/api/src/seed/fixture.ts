import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { hashPassword } from '../auth.js';
import { DEFAULT_SETTINGS } from '../http.js';

const S = schema;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
export { iso };

export interface CatalogIds { plants: Record<string, string>; materials: Record<string, string>; mixes: Record<string, { mixId: string; revId: string }>; }

export async function createTenant(name: string, slug: string, opts: { demo?: boolean } = {}) {
  const [t] = await db.insert(S.tenants).values({ name, slug, isDemo: !!opts.demo, settings: { ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, name, logoText: name.split(' ')[0] } } }).returning();
  return t!;
}
export async function createUser(tenantId: string, email: string, name: string, role: string, password: string, opts: { allPlants?: boolean; plantIds?: string[]; grant?: string[]; revoke?: string[] } = {}) {
  const lower = email.toLowerCase();
  let [u] = await db.select().from(S.users).where(eq(S.users.email, lower));
  if (!u) [u] = await db.insert(S.users).values({ email: lower, name, passwordHash: await hashPassword(password) }).returning();
  const [m] = await db.insert(S.memberships).values({ tenantId, userId: u!.id, role, allPlants: opts.allPlants ?? (role === 'admin' || role === 'pricing' || role === 'technical'), grant: opts.grant ?? [], revoke: opts.revoke ?? [] }).returning();
  for (const p of opts.plantIds ?? []) await db.insert(S.plantAssignments).values({ tenantId, membershipId: m!.id, plantId: p });
  return { user: u!, membership: m! };
}

/** Illustrative catalog. Every number below is an ASSUMPTION for demos/tests, not a company-approved value. */
export async function seedCatalog(tenantId: string, actorUserId: string, plantDefs: { code: string; nameEn: string; nameAr: string }[], opts: { approveMixes?: boolean } = {}): Promise<CatalogIds> {
  const ids: CatalogIds = { plants: {}, materials: {}, mixes: {} };
  for (const p of plantDefs) { const [r] = await db.insert(S.plants).values({ tenantId, ...p, address: 'Illustrative address' }).returning(); ids.plants[p.code] = r!.id; }
  const mats = [
    { code: 'CEM', nameEn: 'Cement CEM I 42.5', nameAr: 'إسمنت', category: 'cement', purchaseUnit: 'tonne', dosageUnit: 'kg' },
    { code: 'SAND', nameEn: 'Washed sand', nameAr: 'رمل مغسول', category: 'sand', purchaseUnit: 'tonne', dosageUnit: 'kg' },
    { code: 'AGG19', nameEn: 'Aggregate 3/4"', nameAr: 'حصمة ٣/٤', category: 'aggregate', purchaseUnit: 'tonne', dosageUnit: 'kg' },
    { code: 'AGG10', nameEn: 'Aggregate 3/8"', nameAr: 'حصمة ٣/٨', category: 'aggregate', purchaseUnit: 'tonne', dosageUnit: 'kg' },
    { code: 'WATER', nameEn: 'Water', nameAr: 'ماء', category: 'water', purchaseUnit: 'm3', dosageUnit: 'L' },
    { code: 'ADM', nameEn: 'Superplasticizer', nameAr: 'إضافة مخفضة للماء', category: 'admixture', purchaseUnit: 'L', dosageUnit: 'kg', densityKgPerM3: '1100' },
  ];
  for (const m of mats) { const [r] = await db.insert(S.materials).values({ tenantId, ...m, wastagePct: m.code === 'CEM' ? '1' : '0' }).returning(); ids.materials[m.code] = r!.id; }
  const priceFor: Record<string, [string, 'ex_source' | 'delivered_plant', string | null]> = {
    CEM: ['78', 'delivered_plant', null], SAND: ['9.5', 'ex_source', '3'], AGG19: ['8.5', 'ex_source', '3.5'], AGG10: ['9', 'ex_source', '3.5'], WATER: ['1.2', 'delivered_plant', null], ADM: ['1.15', 'delivered_plant', null],
  };
  const costs = {
    fixedCosts: [{ key: 'wages', name: 'Wages & salaries', nature: 'wages', monthlyJod: '17000' }, { key: 'dep', name: 'Plant depreciation', nature: 'depreciation', monthlyJod: '7500' }, { key: 'maint', name: 'Maintenance', nature: 'maintenance', monthlyJod: '3500' }, { key: 'ins', name: 'Insurance & licences', nature: 'other', monthlyJod: '2000' }],
    variableCosts: [{ key: 'elec', name: 'Electricity & fuel', nature: 'utilities', jodPerM3: '0.9' }, { key: 'cons', name: 'Plant consumables', nature: 'consumables', jodPerM3: '0.45' }],
    delivery: { perM3: { chargePerM3: '4.5', costPerM3: '3.6' }, zones: [{ code: 'Z1', name: 'Zone 1 – Near', chargePerM3: '4', costPerM3: '3.2' }, { code: 'Z2', name: 'Zone 2 – Mid', chargePerM3: '5.5', costPerM3: '4.4' }, { code: 'Z3', name: 'Zone 3 – Far', chargePerM3: '8', costPerM3: '6.5' }], trip: { truckCapacityM3: '7', chargePerTrip: '38', fixedCostPerTrip: '4', costPerKm: '0.45' } },
    pumping: { chargePerM3: '2', minCharge: '150', minBasis: 'per_visit', mobilizationFee: '25', extraHourRate: '30', costPerM3: '1.1', costPerUnit: '30' },
  };
  for (const [code, pid] of Object.entries(ids.plants)) {
    const bump = code === 'AQB' ? 1.1 : 1;
    const stale = code === 'AQB';
    for (const [mc, mid] of Object.entries(ids.materials)) {
      const [p, basis, fr] = priceFor[mc]!;
      await db.insert(S.materialPriceVersions).values({ tenantId, materialId: mid, plantId: pid, price: (Number(p) * (mc === 'CEM' ? bump : 1)).toFixed(3), basis, freight: fr, validFrom: iso(stale && mc === 'CEM' ? -120 : -45), source: 'Illustrative demo assumption', createdBy: actorUserId });
    }
    const [pcv] = await db.insert(S.plantCostVersions).values({ tenantId, plantId: pid, status: 'draft', validFrom: iso(-200), ...costs, corporateOverheadPerM3: '1.2', riskProvisionPerM3: '0.5', note: 'Illustrative demo assumptions', createdBy: actorUserId }).returning();
    await db.update(S.plantCostVersions).set({ status: 'published', publishedBy: actorUserId, publishedAt: new Date() }).where(eq(S.plantCostVersions.id, pcv!.id));
    await db.insert(S.forecastVolumes).values({ tenantId, plantId: pid, monthlyM3: code === 'MRK' ? '10000' : '6000', validFrom: iso(-200), source: 'Illustrative budget assumption', createdBy: actorUserId });
  }
  const rec = (c: number, w: number, s: number, a19: number, a10: number, adm: number) => [['CEM', c], ['WATER', w], ['SAND', s], ['AGG19', a19], ['AGG10', a10], ['ADM', adm]] as const;
  const defs = [
    { code: 'C25', nameEn: 'C25/30 Pumpable', nameAr: 'خرسانة C25 قابلة للضخ', grade: 'C25/30', spec: { strengthMpa: '30', slumpMm: '150', maxAggregateMm: '19', cementType: 'CEM I 42.5', exposure: 'XC1', notes: '' }, ing: rec(320, 185, 850, 600, 420, 2.6) },
    { code: 'C30', nameEn: 'C30/37 Pumpable', nameAr: 'خرسانة C30 قابلة للضخ', grade: 'C30/37', spec: { strengthMpa: '37', slumpMm: '150', maxAggregateMm: '19', cementType: 'CEM I 42.5', exposure: 'XC2', notes: '' }, ing: rec(350, 180, 820, 600, 420, 3.0) },
    { code: 'C35', nameEn: 'C35/45 Structural', nameAr: 'خرسانة C35 إنشائية', grade: 'C35/45', spec: { strengthMpa: '45', slumpMm: '160', maxAggregateMm: '19', cementType: 'CEM I 42.5', exposure: 'XC4', notes: '' }, ing: rec(380, 175, 800, 600, 410, 3.6) },
    { code: 'C40', nameEn: 'C40/50 High strength', nameAr: 'خرسانة C40 عالية المقاومة', grade: 'C40/50', spec: { strengthMpa: '50', slumpMm: '180', maxAggregateMm: '14', cementType: 'CEM I 42.5', exposure: 'XD1', notes: '' }, ing: rec(420, 170, 780, 560, 420, 4.4) },
  ];
  for (const d of defs) {
    const [m] = await db.insert(S.mixes).values({ tenantId, code: d.code, nameEn: d.nameEn, nameAr: d.nameAr, grade: d.grade }).returning();
    for (const pid of Object.values(ids.plants)) await db.insert(S.mixPlants).values({ tenantId, mixId: m!.id, plantId: pid });
    const [r] = await db.insert(S.mixRevisions).values({ tenantId, mixId: m!.id, revNo: 1, status: 'draft', spec: d.spec, createdBy: actorUserId }).returning();
    for (const [mc, dosage] of d.ing) await db.insert(S.mixIngredients).values({ tenantId, mixRevisionId: r!.id, materialId: ids.materials[mc]!, dosage: String(dosage) });
    if (opts.approveMixes !== false) await db.update(S.mixRevisions).set({ status: 'approved', approvedBy: actorUserId, approvedAt: new Date() }).where(eq(S.mixRevisions.id, r!.id));
    ids.mixes[d.code] = { mixId: m!.id, revId: r!.id };
  }
  await db.insert(S.pricingPolicies).values({ tenantId, name: 'Default gross margin (demo assumption)', mode: 'gross_margin', pct: '18', minMarginPct: '12', validFrom: iso(-200), createdBy: actorUserId });
  await db.insert(S.pricingPolicies).values({ tenantId, name: 'C40 high strength margin (demo assumption)', mode: 'gross_margin', pct: '22', minMarginPct: '15', mixId: ids.mixes.C40!.mixId, validFrom: iso(-200), createdBy: actorUserId });
  return ids;
}

export async function seedTaxAndTerms(tenantId: string, actorUserId: string, opts: { verified?: boolean } = {}) {
  const [tax] = await db.insert(S.taxPolicyVersions).values({
    tenantId, policyKey: 'general', name: opts.verified ? 'Sales tax' : 'DEMO — general sales tax 16% (illustrative, NOT verified)', status: opts.verified ? 'verified' : 'demo', ratePct: '16', taxableComponents: ['concrete', 'delivery', 'pumping', 'other'],
    deductionAmount: '0', deductionBasis: 'per_document', nonNegativeBase: true, sourceReference: opts.verified ? 'Test fixture' : 'Illustrative demo value — confirm with the company tax adviser', isDemo: !opts.verified, validFrom: iso(-365), createdBy: actorUserId,
    ...(opts.verified ? { verifiedBy: actorUserId, verifiedAt: new Date(), verificationReference: 'Test fixture' } : {}),
  }).returning();
  const [terms] = await db.insert(S.termsVersions).values({ tenantId, version: 1, name: 'DEMO placeholder terms — replace with approved wording', isPlaceholder: !opts.verified, status: opts.verified ? 'approved' : 'draft', clauses: [{ title: 'Placeholder A', text: '[Insert company-approved clause text here.]' }, { title: 'Placeholder B', text: '[Insert company-approved clause text here.]' }], ...(opts.verified ? { approvedBy: actorUserId, approvedAt: new Date() } : {}) }).returning();
  return { taxId: tax!.id, termsId: terms!.id };
}
export async function createClientProject(tenantId: string, name = 'Al-Noor Contracting', project = 'Tower A – Abdali') {
  const [c] = await db.insert(S.clients).values({ tenantId, name, taxNumber: '1234567', contacts: [{ name: 'Site engineer', phone: '+962 7 9000 0000', email: 'site@example.com' }] }).returning();
  const [p] = await db.insert(S.projects).values({ tenantId, clientId: c!.id, name: project, siteAddress: 'Amman – illustrative site address' }).returning();
  return { clientId: c!.id, projectId: p!.id };
}
