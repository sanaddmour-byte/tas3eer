import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { ForecastInput, MaterialInput, PlantCostInput, PriceInput, PricingPolicyInput, TaxPolicyInput } from '@rm/engine';
import { schema, type Db, type Tx } from '../db/client.js';

type Q = Db | Tx;
const { materials, materialPriceVersions, plantCostVersions, forecastVolumes, pricingPolicies, taxPolicyVersions, mixRevisions, mixes, mixIngredients } = schema;

export const today = () => new Date().toISOString().slice(0, 10);
const active = (t: { validFrom: any; validTo: any }, d: string) => and(lte(t.validFrom, d), or(isNull(t.validTo), gt(t.validTo, d)));
const trimNum = (v: string | null) => (v === null ? null : v.includes('.') ? v.replace(/\.?0+$/, '') || '0' : v);

export async function loadMaterials(q: Q, tenantId: string): Promise<MaterialInput[]> {
  const rows = await q.select().from(materials).where(eq(materials.tenantId, tenantId));
  return rows.map((m) => ({ id: m.id, name: m.nameEn, purchaseUnit: m.purchaseUnit as any, dosageUnit: m.dosageUnit as any, conversionFactor: trimNum(m.conversionFactor), densityKgPerM3: trimNum(m.densityKgPerM3), wastagePct: trimNum(m.wastagePct) ?? '0' }));
}
export async function loadPrices(q: Q, tenantId: string, plantId: string, asOf: string): Promise<PriceInput[]> {
  const rows = await q.select().from(materialPriceVersions).where(and(eq(materialPriceVersions.tenantId, tenantId), eq(materialPriceVersions.plantId, plantId), active(materialPriceVersions, asOf)));
  return rows.map((p) => ({ materialId: p.materialId, versionId: p.id, price: trimNum(p.price), basis: p.basis as any, freightPerPurchaseUnit: trimNum(p.freight), effectiveFrom: p.validFrom }));
}
export async function loadPlantCost(q: Q, tenantId: string, plantId: string, asOf: string): Promise<PlantCostInput | null> {
  const [r] = await q.select().from(plantCostVersions).where(and(eq(plantCostVersions.tenantId, tenantId), eq(plantCostVersions.plantId, plantId), eq(plantCostVersions.status, 'published'), active(plantCostVersions, asOf)));
  return r ? plantCostRow(r) : null;
}
export function plantCostRow(r: typeof plantCostVersions.$inferSelect): PlantCostInput {
  return { versionId: r.id, fixedCosts: r.fixedCosts as any, variableCosts: r.variableCosts as any, corporateOverheadPerM3: trimNum(r.corporateOverheadPerM3)!, riskProvisionPerM3: trimNum(r.riskProvisionPerM3)!, delivery: r.delivery as any, pumping: r.pumping as any };
}
export async function loadForecast(q: Q, tenantId: string, plantId: string, asOf: string): Promise<ForecastInput | null> {
  const [r] = await q.select().from(forecastVolumes).where(and(eq(forecastVolumes.tenantId, tenantId), eq(forecastVolumes.plantId, plantId), active(forecastVolumes, asOf)));
  return r ? { versionId: r.id, monthlyM3: trimNum(r.monthlyM3)!, validFrom: r.validFrom, validTo: r.validTo, source: r.source } : null;
}
export async function loadPolicies(q: Q, tenantId: string, asOf: string) {
  return q.select().from(pricingPolicies).where(and(eq(pricingPolicies.tenantId, tenantId), active(pricingPolicies, asOf)));
}
export function resolvePolicy(rows: (typeof pricingPolicies.$inferSelect)[], mixId: string, plantId: string): PricingPolicyInput | null {
  const score = (p: typeof rows[number]) => (p.mixId === mixId ? 2 : p.mixId ? -99 : 0) + (p.plantId === plantId ? 1 : p.plantId ? -99 : 0);
  const best = rows.map((p) => ({ p, s: score(p) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.p;
  return best ? { id: best.id, version: best.version, mode: best.mode as any, pct: trimNum(best.pct)!, minMarginPct: trimNum(best.minMarginPct)! } : null;
}
export function taxRow(r: typeof taxPolicyVersions.$inferSelect): TaxPolicyInput {
  return { id: r.id, name: r.name, status: r.status as any, ratePct: trimNum(r.ratePct)!, taxableComponents: r.taxableComponents as any, deductionAmount: trimNum(r.deductionAmount)!, deductionBasis: r.deductionBasis as any, nonNegativeBase: r.nonNegativeBase };
}
/** Tax policy by id, or the best active verified (else demo) policy at the date. */
export async function loadTax(q: Q, tenantId: string, asOf: string, id?: string | null) {
  if (id) {
    const [r] = await q.select().from(taxPolicyVersions).where(and(eq(taxPolicyVersions.tenantId, tenantId), eq(taxPolicyVersions.id, id)));
    return r ?? null;
  }
  const rows = await q.select().from(taxPolicyVersions).where(and(eq(taxPolicyVersions.tenantId, tenantId), inArray(taxPolicyVersions.status, ['verified', 'demo']), active(taxPolicyVersions, asOf)))
    .orderBy(asc(sql`case when ${taxPolicyVersions.status} = 'verified' then 0 else 1 end`), desc(taxPolicyVersions.validFrom));
  return rows[0] ?? null;
}

export interface MixRevData {
  id: string; mixId: string; revNo: number; status: string; code: string; nameEn: string; nameAr: string; grade: string; spec: Record<string, string>;
  ingredients: { materialId: string; dosage: string }[];
}
export async function loadMixRevs(q: Q, tenantId: string, ids: string[]): Promise<Map<string, MixRevData>> {
  const out = new Map<string, MixRevData>();
  if (!ids.length) return out;
  const revs = await q.select({ r: mixRevisions, m: mixes }).from(mixRevisions).innerJoin(mixes, and(eq(mixes.id, mixRevisions.mixId), eq(mixes.tenantId, mixRevisions.tenantId)))
    .where(and(eq(mixRevisions.tenantId, tenantId), inArray(mixRevisions.id, ids)));
  const ing = await q.select().from(mixIngredients).where(and(eq(mixIngredients.tenantId, tenantId), inArray(mixIngredients.mixRevisionId, ids)));
  for (const { r, m } of revs) out.set(r.id, { id: r.id, mixId: m.id, revNo: r.revNo, status: r.status, code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, grade: m.grade, spec: r.spec as any, ingredients: ing.filter((i) => i.mixRevisionId === r.id).map((i) => ({ materialId: i.materialId, dosage: trimNum(i.dosage)! })) });
  return out;
}
export { trimNum };
