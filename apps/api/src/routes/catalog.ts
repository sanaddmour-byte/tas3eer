import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { forecastInput, isoDate, materialInput, mixInput, mixRevisionInput, plantCostInput, uuid } from '@rm/shared';
import { fixedCostSensitivity, materialCostBreakdown, priceQuotation, validatePlantCost, PricingError, dosageUnitsPerPurchaseUnit } from '@rm/engine';
import { db, schema, type Db, type Tx } from '../db/client.js';
import { audit } from '../services/audit.js';
import { conflict, ctxOf, has, HttpError, need, parse, plantAllowed, unprocessable, wrap, forbidden, type Ctx } from '../http.js';
import { loadForecast, loadMaterials, loadMixRevs, loadPlantCost, loadPolicies, loadPrices, loadTax, plantCostRow, resolvePolicy, taxRow, today, trimNum } from '../services/reference.js';

export const catalogRouter = Router();
const S = schema;

// ---------- materials ----------
catalogRouter.get('/materials', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await db.select().from(S.materials).where(eq(S.materials.tenantId, ctx.tenantId)).orderBy(asc(S.materials.code)));
}));
function validateMaterialUnits(b: z.infer<typeof materialInput>) {
  try { dosageUnitsPerPurchaseUnit({ id: 'x', name: b.nameEn, purchaseUnit: b.purchaseUnit, dosageUnit: b.dosageUnit, conversionFactor: b.conversionFactor, densityKgPerM3: b.densityKgPerM3, wastagePct: b.wastagePct }); }
  catch (e) { if (e instanceof PricingError) throw unprocessable(e.issues[0]!.message); throw e; }
}
catalogRouter.post('/materials', wrap(async (req, res) => {
  const ctx = need(req, 'material.manage');
  const b = parse(materialInput, req.body); validateMaterialUnits(b);
  const [m] = await db.insert(S.materials).values({ ...b, tenantId: ctx.tenantId }).returning();
  await audit(db, ctx, 'material', m!.id, 'created', b);
  res.status(201).json(m);
}));
catalogRouter.put('/materials/:id', wrap(async (req, res) => {
  const ctx = need(req, 'material.manage');
  const b = parse(materialInput, req.body); validateMaterialUnits(b);
  const [m] = await db.update(S.materials).set(b).where(and(eq(S.materials.tenantId, ctx.tenantId), eq(S.materials.id, String(req.params.id)))).returning();
  if (!m) throw new HttpError(404, 'not_found', 'Material not found');
  await audit(db, ctx, 'material', m.id, 'updated', b);
  res.json(m);
}));

// ---------- price book (cost-confidential) ----------
catalogRouter.get('/price-book', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const q = z.object({ plantId: uuid.optional(), asOf: isoDate.default(today()) }).parse(req.query);
  const plantIds = q.plantId ? [q.plantId] : ctx.allPlants ? undefined : ctx.plantIds;
  if (q.plantId && !plantAllowed(ctx, q.plantId)) throw forbidden('This plant is outside your plant scope.');
  const rows = await db.select().from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), plantIds ? inArray(S.materialPriceVersions.plantId, plantIds) : undefined,
    sql`${S.materialPriceVersions.validFrom} <= ${q.asOf} and (${S.materialPriceVersions.validTo} is null or ${S.materialPriceVersions.validTo} > ${q.asOf})`));
  // pending proposals (submitted batches) for the same keys
  const pending = await db.select({ i: S.priceBatchItems, b: S.priceBatches }).from(S.priceBatchItems).innerJoin(S.priceBatches, and(eq(S.priceBatches.id, S.priceBatchItems.batchId), eq(S.priceBatches.tenantId, S.priceBatchItems.tenantId)))
    .where(and(eq(S.priceBatches.tenantId, ctx.tenantId), inArray(S.priceBatches.status, ['draft', 'submitted', 'returned']), sql`${S.priceBatchItems.batchRevision} = ${S.priceBatches.currentRevision}`));
  res.json({ asOf: q.asOf, prices: rows, proposals: pending.map((p) => ({ materialId: p.i.materialId, plantId: p.i.plantId, proposedPrice: p.i.proposedPrice, batchId: p.b.id, batchName: p.b.name, batchStatus: p.b.status, effectiveFrom: p.i.effectiveFrom })) });
}));
catalogRouter.get('/price-book/history', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const q = z.object({ plantId: uuid, materialId: uuid }).parse(req.query);
  if (!plantAllowed(ctx, q.plantId)) throw forbidden();
  res.json(await db.select().from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, q.plantId), eq(S.materialPriceVersions.materialId, q.materialId))).orderBy(desc(S.materialPriceVersions.validFrom)));
}));

// ---------- plant costs ----------
catalogRouter.get('/plant-costs', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const q = z.object({ plantId: uuid }).parse(req.query);
  if (!plantAllowed(ctx, q.plantId)) throw forbidden();
  const versions = await db.select().from(S.plantCostVersions).where(and(eq(S.plantCostVersions.tenantId, ctx.tenantId), eq(S.plantCostVersions.plantId, q.plantId))).orderBy(desc(S.plantCostVersions.validFrom), desc(S.plantCostVersions.createdAt));
  const forecasts = await db.select().from(S.forecastVolumes).where(and(eq(S.forecastVolumes.tenantId, ctx.tenantId), eq(S.forecastVolumes.plantId, q.plantId))).orderBy(desc(S.forecastVolumes.validFrom));
  res.json({ versions, forecasts, activeVersionId: (await loadPlantCost(db, ctx.tenantId, q.plantId, today()))?.versionId ?? null, activeForecastId: (await loadForecast(db, ctx.tenantId, q.plantId, today()))?.versionId ?? null });
}));
catalogRouter.post('/plant-costs', wrap(async (req, res) => {
  const ctx = need(req, 'plantcost.manage');
  const b = parse(plantCostInput, req.body);
  if (!plantAllowed(ctx, b.plantId)) throw forbidden();
  const issues = validatePlantCost({ versionId: 'new', fixedCosts: b.fixedCosts as any, variableCosts: b.variableCosts as any, corporateOverheadPerM3: b.corporateOverheadPerM3, riskProvisionPerM3: b.riskProvisionPerM3, delivery: b.delivery as any, pumping: b.pumping as any });
  if (issues.length) throw unprocessable(issues[0]!.message, { issues });
  const [r] = await db.insert(S.plantCostVersions).values({ tenantId: ctx.tenantId, plantId: b.plantId, status: 'draft', validFrom: b.validFrom, fixedCosts: b.fixedCosts, variableCosts: b.variableCosts, corporateOverheadPerM3: b.corporateOverheadPerM3, riskProvisionPerM3: b.riskProvisionPerM3, delivery: b.delivery, pumping: b.pumping, note: b.note, createdBy: ctx.userId }).returning();
  await audit(db, ctx, 'plant_cost', r!.id, 'draft_created', { plantId: b.plantId, validFrom: b.validFrom });
  res.status(201).json(r);
}));
catalogRouter.post('/plant-costs/:id/publish', wrap(async (req, res) => {
  const ctx = need(req, 'plantcost.approve');
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(S.plantCostVersions).where(and(eq(S.plantCostVersions.tenantId, ctx.tenantId), eq(S.plantCostVersions.id, String(req.params.id)))).for('update');
    if (!d) throw new HttpError(404, 'not_found', 'Version not found');
    if (d.status !== 'draft') throw conflict('Only draft versions can be published.');
    if (ctx.tenantSettings.separateProposerApprover && d.createdBy === ctx.userId) throw forbidden('A different user must approve a cost version you created.');
    const [prev] = await tx.select().from(S.plantCostVersions).where(and(eq(S.plantCostVersions.tenantId, ctx.tenantId), eq(S.plantCostVersions.plantId, d.plantId), eq(S.plantCostVersions.status, 'published'), isNull(S.plantCostVersions.validTo)));
    if (prev && prev.validFrom >= d.validFrom) throw conflict('The new version must take effect after the currently active version.');
    if (prev) await tx.update(S.plantCostVersions).set({ validTo: d.validFrom }).where(eq(S.plantCostVersions.id, prev.id));
    await tx.update(S.plantCostVersions).set({ status: 'published', publishedBy: ctx.userId, publishedAt: new Date() }).where(eq(S.plantCostVersions.id, d.id));
    await audit(tx, ctx, 'plant_cost', d.id, 'published', { replaces: prev?.id ?? null });
  });
  res.json({ ok: true });
}));
catalogRouter.delete('/plant-costs/:id', wrap(async (req, res) => {
  const ctx = need(req, 'plantcost.manage');
  const r = await db.delete(S.plantCostVersions).where(and(eq(S.plantCostVersions.tenantId, ctx.tenantId), eq(S.plantCostVersions.id, String(req.params.id)), eq(S.plantCostVersions.status, 'draft'))).returning({ id: S.plantCostVersions.id });
  if (!r.length) throw conflict('Only draft versions can be deleted.');
  await audit(db, ctx, 'plant_cost', String(req.params.id), 'draft_deleted', {});
  res.json({ ok: true });
}));
catalogRouter.post('/forecasts', wrap(async (req, res) => {
  const ctx = need(req, 'forecast.manage');
  const b = parse(forecastInput, req.body);
  if (!plantAllowed(ctx, b.plantId)) throw forbidden();
  const r = await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(S.forecastVolumes).where(and(eq(S.forecastVolumes.tenantId, ctx.tenantId), eq(S.forecastVolumes.plantId, b.plantId), isNull(S.forecastVolumes.validTo)));
    if (prev && prev.validFrom >= b.validFrom) throw conflict('The new forecast must take effect after the current one.');
    if (prev) await tx.update(S.forecastVolumes).set({ validTo: b.validFrom }).where(eq(S.forecastVolumes.id, prev.id));
    const [row] = await tx.insert(S.forecastVolumes).values({ tenantId: ctx.tenantId, plantId: b.plantId, monthlyM3: b.monthlyM3, validFrom: b.validFrom, source: b.source, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, 'forecast', row!.id, 'published', b);
    return row;
  });
  res.status(201).json(r);
}));
/** Exploratory only. Never writes. */
catalogRouter.post('/plant-costs/sensitivity', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const b = parse(z.object({ plantId: uuid, volumes: z.array(z.string().regex(/^\d+(\.\d+)?$/)).min(1).max(12) }), req.body);
  if (!plantAllowed(ctx, b.plantId)) throw forbidden();
  const pc = await loadPlantCost(db, ctx.tenantId, b.plantId, today());
  if (!pc) throw unprocessable('No published plant cost version is effective today.');
  const fixed = pc.fixedCosts.reduce((s, f) => s + Number(f.monthlyJod), 0);
  const fc = await loadForecast(db, ctx.tenantId, b.plantId, today());
  res.json({ label: 'Sensitivity — illustrative only; published prices are unchanged', fixedMonthly: String(fixed), published: fc ? { monthlyM3: fc.monthlyM3, source: fc.source } : null, rows: fixedCostSensitivity(String(fixed), b.volumes) });
}));

// ---------- mixes ----------
async function mixList(ctx: Ctx, opts: { status?: string; plantId?: string } = {}) {
  const mixes = await db.select().from(S.mixes).where(eq(S.mixes.tenantId, ctx.tenantId)).orderBy(asc(S.mixes.code));
  const revs = await db.select().from(S.mixRevisions).where(eq(S.mixRevisions.tenantId, ctx.tenantId)).orderBy(desc(S.mixRevisions.revNo));
  const mp = await db.select().from(S.mixPlants).where(eq(S.mixPlants.tenantId, ctx.tenantId));
  const ings = await db.select({ rid: S.mixIngredients.mixRevisionId, n: sql<number>`count(*)::int` }).from(S.mixIngredients).where(eq(S.mixIngredients.tenantId, ctx.tenantId)).groupBy(S.mixIngredients.mixRevisionId);
  return mixes.map((m) => {
    const plantIds = mp.filter((x) => x.mixId === m.id).map((x) => x.plantId).filter((p) => plantAllowed(ctx, p));
    const mrevs = revs.filter((r) => r.mixId === m.id).map((r) => ({ id: r.id, revNo: r.revNo, status: r.status, spec: r.spec, ingredientCount: ings.find((i) => i.rid === r.id)?.n ?? 0, approvedAt: r.approvedAt, missingInfo: missingInfo(r.spec as any, ings.find((i) => i.rid === r.id)?.n ?? 0) }));
    return { ...m, plantIds, revisions: mrevs, approvedRevision: mrevs.find((r) => r.status === 'approved') ?? null };
  }).filter((m) => m.plantIds.length > 0 || ctx.allPlants);
}
const missingInfo = (spec: Record<string, string>, ingCount: number) => [...(ingCount === 0 ? ['ingredients'] : []), ...(!spec.strengthMpa ? ['strength'] : []), ...(!spec.slumpMm ? ['slump'] : [])];
catalogRouter.get('/mixes', wrap(async (req, res) => { res.json(await mixList(ctxOf(req))); }));

const canSeeRecipe = (ctx: Ctx) => has(ctx, 'cost.view') || has(ctx, 'mix.create') || has(ctx, 'mix.approve');
catalogRouter.get('/mixes/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const m = (await mixList(ctx)).find((x) => x.id === req.params.id);
  if (!m) throw new HttpError(404, 'not_found', 'Mix not found');
  const revIds = m.revisions.map((r) => r.id);
  const withIng = canSeeRecipe(ctx) ? await loadMixRevs(db, ctx.tenantId, revIds) : new Map();
  const mats = await db.select().from(S.materials).where(eq(S.materials.tenantId, ctx.tenantId));
  const history = await db.select().from(S.auditEvents).where(and(eq(S.auditEvents.tenantId, ctx.tenantId), eq(S.auditEvents.entityType, 'mix'), eq(S.auditEvents.entityId, m.id))).orderBy(desc(S.auditEvents.id));
  res.json({ ...m, recipeVisible: canSeeRecipe(ctx), revisions: m.revisions.map((r) => ({ ...r, ingredients: (withIng.get(r.id)?.ingredients ?? []).map((i: any) => ({ ...i, material: mats.find((x) => x.id === i.materialId)?.nameEn, dosageUnit: mats.find((x) => x.id === i.materialId)?.dosageUnit })) })), history });
}));

async function insertIngredients(tx: Tx, ctx: Ctx, revId: string, ings: { materialId: string; dosage: string }[]) {
  const ids = ings.map((i) => i.materialId);
  if (new Set(ids).size !== ids.length) throw unprocessable('A material can appear only once in a mix.');
  if (ings.length) await tx.insert(S.mixIngredients).values(ings.map((i) => ({ tenantId: ctx.tenantId, mixRevisionId: revId, materialId: i.materialId, dosage: i.dosage }))); // composite FK = same-tenant materials only
}
catalogRouter.post('/mixes', wrap(async (req, res) => {
  const ctx = need(req, 'mix.create');
  const b = parse(mixInput, req.body);
  const out = await db.transaction(async (tx) => {
    const [m] = await tx.insert(S.mixes).values({ tenantId: ctx.tenantId, code: b.code, nameEn: b.nameEn, nameAr: b.nameAr, grade: b.grade }).returning();
    for (const p of b.plantIds) await tx.insert(S.mixPlants).values({ tenantId: ctx.tenantId, mixId: m!.id, plantId: p });
    const [r] = await tx.insert(S.mixRevisions).values({ tenantId: ctx.tenantId, mixId: m!.id, revNo: 1, status: 'draft', spec: b.spec, createdBy: ctx.userId }).returning();
    await insertIngredients(tx, ctx, r!.id, b.ingredients);
    await audit(tx, ctx, 'mix', m!.id, 'created', { code: b.code });
    return { mixId: m!.id, revisionId: r!.id };
  });
  res.status(201).json(out);
}));
catalogRouter.post('/mixes/:id/revisions', wrap(async (req, res) => {
  const ctx = need(req, 'mix.create');
  const b = parse(mixRevisionInput, req.body);
  const out = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(S.mixes).where(and(eq(S.mixes.tenantId, ctx.tenantId), eq(S.mixes.id, String(req.params.id)))).for('update');
    if (!m) throw new HttpError(404, 'not_found', 'Mix not found');
    const [open] = await tx.select().from(S.mixRevisions).where(and(eq(S.mixRevisions.mixId, m.id), inArray(S.mixRevisions.status, ['draft', 'pending_technical'])));
    if (open) throw conflict('This mix already has an open draft revision; edit or reject it first.');
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${S.mixRevisions.revNo}),0)::int` }).from(S.mixRevisions).where(eq(S.mixRevisions.mixId, m.id))) as [{ n: number }];
    const [r] = await tx.insert(S.mixRevisions).values({ tenantId: ctx.tenantId, mixId: m.id, revNo: n + 1, status: 'draft', spec: b.spec, notes: b.notes, createdBy: ctx.userId }).returning();
    await insertIngredients(tx, ctx, r!.id, b.ingredients);
    await audit(tx, ctx, 'mix', m.id, 'revision_created', { revNo: r!.revNo });
    return { revisionId: r!.id, revNo: r!.revNo };
  });
  res.status(201).json(out);
}));
catalogRouter.put('/mix-revisions/:id', wrap(async (req, res) => {
  const ctx = need(req, 'mix.create');
  const b = parse(mixRevisionInput, req.body);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(S.mixRevisions).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), eq(S.mixRevisions.id, String(req.params.id)))).for('update');
    if (!r) throw new HttpError(404, 'not_found', 'Revision not found');
    if (r.status !== 'draft') throw conflict('Only draft revisions can be edited. Create a new revision instead.');
    await tx.update(S.mixRevisions).set({ spec: b.spec, notes: b.notes }).where(eq(S.mixRevisions.id, r.id));
    await tx.delete(S.mixIngredients).where(eq(S.mixIngredients.mixRevisionId, r.id));
    await insertIngredients(tx, ctx, r.id, b.ingredients);
    await audit(tx, ctx, 'mix', r.mixId, 'revision_edited', { revNo: r.revNo });
  });
  res.json({ ok: true });
}));
catalogRouter.post('/mix-revisions/:id/:action(submit|approve|reject)', wrap(async (req, res) => {
  const action = String(req.params.action);
  const ctx = need(req, action === 'submit' ? 'mix.create' : 'mix.approve');
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(S.mixRevisions).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), eq(S.mixRevisions.id, String(req.params.id)))).for('update');
    if (!r) throw new HttpError(404, 'not_found', 'Revision not found');
    const ing = await tx.select().from(S.mixIngredients).where(eq(S.mixIngredients.mixRevisionId, r.id));
    if (action === 'submit') {
      if (r.status !== 'draft') throw conflict('Only draft revisions can be submitted.');
      const miss = missingInfo(r.spec as any, ing.length);
      if (miss.length) throw unprocessable(`Complete the revision first: missing ${miss.join(', ')}.`);
      await tx.update(S.mixRevisions).set({ status: 'pending_technical', submittedBy: ctx.userId }).where(eq(S.mixRevisions.id, r.id));
    } else if (action === 'approve') {
      if (r.status !== 'pending_technical') throw conflict('Only revisions awaiting technical approval can be approved.');
      if (ctx.tenantSettings.separateProposerApprover && r.submittedBy === ctx.userId) throw forbidden('A different user must approve a revision you submitted.');
      await tx.update(S.mixRevisions).set({ status: 'superseded' }).where(and(eq(S.mixRevisions.mixId, r.mixId), eq(S.mixRevisions.status, 'approved')));
      await tx.update(S.mixRevisions).set({ status: 'approved', approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(S.mixRevisions.id, r.id));
    } else {
      if (!['draft', 'pending_technical'].includes(r.status)) throw conflict('Only open revisions can be rejected.');
      await tx.update(S.mixRevisions).set({ status: 'rejected' }).where(eq(S.mixRevisions.id, r.id));
    }
    await audit(tx, ctx, 'mix', r.mixId, `revision_${action}`, { revNo: r.revNo });
  });
  res.json({ ok: true });
}));

// ---------- mix pricing (commercial price for everyone with price.view; cost breakdown only with cost.view) ----------
export async function priceMixAtPlant(tx: Db | Tx, ctx: Ctx, mixRevisionId: string, plantId: string, asOf: string) {
  const revs = await loadMixRevs(tx, ctx.tenantId, [mixRevisionId]);
  const mr = revs.get(mixRevisionId);
  if (!mr) throw new HttpError(404, 'not_found', 'Mix revision not found');
  const materials = await loadMaterials(tx, ctx.tenantId);
  const prices = await loadPrices(tx, ctx.tenantId, plantId, asOf);
  const plantCost = await loadPlantCost(tx, ctx.tenantId, plantId, asOf);
  const forecast = await loadForecast(tx, ctx.tenantId, plantId, asOf);
  const policies = await loadPolicies(tx, ctx.tenantId, asOf);
  const taxRowDb = await loadTax(tx, ctx.tenantId, asOf);
  const result = priceQuotation({
    asOf, scope: 'supply_only', staleAfterDays: ctx.tenantSettings.staleAfterDays, rounding: { internalDp: ctx.tenantSettings.internalDp }, materials, prices, plantCost, forecast, tax: taxRowDb ? taxRow(taxRowDb) : null,
    lines: [{ id: 'unit', mixRevisionId, mixCode: mr.code, mixName: mr.nameEn, quantityM3: '1', ingredients: mr.ingredients, policy: resolvePolicy(policies, mr.mixId, plantId) }], services: [],
  });
  return { mr, result };
}
catalogRouter.get('/mix-revisions/:id/pricing', wrap(async (req, res) => {
  const ctx = need(req, 'price.view', 'cost.view');
  const q = z.object({ plantId: uuid.optional(), asOf: isoDate.default(today()) }).parse(req.query);
  const mix = await db.select().from(S.mixPlants).innerJoin(S.mixRevisions, and(eq(S.mixRevisions.mixId, S.mixPlants.mixId), eq(S.mixRevisions.tenantId, S.mixPlants.tenantId))).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), eq(S.mixRevisions.id, String(req.params.id))));
  if (!mix.length) throw new HttpError(404, 'not_found', 'Mix revision not found');
  const plantIds = (q.plantId ? [q.plantId] : mix.map((m) => m.mix_plants.plantId)).filter((p) => plantAllowed(ctx, p));
  const plantRows = await db.select().from(S.plants).where(and(eq(S.plants.tenantId, ctx.tenantId), inArray(S.plants.id, plantIds.length ? plantIds : ['00000000-0000-0000-0000-000000000000'])));
  const out = [] as any[];
  for (const p of plantRows) {
    const { result } = await priceMixAtPlant(db, ctx, String(req.params.id), p.id, q.asOf);
    const line = result.lines[0]!;
    const errors = result.issues.filter((i) => i.severity === 'error');
    out.push({
      plantId: p.id, plantCode: p.code, plantName: p.nameEn, asOf: q.asOf, comparable: line.calculable, customerRatePerM3: line.customerRatePerM3,
      issues: errors.map((i) => ({ code: i.code, message: i.message, path: i.path })), warnings: result.issues.filter((i) => i.severity === 'warning').map((i) => ({ code: i.code, message: i.message })),
      internal: has(ctx, 'cost.view') ? { ...line.internal, versions: result.versions } : undefined,
    });
  }
  res.json({ pricing: out });
}));
export { plantCostRow, trimNum, materialCostBreakdown };
