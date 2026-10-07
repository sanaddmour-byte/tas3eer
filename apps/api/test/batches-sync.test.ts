import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { db, schema } from '../src/db/client.js';
import { and, eq, sql } from 'drizzle-orm';
import { createQuote, loginAs, makeTenant, quoteDoc, type TenantFx } from './helpers.js';

let fx: TenantFx;
beforeAll(async () => { fx = await makeTenant(); });
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function xlsx(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Prices');
  ws.addRow(['Plant Code', 'Material Code', 'Material Name', 'Purchase Unit', 'Price (JOD per purchase unit)', 'Price Basis (ex_source | delivered_plant)', 'Freight (JOD per purchase unit)', 'Effective From (YYYY-MM-DD)']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const activePrice = async (plant: string, mat: string) => (await db.select().from(schema.materialPriceVersions).where(and(eq(schema.materialPriceVersions.plantId, fx.cat.plants[plant]!), eq(schema.materialPriceVersions.materialId, fx.cat.materials[mat]!), sql`valid_to is null`)))[0]!;

describe('price batches & Excel import', () => {
  it('an invalid upload reports row-level errors and changes nothing', async () => {
    const p = await loginAs(fx.email('pricing'));
    const b = (await p.post('/api/price-batches').send({ name: 'Bad upload', effectiveFrom: iso(0) })).body;
    const good = ['MRK', 'CEM', 'Cement', 'tonne', 82, 'delivered_plant', null, iso(0)];
    const file = await xlsx([good, ['XXX', 'SAND', 'Sand', 'tonne', 10, 'ex_source', 3, iso(0)], ['MRK', 'NOPE', 'x', 'tonne', 5, 'delivered_plant', null, iso(0)], ['MRK', 'AGG19', 'a', 'tonne', -4, 'delivered_plant', null, iso(0)], ['MRK', 'AGG10', 'a', 'kg', 9, 'ex_source', null, 'bad-date'], ['MRK', 'CEM', 'Cement', 'tonne', 83, 'delivered_plant', null, iso(0)]]);
    const r = await p.post(`/api/price-batches/${b.id}/upload`).attach('file', file, 'prices.xlsx');
    expect(r.status).toBe(422);
    const msgs = r.body.error.rowErrors.map((e: any) => `${e.rowNo}:${e.field}`);
    expect(msgs).toEqual(expect.arrayContaining(['3:plant', '4:material', '5:price', '6:purchaseUnit', '6:effectiveFrom', '6:freight', '7:material']));
    const detail = (await p.get(`/api/price-batches/${b.id}`)).body;
    expect(detail.items).toHaveLength(0); // nothing partly saved
    expect((await activePrice('MRK', 'CEM')).price).toBe('78.000000'); // live price untouched
  });
  it('rejects wrong file types and oversized files; offers a template download', async () => {
    const p = await loginAs(fx.email('pricing'));
    const b = (await p.post('/api/price-batches').send({ name: 'Files', effectiveFrom: iso(0) })).body;
    expect((await p.post(`/api/price-batches/${b.id}/upload`).attach('file', Buffer.from('not excel'), 'prices.xlsx')).status).toBe(400);
    expect((await p.post(`/api/price-batches/${b.id}/upload`).attach('file', Buffer.from('a,b'), 'prices.csv')).status).toBe(400);
    const t = await p.get('/api/price-batches/template').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(t.status).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.body as any);
    expect(wb.getWorksheet('Prices')!.rowCount).toBeGreaterThan(6);
  });
  it('valid upload → impact preview → submit → approve publishes atomically with audit; stale proposals are rejected', async () => {
    const p = await loginAs(fx.email('pricing')); const f = await loginAs(fx.email('finance'));
    const b1 = (await p.post('/api/price-batches').send({ name: 'Good upload', effectiveFrom: iso(0) })).body;
    const file = await xlsx([['MRK', 'CEM', 'Cement', 'tonne', 85, 'delivered_plant', null, iso(0)], ['MRK', 'SAND', 'Sand', 'tonne', 10, 'ex_source', 3, iso(0)]]);
    expect((await p.post(`/api/price-batches/${b1.id}/upload`).attach('file', file, 'prices.xlsx')).status).toBe(200);
    // a competing batch built on the same base prices
    const b2 = (await p.post('/api/price-batches').send({ name: 'Competing', effectiveFrom: iso(0) })).body;
    await p.put(`/api/price-batches/${b2.id}/items`).send({ items: [{ plantCode: 'MRK', materialCode: 'CEM', price: '86', basis: 'delivered_plant', effectiveFrom: iso(0) }] });
    const det = (await p.get(`/api/price-batches/${b1.id}`)).body;
    const cem = det.items.find((i: any) => i.materialCode === 'CEM');
    expect(cem.change).toBe('7.0000'); expect(cem.changePct).toBe('8.97');
    expect(det.impact.length).toBeGreaterThan(0); // approved mixes affected
    const c30 = det.impact.find((x: any) => x.code === 'C30');
    expect(Number(c30.after)).toBeGreaterThan(Number(c30.before));
    expect((await p.post(`/api/price-batches/${b1.id}/submit`).send({})).status).toBe(200);
    expect((await p.put(`/api/price-batches/${b1.id}/items`).send({ items: [] })).status).toBe(409); // submitted ⇒ immutable
    await expect(db.execute(sql`update price_batch_items set proposed_price = 1 where batch_id = ${b1.id}`)).rejects.toThrow(/immutable/);
    await p.post(`/api/price-batches/${b2.id}/submit`).send({});
    const before = await activePrice('MRK', 'CEM');
    expect((await f.post(`/api/price-batches/${b1.id}/approve`).send({})).status).toBe(200);
    const after = await activePrice('MRK', 'CEM');
    expect(after.price).toBe('85.000000'); expect(after.id).not.toBe(before.id);
    const old = (await db.select().from(schema.materialPriceVersions).where(eq(schema.materialPriceVersions.id, before.id)))[0]!;
    expect(old.validTo).toBe(iso(0)); expect(after.validFrom).toBe(iso(0)); // no gap, no overlap
    const audits = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, fx.t.id), eq(schema.auditEvents.entityType, 'material_price'), eq(schema.auditEvents.action, 'published')));
    expect(audits.length).toBeGreaterThanOrEqual(2);
    // the competing proposal is now stale and is rejected without any partial change
    const stale = await f.post(`/api/price-batches/${b2.id}/approve`).send({});
    expect(stale.status).toBe(409); expect(stale.body.error.code).toBe('stale_batch');
    expect((await activePrice('MRK', 'CEM')).price).toBe('85.000000');
  });
  it('publish is all-or-nothing: a failing item rolls back the whole batch', async () => {
    const p = await loginAs(fx.email('pricing')); const f = await loginAs(fx.email('finance'));
    const b = (await p.post('/api/price-batches').send({ name: 'Atomic', effectiveFrom: iso(0) })).body;
    await p.put(`/api/price-batches/${b.id}/items`).send({ items: [{ plantCode: 'MRK', materialCode: 'AGG19', price: '9', basis: 'ex_source', freight: '3.5', effectiveFrom: iso(0) }, { plantCode: 'SHB', materialCode: 'AGG19', price: '9', basis: 'ex_source', freight: '3.5', effectiveFrom: iso(0) }] });
    await p.post(`/api/price-batches/${b.id}/submit`).send({});
    // another batch changes the SHB price after this one was submitted → this batch is stale for item 2 only
    const other = (await p.post('/api/price-batches').send({ name: 'Other', effectiveFrom: iso(0) })).body;
    await p.put(`/api/price-batches/${other.id}/items`).send({ items: [{ plantCode: 'SHB', materialCode: 'AGG19', price: '9.9', basis: 'ex_source', freight: '3.5', effectiveFrom: iso(0) }] });
    await p.post(`/api/price-batches/${other.id}/submit`).send({});
    expect((await f.post(`/api/price-batches/${other.id}/approve`).send({})).status).toBe(200);
    const r = await f.post(`/api/price-batches/${b.id}/approve`).send({});
    expect(r.status).toBe(409);
    expect((await activePrice('MRK', 'AGG19')).price).toBe('8.500000'); // item 1 was NOT applied
    expect((await db.select().from(schema.priceBatches).where(eq(schema.priceBatches.id, b.id)))[0]!.status).toBe('submitted');
    // revise against current prices, then it publishes
    expect((await p.post(`/api/price-batches/${b.id}/revise`).send({})).status).toBe(200);
    await p.post(`/api/price-batches/${b.id}/submit`).send({});
    expect((await f.post(`/api/price-batches/${b.id}/approve`).send({})).status).toBe(200);
    expect((await activePrice('MRK', 'AGG19')).price).toBe('9.000000');
  });
  it('the database refuses overlapping periods and edits of published versions', async () => {
    await expect(db.insert(schema.materialPriceVersions).values({ tenantId: fx.t.id, materialId: fx.cat.materials.WATER!, plantId: fx.cat.plants.MRK!, price: '2', basis: 'delivered_plant', validFrom: iso(-10) })).rejects.toThrow(/no_overlap|conflicting key/);
    await expect(db.execute(sql`update material_price_versions set price = 1 where plant_id = ${fx.cat.plants.MRK} and material_id = ${fx.cat.materials.WATER}`)).rejects.toThrow(/immutable/);
    await expect(db.execute(sql`delete from material_price_versions where plant_id = ${fx.cat.plants.MRK}`)).rejects.toThrow(/immutable/);
  });
  it('plant cost: fixed-cost allocation uses the forecast; drafts become effective only when approved by a different user', async () => {
    const p = await loginAs(fx.email('pricing')); const f = await loginAs(fx.email('finance'));
    const costs = (await p.get(`/api/plant-costs?plantId=${fx.cat.plants.MRK}`)).body;
    const v = costs.versions[0];
    const dup = await p.post('/api/plant-costs').send({ plantId: fx.cat.plants.MRK, validFrom: iso(1), fixedCosts: [...v.fixedCosts, { key: 'w2', name: 'Salaries', nature: 'wages', monthlyJod: '1000' }], variableCosts: v.variableCosts, corporateOverheadPerM3: '1.2', riskProvisionPerM3: '0.5', delivery: v.delivery, pumping: v.pumping });
    expect(dup.status).toBe(422); // wages counted twice
    const ok = await p.post('/api/plant-costs').send({ plantId: fx.cat.plants.MRK, validFrom: iso(1), fixedCosts: v.fixedCosts, variableCosts: v.variableCosts, corporateOverheadPerM3: '1.5', riskProvisionPerM3: '0.5', delivery: v.delivery, pumping: v.pumping });
    expect(ok.status).toBe(201);
    expect((await p.post(`/api/plant-costs/${ok.body.id}/publish`).send({})).status).toBe(403);
    expect((await f.post(`/api/plant-costs/${ok.body.id}/publish`).send({})).status).toBe(200);
    const sens = await p.post('/api/plant-costs/sensitivity').send({ plantId: fx.cat.plants.MRK, volumes: ['5000', '10000', '20000'] });
    expect(sens.body.rows.map((r: any) => r.allocatedPerM3)).toEqual(['6.0000', '3.0000', '1.5000']);
    expect((await p.get('/api/dashboard')).status).toBe(200);
    const fc = await p.post('/api/forecasts').send({ plantId: fx.cat.plants.MRK, validFrom: iso(2), monthlyM3: '0', source: 'bad' });
    expect(fc.status).toBeGreaterThanOrEqual(400);
  });
});

describe('offline sync', () => {
  it('replaying the same idempotency key does not duplicate; stale base versions conflict visibly', async () => {
    const s = await loginAs(fx.email('sales'));
    const id = crypto.randomUUID();
    const key = 'idem-' + crypto.randomUUID();
    const op = { idempotencyKey: key, type: 'quotation.save', quotationId: id, revNo: 1, baseVersion: 0, create: true, doc: quoteDoc(fx) };
    const r1 = await s.post('/api/sync/operations').send(op);
    expect(r1.status).toBe(200); expect(r1.body.number).toMatch(/^Q-/);
    const r2 = await s.post('/api/sync/operations').send(op); // network retry
    expect(r2.status).toBe(200); expect(r2.body.replayed).toBe(true); expect(r2.body.number).toBe(r1.body.number);
    const count = await db.select({ n: sql<number>`count(*)::int` }).from(schema.quotations).where(eq(schema.quotations.id, id));
    expect(count[0]!.n).toBe(1);
    // concurrent edit on another device bumps the server version
    const online = await s.put(`/api/quotations/${id}/revisions/1`).send({ baseVersion: r1.body.version, doc: quoteDoc(fx, { customerNotes: 'edited online' }) });
    expect(online.status).toBe(200);
    // offline device still has baseVersion = r1.version → conflict with server copy returned
    const stale = await s.post('/api/sync/operations').send({ ...op, idempotencyKey: 'idem-' + crypto.randomUUID(), create: false, baseVersion: r1.body.version, doc: quoteDoc(fx, { customerNotes: 'edited offline' }) });
    expect(stale.status).toBe(409); expect(stale.body.status).toBe('conflict');
    expect(stale.body.error.serverDoc.customerNotes).toBe('edited online');
    // resolution: re-apply on the server version with a new key
    const resolved = await s.post('/api/sync/operations').send({ ...op, idempotencyKey: 'idem-' + crypto.randomUUID(), create: false, baseVersion: stale.body.error.serverVersion, doc: quoteDoc(fx, { customerNotes: 'merged' }) });
    expect(resolved.status).toBe(200);
    // retrying the conflicted op replays the same conflict rather than applying it
    const again = await s.post('/api/sync/operations').send({ ...op, idempotencyKey: key, create: false });
    expect(again.body.replayed).toBe(true);
  });
  it('sync revalidates permissions and plant scope; offline drafts can never be issued or approved', async () => {
    const v = await loginAs(fx.email('viewer'));
    const r = await v.post('/api/sync/operations').send({ idempotencyKey: 'idem-' + crypto.randomUUID(), type: 'quotation.save', quotationId: crypto.randomUUID(), revNo: 1, baseVersion: 0, create: true, doc: quoteDoc(fx) });
    expect(r.status).toBe(403);
    const s = await loginAs(fx.email('sales'));
    const out = await s.post('/api/sync/operations').send({ idempotencyKey: 'idem-' + crypto.randomUUID(), type: 'quotation.save', quotationId: crypto.randomUUID(), revNo: 1, baseVersion: 0, create: true, doc: quoteDoc(fx, { plantId: fx.cat.plants.SHB }) });
    expect(out.status).toBe(403);
    expect((await s.post('/api/sync/operations').send({ idempotencyKey: 'x', type: 'quotation.issue', quotationId: crypto.randomUUID(), baseVersion: 0, doc: quoteDoc(fx) })).status).toBe(400);
  });
});
