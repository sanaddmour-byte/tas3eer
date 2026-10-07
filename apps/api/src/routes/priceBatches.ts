import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate, uuid } from '@rm/shared';
import { materialCostBreakdown, PricingError, dosageUnitsPerPurchaseUnit, type PriceInput } from '@rm/engine';
import { config } from '../config.js';
import { db, schema, type Db, type Tx } from '../db/client.js';
import { audit } from '../services/audit.js';
import { conflict, ctxOf, forbidden, HttpError, need, parse, plantAllowed, unprocessable, wrap, type Ctx } from '../http.js';
import { loadMaterials, loadMixRevs, loadPrices, today, trimNum } from '../services/reference.js';

export const batchRouter = Router();
const S = schema;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

interface RowIn { rowNo: number; plantCode?: string; plantId?: string; materialCode?: string; materialId?: string; price?: string; basis?: string; freight?: string; effectiveFrom?: string; purchaseUnit?: string }
export interface RowError { rowNo: number; field: string; message: string }

/** Validate raw rows against the tenant catalog. Returns normalized items and ALL row errors. */
async function validateRows(q: Db | Tx, ctx: Ctx, rows: RowIn[]) {
  const [mats, plants] = await Promise.all([
    q.select().from(S.materials).where(eq(S.materials.tenantId, ctx.tenantId)), q.select().from(S.plants).where(eq(S.plants.tenantId, ctx.tenantId)),
  ]);
  const errors: RowError[] = [];
  const items: { rowNo: number; materialId: string; plantId: string; price: string; basis: 'ex_source' | 'delivered_plant'; freight: string | null; effectiveFrom: string }[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const e = (field: string, message: string) => errors.push({ rowNo: r.rowNo, field, message });
    const plant = plants.find((p) => (r.plantId ? p.id === r.plantId : p.code.toLowerCase() === (r.plantCode ?? '').trim().toLowerCase()));
    const mat = mats.find((m) => (r.materialId ? m.id === r.materialId : m.code.toLowerCase() === (r.materialCode ?? '').trim().toLowerCase()));
    if (!r.plantCode && !r.plantId) e('plant', 'Plant code is required.'); else if (!plant) e('plant', `Unknown plant "${r.plantCode ?? r.plantId}".`); else if (!plantAllowed(ctx, plant.id)) e('plant', `Plant ${plant.code} is outside your plant scope.`);
    if (!r.materialCode && !r.materialId) e('material', 'Material code is required.'); else if (!mat) e('material', `Unknown material "${r.materialCode ?? r.materialId}".`);
    const price = (r.price ?? '').toString().trim();
    if (!price) e('price', 'Price is required.'); else if (!/^-?\d+(\.\d+)?$/.test(price)) e('price', 'Price must be a number.'); else if (Number(price) < 0) e('price', 'Price cannot be negative.');
    const basis = (r.basis ?? '').trim();
    if (!basis) e('basis', 'Price basis is required (ex_source or delivered_plant).'); else if (!['ex_source', 'delivered_plant'].includes(basis)) e('basis', 'Price basis must be ex_source or delivered_plant.');
    const freight = (r.freight ?? '').toString().trim();
    if (basis === 'ex_source' && !freight) e('freight', 'Freight is required for ex-source prices (enter 0 if none).');
    if (freight && (!/^\d+(\.\d+)?$/.test(freight))) e('freight', 'Freight must be a non-negative number.');
    const eff = (r.effectiveFrom ?? '').trim();
    if (!eff) e('effectiveFrom', 'Effective date is required.'); else if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || Number.isNaN(Date.parse(eff))) e('effectiveFrom', 'Effective date must be YYYY-MM-DD.');
    if (mat && r.purchaseUnit && r.purchaseUnit.trim() !== mat.purchaseUnit) e('purchaseUnit', `Unit mismatch: ${mat.code} is priced per ${mat.purchaseUnit}, not "${r.purchaseUnit}".`);
    if (mat) { try { dosageUnitsPerPurchaseUnit({ id: mat.id, name: mat.nameEn, purchaseUnit: mat.purchaseUnit as any, dosageUnit: mat.dosageUnit as any, conversionFactor: mat.conversionFactor, densityKgPerM3: mat.densityKgPerM3, wastagePct: mat.wastagePct }); } catch (x) { e('material', `${mat.code}: ${(x as PricingError).issues?.[0]?.message ?? 'invalid unit configuration'}`); } }
    if (plant && mat) {
      const k = `${plant.id}|${mat.id}`;
      if (seen.has(k)) e('material', `Duplicate row for ${plant.code}/${mat.code} (first seen on row ${seen.get(k)}).`); else seen.set(k, r.rowNo);
    }
    if (plant && mat && /^\d{4}-\d{2}-\d{2}$/.test(eff)) {
      const [cur] = await q.select({ validFrom: S.materialPriceVersions.validFrom }).from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, plant.id), eq(S.materialPriceVersions.materialId, mat.id), isNull(S.materialPriceVersions.validTo)));
      if (cur && cur.validFrom >= eff) e('effectiveFrom', `Effective date must be after the active price's start date (${cur.validFrom}).`);
    }
    if (!errors.some((x) => x.rowNo === r.rowNo) && plant && mat) items.push({ rowNo: r.rowNo, materialId: mat.id, plantId: plant.id, price, basis: basis as any, freight: basis === 'ex_source' ? freight : freight || null, effectiveFrom: eff });
  }
  return { items, errors };
}

export async function computeImpact(q: Db | Tx, ctx: Ctx, items: { materialId: string; plantId: string; price: string; basis: string; freight: string | null; effectiveFrom: string }[]) {
  const materials = await loadMaterials(q, ctx.tenantId);
  const mixPlants = await q.select().from(S.mixPlants).where(eq(S.mixPlants.tenantId, ctx.tenantId));
  const approved = await q.select().from(S.mixRevisions).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), eq(S.mixRevisions.status, 'approved')));
  const revs = await loadMixRevs(q, ctx.tenantId, approved.map((a) => a.id));
  const byPlant = new Map<string, typeof items>();
  items.forEach((i) => byPlant.set(i.plantId, [...(byPlant.get(i.plantId) ?? []), i]));
  const impact: Record<string, { mixRevisionId: string; code: string; plantId: string; before: string | null; after: string | null; delta: string | null; pct: string | null }[]> = {};
  for (const [plantId, its] of byPlant) {
    const asOf = its.map((i) => i.effectiveFrom).sort()[0] ?? today();
    const current = await loadPrices(q, ctx.tenantId, plantId, today());
    const proposed: PriceInput[] = current.map((p) => {
      const n = its.find((i) => i.materialId === p.materialId);
      return n ? { ...p, price: n.price, basis: n.basis as any, freightPerPurchaseUnit: n.freight, versionId: 'proposed' } : p;
    });
    for (const n of its) if (!proposed.some((p) => p.materialId === n.materialId)) proposed.push({ materialId: n.materialId, versionId: 'proposed', price: n.price, basis: n.basis as any, freightPerPurchaseUnit: n.freight, effectiveFrom: asOf });
    const affectedMats = new Set(its.map((i) => i.materialId));
    for (const r of approved) {
      if (!mixPlants.some((mp) => mp.mixId === r.mixId && mp.plantId === plantId)) continue;
      const mr = revs.get(r.id)!;
      if (!mr.ingredients.some((i) => affectedMats.has(i.materialId))) continue;
      const calc = (prices: PriceInput[]) => { try { return materialCostBreakdown(mr.ingredients, materials, prices, 4).total; } catch { return null; } };
      const before = calc(current), after = calc(proposed);
      const delta = before && after ? (Number(after) - Number(before)).toFixed(4) : null;
      (impact[plantId] ??= []).push({ mixRevisionId: r.id, code: mr.code, plantId, before, after, delta, pct: delta && before && Number(before) ? ((Number(delta) / Number(before)) * 100).toFixed(2) : null });
    }
  }
  return impact;
}

async function loadBatch(q: Db | Tx, ctx: Ctx, id: string, lock = false) {
  const base = q.select().from(S.priceBatches).where(and(eq(S.priceBatches.tenantId, ctx.tenantId), eq(S.priceBatches.id, id)));
  const [b] = await (lock ? base.for('update') : base);
  if (!b) throw new HttpError(404, 'not_found', 'Price batch not found');
  return b;
}
const hist = (b: { history: unknown }, ctx: Ctx, action: string, comment?: string) => [...(b.history as any[]), { at: new Date().toISOString(), by: ctx.userName, byUserId: ctx.userId, action, comment: comment ?? null }];

async function replaceItems(tx: Tx, ctx: Ctx, batch: typeof S.priceBatches.$inferSelect, rows: RowIn[]) {
  const { items, errors } = await validateRows(tx, ctx, rows);
  if (errors.length) return { errors, items: [] as typeof items };
  await tx.delete(S.priceBatchItems).where(and(eq(S.priceBatchItems.batchId, batch.id), eq(S.priceBatchItems.batchRevision, batch.currentRevision)));
  const impactBy = await computeImpact(tx, ctx, items);
  for (const it of items) {
    const [cur] = await tx.select().from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, it.plantId), eq(S.materialPriceVersions.materialId, it.materialId), isNull(S.materialPriceVersions.validTo)));
    await tx.insert(S.priceBatchItems).values({
      tenantId: ctx.tenantId, batchId: batch.id, batchRevision: batch.currentRevision, rowNo: it.rowNo, materialId: it.materialId, plantId: it.plantId, baseVersionId: cur?.id ?? null, basePrice: cur?.price ?? null, baseBasis: cur?.basis ?? null, baseFreight: cur?.freight ?? null,
      proposedPrice: it.price, proposedBasis: it.basis, proposedFreight: it.freight, effectiveFrom: it.effectiveFrom, impact: (impactBy[it.plantId] ?? []),
    });
  }
  return { errors: [] as RowError[], items };
}

batchRouter.get('/price-batches', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const rows = await db.select().from(S.priceBatches).where(eq(S.priceBatches.tenantId, ctx.tenantId)).orderBy(desc(S.priceBatches.createdAt));
  const counts = await db.select({ b: S.priceBatchItems.batchId, rev: S.priceBatchItems.batchRevision, n: sql<number>`count(*)::int` }).from(S.priceBatchItems).where(eq(S.priceBatchItems.tenantId, ctx.tenantId)).groupBy(S.priceBatchItems.batchId, S.priceBatchItems.batchRevision);
  res.json(rows.map((b) => ({ ...b, itemCount: counts.find((c) => c.b === b.id && c.rev === b.currentRevision)?.n ?? 0 })));
}));

batchRouter.post('/price-batches', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.propose');
  const b = parse(z.object({ name: z.string().min(2).max(120), plantId: uuid.nullable().default(null), effectiveFrom: isoDate }), req.body);
  if (b.plantId && !plantAllowed(ctx, b.plantId)) throw forbidden();
  const [row] = await db.insert(S.priceBatches).values({ tenantId: ctx.tenantId, name: b.name, plantId: b.plantId, effectiveFrom: b.effectiveFrom, createdBy: ctx.userId, history: [{ at: new Date().toISOString(), by: ctx.userName, byUserId: ctx.userId, action: 'created', comment: null }] }).returning();
  await audit(db, ctx, 'price_batch', row!.id, 'created', b);
  res.status(201).json(row);
}));

batchRouter.get('/price-batches/template', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const q = z.object({ plantId: uuid.optional() }).parse(req.query);
  const [mats, plants] = await Promise.all([db.select().from(S.materials).where(eq(S.materials.tenantId, ctx.tenantId)).orderBy(asc(S.materials.code)), db.select().from(S.plants).where(eq(S.plants.tenantId, ctx.tenantId)).orderBy(asc(S.plants.code))]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Prices');
  ws.columns = [{ header: 'Plant Code', key: 'plant', width: 14 }, { header: 'Material Code', key: 'mat', width: 16 }, { header: 'Material Name', key: 'name', width: 28 }, { header: 'Purchase Unit', key: 'unit', width: 14 }, { header: 'Price (JOD per purchase unit)', key: 'price', width: 26 }, { header: 'Price Basis (ex_source | delivered_plant)', key: 'basis', width: 36 }, { header: 'Freight (JOD per purchase unit)', key: 'freight', width: 28 }, { header: 'Effective From (YYYY-MM-DD)', key: 'eff', width: 26 }];
  ws.getRow(1).font = { bold: true };
  for (const p of plants.filter((x) => (!q.plantId || x.id === q.plantId) && plantAllowed(ctx, x.id))) {
    const cur = await loadPrices(db, ctx.tenantId, p.id, today());
    for (const m of mats) {
      const c = cur.find((x) => x.materialId === m.id);
      ws.addRow({ plant: p.code, mat: m.code, name: m.nameEn, unit: m.purchaseUnit, price: c?.price ?? '', basis: c?.basis ?? '', freight: c?.freightPerPurchaseUnit ?? '', eff: '' });
    }
  }
  const help = wb.addWorksheet('Instructions');
  ['Fill Price, Price Basis, Freight (for ex_source) and Effective From for every row you want to change.', 'Delete rows you do not want to change. Do not change Plant Code, Material Code or Purchase Unit.', 'Prices are in JOD per purchase unit. An invalid file is rejected as a whole; nothing is published until the batch is approved.'].forEach((t) => help.addRow([t]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="price-update-template.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

batchRouter.get('/price-batches/:id', wrap(async (req, res) => {
  const ctx = need(req, 'cost.view');
  const b = await loadBatch(db, ctx, String(req.params.id));
  const items = await db.select().from(S.priceBatchItems).where(and(eq(S.priceBatchItems.batchId, b.id), eq(S.priceBatchItems.batchRevision, b.currentRevision))).orderBy(asc(S.priceBatchItems.rowNo));
  const mats = await db.select().from(S.materials).where(eq(S.materials.tenantId, ctx.tenantId));
  const plants = await db.select().from(S.plants).where(eq(S.plants.tenantId, ctx.tenantId));
  // stale detection: has the base version of any item moved?
  const stale: string[] = [];
  for (const it of items) {
    const [cur] = await db.select({ id: S.materialPriceVersions.id }).from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, it.plantId), eq(S.materialPriceVersions.materialId, it.materialId), isNull(S.materialPriceVersions.validTo)));
    if ((cur?.id ?? null) !== it.baseVersionId) stale.push(it.id);
  }
  const impactMap = new Map<string, any>();
  items.forEach((i) => (i.impact as any[]).forEach((x) => impactMap.set(`${x.plantId}|${x.mixRevisionId}`, x)));
  res.json({
    batch: b, stale,
    items: items.map((i) => {
      const abs = i.basePrice !== null ? (Number(i.proposedPrice) - Number(i.basePrice)) : null;
      return { ...i, materialCode: mats.find((m) => m.id === i.materialId)?.code, materialName: mats.find((m) => m.id === i.materialId)?.nameEn, purchaseUnit: mats.find((m) => m.id === i.materialId)?.purchaseUnit, plantCode: plants.find((p) => p.id === i.plantId)?.code,
        change: abs === null ? null : abs.toFixed(4), changePct: abs === null || !Number(i.basePrice) ? null : ((abs / Number(i.basePrice)) * 100).toFixed(2), impact: undefined, stale: stale.includes(i.id) };
    }),
    impact: [...impactMap.values()].map((x) => ({ ...x, mixName: undefined })),
  });
}));

const itemsBody = z.object({ items: z.array(z.object({ plantCode: z.string().optional(), plantId: uuid.optional(), materialCode: z.string().optional(), materialId: uuid.optional(), price: z.string().optional(), basis: z.string().optional(), freight: z.string().optional().nullable(), effectiveFrom: z.string().optional() })).max(2000) });
batchRouter.put('/price-batches/:id/items', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.propose');
  const b = parse(itemsBody, req.body);
  const out = await db.transaction(async (tx) => {
    const batch = await loadBatch(tx, ctx, String(req.params.id), true);
    if (batch.status !== 'draft') throw conflict('Only draft batches can be edited. Revise the batch to change a submitted proposal.');
    return replaceItems(tx, ctx, batch, b.items.map((x, i) => ({ rowNo: i + 1, ...x, freight: x.freight ?? undefined })));
  });
  if (out.errors.length) return res.status(422).json({ error: { code: 'row_errors', message: 'Fix the highlighted rows. No prices were changed.', rowErrors: out.errors } });
  res.json({ saved: out.items.length });
}));

batchRouter.post('/price-batches/:id/upload', upload.single('file'), wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.propose');
  const f = req.file;
  if (!f) throw new HttpError(400, 'bad_request', 'Choose an .xlsx file to upload.');
  if (!/\.xlsx$/i.test(f.originalname) || f.buffer.subarray(0, 2).toString('latin1') !== 'PK') throw new HttpError(400, 'bad_format', 'Only .xlsx workbooks are accepted.');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(f.buffer as any); } catch { throw new HttpError(400, 'bad_format', 'The file could not be read as an Excel workbook.'); }
  const ws = wb.getWorksheet('Prices') ?? wb.worksheets[0];
  if (!ws) throw new HttpError(400, 'bad_format', 'The workbook has no sheets.');
  const header = (ws.getRow(1).values as any[]).map((v) => String(v ?? '').toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = { plant: col(/^plant code/), mat: col(/^material code/), unit: col(/^purchase unit/), price: col(/^price \(/), basis: col(/^price basis/), freight: col(/^freight/), eff: col(/^effective/) };
  if (Object.entries(c).some(([k, v]) => v < 0 && k !== 'unit' && k !== 'freight')) throw new HttpError(400, 'bad_format', 'Missing required columns. Download the template and keep its header row.');
  const cell = (r: ExcelJS.Row, i: number) => { if (i < 0) return undefined; const v = r.getCell(i).value as any; if (v === null || v === undefined) return ''; if (v instanceof Date) return v.toISOString().slice(0, 10); if (typeof v === 'object' && 'result' in v) return String(v.result ?? ''); return String(v).trim(); };
  const rows: RowIn[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const row: RowIn = { rowNo: n, plantCode: cell(r, c.plant), materialCode: cell(r, c.mat), purchaseUnit: cell(r, c.unit), price: cell(r, c.price), basis: cell(r, c.basis), freight: cell(r, c.freight), effectiveFrom: cell(r, c.eff) };
    // untouched template rows (no price entered) are skipped
    if (!row.price && !row.basis && !row.effectiveFrom && !row.freight) return;
    rows.push(row);
  });
  if (rows.length === 0) throw new HttpError(422, 'empty', 'The file contains no rows with changes.');
  if (rows.length > 2000) throw new HttpError(422, 'too_large', 'A batch can contain at most 2,000 rows.');
  const out = await db.transaction(async (tx) => {
    const batch = await loadBatch(tx, ctx, String(req.params.id), true);
    if (batch.status !== 'draft') throw conflict('Only draft batches can receive an upload.');
    const r = await replaceItems(tx, ctx, batch, rows);
    if (!r.errors.length) { await tx.update(S.priceBatches).set({ source: 'excel', fileName: f.originalname, history: hist(batch, ctx, 'uploaded', f.originalname) }).where(eq(S.priceBatches.id, batch.id)); await audit(tx, ctx, 'price_batch', batch.id, 'uploaded', { file: f.originalname, rows: rows.length }); }
    return r;
  });
  if (out.errors.length) return res.status(422).json({ error: { code: 'row_errors', message: `${out.errors.length} problem(s) found. No prices were changed.`, rowErrors: out.errors } });
  res.json({ saved: out.items.length });
}));

batchRouter.post('/price-batches/:id/submit', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.propose');
  await db.transaction(async (tx) => {
    const b = await loadBatch(tx, ctx, String(req.params.id), true);
    if (b.status !== 'draft') throw conflict('Only draft batches can be submitted.');
    const items = await tx.select().from(S.priceBatchItems).where(and(eq(S.priceBatchItems.batchId, b.id), eq(S.priceBatchItems.batchRevision, b.currentRevision)));
    if (!items.length) throw unprocessable('Add at least one price change before submitting.');
    for (const i of items) if (i.effectiveFrom <= '1970-01-01') throw unprocessable('Invalid effective date.');
    await tx.update(S.priceBatches).set({ status: 'submitted', submittedBy: ctx.userId, submittedAt: new Date(), history: hist(b, ctx, 'submitted') }).where(eq(S.priceBatches.id, b.id));
    await audit(tx, ctx, 'price_batch', b.id, 'submitted', { revision: b.currentRevision, items: items.length });
  });
  res.json({ ok: true });
}));

batchRouter.post('/price-batches/:id/revise', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.propose');
  await db.transaction(async (tx) => {
    const b = await loadBatch(tx, ctx, String(req.params.id), true);
    if (!['returned', 'rejected', 'submitted'].includes(b.status)) throw conflict('Only submitted, returned or rejected batches can be revised.');
    if (b.createdBy !== ctx.userId && !ctx.caps.includes('pricebatch.approve')) throw forbidden();
    const old = await tx.select().from(S.priceBatchItems).where(and(eq(S.priceBatchItems.batchId, b.id), eq(S.priceBatchItems.batchRevision, b.currentRevision)));
    const next = b.currentRevision + 1;
    await tx.update(S.priceBatches).set({ currentRevision: next, status: 'draft', submittedBy: null, submittedAt: null, history: hist(b, ctx, 'revised') }).where(eq(S.priceBatches.id, b.id));
    const rows: RowIn[] = [];
    for (const i of old) {
      // re-base on current prices; effective dates that are no longer after the active price's start move to the next day
      const [cur] = await tx.select({ validFrom: S.materialPriceVersions.validFrom }).from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, i.plantId), eq(S.materialPriceVersions.materialId, i.materialId), isNull(S.materialPriceVersions.validTo)));
      const minDate = cur ? new Date(Date.parse(cur.validFrom) + 86400000).toISOString().slice(0, 10) : i.effectiveFrom;
      rows.push({ rowNo: i.rowNo, plantId: i.plantId, materialId: i.materialId, price: i.proposedPrice, basis: i.proposedBasis, freight: i.proposedFreight ?? undefined, effectiveFrom: i.effectiveFrom < minDate ? minDate : i.effectiveFrom });
    }
    const fresh = await loadBatch(tx, ctx, b.id);
    const out = await replaceItems(tx, ctx, fresh, rows);
    if (out.errors.length) throw new HttpError(422, 'row_errors', 'The proposal could not be re-based on current prices.', { rowErrors: out.errors });
    await audit(tx, ctx, 'price_batch', b.id, 'revised', { revision: next });
  });
  res.json({ ok: true });
}));

batchRouter.post('/price-batches/:id/:action(return|reject)', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.approve');
  const { comment } = parse(z.object({ comment: z.string().min(3, 'Explain the decision') }), req.body);
  const action = String(req.params.action);
  await db.transaction(async (tx) => {
    const b = await loadBatch(tx, ctx, String(req.params.id), true);
    if (b.status !== 'submitted') throw conflict('Only submitted batches can be decided.');
    const st = action === 'return' ? 'returned' : 'rejected';
    await tx.update(S.priceBatches).set({ status: st, decidedBy: ctx.userId, decidedAt: new Date(), decisionComment: comment, history: hist(b, ctx, st, comment) }).where(eq(S.priceBatches.id, b.id));
    await audit(tx, ctx, 'price_batch', b.id, st, { comment });
  });
  res.json({ ok: true });
}));

/** Approve + publish atomically: stale check, close old versions, insert new ones, audit — one transaction. */
batchRouter.post('/price-batches/:id/approve', wrap(async (req, res) => {
  const ctx = need(req, 'pricebatch.approve');
  const { comment } = parse(z.object({ comment: z.string().default('') }), req.body ?? {});
  const result = await db.transaction(async (tx) => {
    const b = await loadBatch(tx, ctx, String(req.params.id), true);
    if (b.status !== 'submitted') throw conflict('Only submitted batches can be approved.');
    if (ctx.tenantSettings.separateProposerApprover && (b.submittedBy === ctx.userId || b.createdBy === ctx.userId)) throw forbidden('A different user must approve a batch you proposed.');
    const items = await tx.select().from(S.priceBatchItems).where(and(eq(S.priceBatchItems.batchId, b.id), eq(S.priceBatchItems.batchRevision, b.currentRevision)));
    const stale: { materialId: string; plantId: string }[] = [];
    const curs = new Map<string, typeof S.materialPriceVersions.$inferSelect | undefined>();
    for (const it of items) {
      const [cur] = await tx.select().from(S.materialPriceVersions).where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), eq(S.materialPriceVersions.plantId, it.plantId), eq(S.materialPriceVersions.materialId, it.materialId), isNull(S.materialPriceVersions.validTo))).for('update');
      if ((cur?.id ?? null) !== it.baseVersionId) stale.push({ materialId: it.materialId, plantId: it.plantId });
      curs.set(it.id, cur);
    }
    if (stale.length) throw new HttpError(409, 'stale_batch', `${stale.length} price(s) changed since this proposal was prepared. Revise the batch against current prices.`, { stale });
    for (const it of items) {
      const cur = curs.get(it.id);
      if (cur && cur.validFrom >= it.effectiveFrom) throw unprocessable(`Effective date ${it.effectiveFrom} must be after the active price's start date ${cur.validFrom}.`);
    }
    for (const it of items) {
      const cur = curs.get(it.id);
      if (cur) await tx.update(S.materialPriceVersions).set({ validTo: it.effectiveFrom }).where(eq(S.materialPriceVersions.id, cur.id));
      await tx.insert(S.materialPriceVersions).values({ tenantId: ctx.tenantId, materialId: it.materialId, plantId: it.plantId, price: it.proposedPrice, basis: it.proposedBasis, freight: it.proposedFreight, validFrom: it.effectiveFrom, source: `Price batch: ${b.name}`, batchId: b.id, createdBy: ctx.userId });
      await audit(tx, ctx, 'material_price', `${it.plantId}:${it.materialId}`, 'published', { batchId: b.id, from: it.basePrice, to: it.proposedPrice, effectiveFrom: it.effectiveFrom });
    }
    await tx.update(S.priceBatches).set({ status: 'published', decidedBy: ctx.userId, decidedAt: new Date(), publishedAt: new Date(), decisionComment: comment, history: hist(b, ctx, 'approved_published', comment) }).where(eq(S.priceBatches.id, b.id));
    await audit(tx, ctx, 'price_batch', b.id, 'approved_published', { items: items.length, comment });
    return { published: items.length };
  });
  res.json(result);
}));
