import { describe, expect, it, beforeAll } from 'vitest';
import { db, schema } from '../src/db/client.js';
import { eq, sql } from 'drizzle-orm';
import { createQuote, loginAs, makeTenant, quoteDoc, type TenantFx } from './helpers.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let fx: TenantFx;
beforeAll(async () => { fx = await makeTenant(); });

async function pdfText(buf: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); const c = await p.getTextContent(); pages.push(c.items.map((x: any) => x.str).join(' ')); }
  return { pages, text: pages.join('\n') };
}
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe('quotation lifecycle, snapshots and approvals', () => {
  it('draft → submit (auto-approved within policy) → issue → PDF; price change leaves issued quote unchanged; reprice makes a new revision', async () => {
    const sales = await loginAs(fx.email('sales'));
    const q = await createQuote(sales, quoteDoc(fx));
    expect(q.result.customer.total).toBeTruthy();
    const detail0 = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(detail0.quotation.number).toMatch(/^Q-\d{4}-\d{5}$/);
    const sub = await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    expect(sub.status).toBe(200); expect(sub.body.status).toBe('approved'); expect(sub.body.reasons).toEqual([]);
    const issue = await sales.post(`/api/quotations/${q.id}/revisions/1/issue`).send({ lang: 'en' });
    expect(issue.status).toBe(200);
    const d1 = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(d1.revision.status).toBe('issued');
    const totalBefore = d1.revision.snapshot.customer.totals.total;
    const hashBefore = d1.revision.snapshotHash;

    // PDF totals match the frozen revision
    const pdf = await sales.get(`/api/quotations/${q.id}/revisions/1/pdf?lang=en`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const { text } = await pdfText(pdf.body as Buffer);
    const fmt = (v: string) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 3 });
    expect(text).toContain(fmt(totalBefore));
    expect(text).toContain(fmt(d1.revision.snapshot.customer.totals.subtotalExTax));
    expect(text).toContain(d1.quotation.number);
    expect(text).not.toMatch(/margin|Cost|recipe|Cement CEM/i); // no internal data
    expect(text).not.toContain('secret internal note');
    // stored PDF hash matches the one recorded at issue
    const crypto = await import('node:crypto');
    expect(crypto.createHash('sha256').update(pdf.body as Buffer).digest('hex')).toBe(issue.body.pdfSha256);

    // publish a price change (cement +10%) → issued quote unchanged
    const pricing = await loginAs(fx.email('pricing')); const fin = await loginAs(fx.email('finance'));
    const b = (await pricing.post('/api/price-batches').send({ name: 'Cement up', plantId: fx.cat.plants.MRK, effectiveFrom: iso(0) })).body;
    // effective today requires the existing version to start earlier (45 days ago) ✓
    const put = await pricing.put(`/api/price-batches/${b.id}/items`).send({ items: [{ plantCode: 'MRK', materialCode: 'CEM', price: '90', basis: 'delivered_plant', effectiveFrom: iso(0) }] });
    expect(put.status).toBe(200);
    expect((await pricing.post(`/api/price-batches/${b.id}/submit`).send({})).status).toBe(200);
    expect((await pricing.post(`/api/price-batches/${b.id}/approve`).send({})).status).toBe(403); // proposer cannot self-approve
    expect((await fin.post(`/api/price-batches/${b.id}/approve`).send({})).status).toBe(200);

    const d2 = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(d2.revision.snapshot.customer.totals.total).toBe(totalBefore);
    expect(d2.revision.snapshotHash).toBe(hashBefore);
    // DB-level immutability of the frozen revision
    await expect(db.execute(sql`update quotation_revisions set doc = '{}'::jsonb where quotation_id = ${q.id} and rev_no = 1`)).rejects.toThrow(/immutable/);

    // "revise" keeps pinned (old) prices; "reprice" uses the new ones
    const rv = await sales.post(`/api/quotations/${q.id}/revise`).send({});
    expect(rv.status).toBe(201); expect(rv.body.revNo).toBe(2);
    const saved2 = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(saved2.revision.doc.pinnedReference).toBe(true);
    const upd = await sales.put(`/api/quotations/${q.id}/revisions/2`).send({ baseVersion: saved2.revision.version, doc: saved2.revision.doc });
    expect(upd.body.result.customer.total).toBe(totalBefore); // same prices
    // switching a pinned draft to current prices happens in place; once frozen, repricing creates a new revision
    const inPlace = await sales.post(`/api/quotations/${q.id}/reprice`).send({});
    expect(inPlace.body).toMatchObject({ revNo: 2, inPlace: true });
    expect((await sales.post(`/api/quotations/${q.id}/revisions/2/submit`).send({})).body.status).toBe('approved');
    const rp = await sales.post(`/api/quotations/${q.id}/reprice`).send({});
    expect(rp.body.revNo).toBe(3);
    const d3 = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(d3.revision.revNo).toBe(3); expect(d3.revision.status).toBe('draft');
    expect(Number(d3.revision.result.customer.total)).toBeGreaterThan(Number(totalBefore));
    expect(d3.revisions.map((r: any) => r.status)).toEqual(['draft', 'superseded', 'superseded']);
    expect(Number(d3.revision.result.customer.total)).toBeGreaterThan(Number(totalBefore));
    // old revision still intact
    const old = (await sales.get(`/api/quotations/${q.id}/revisions/1`)).body;
    expect(old.revision.snapshot.customer.totals.total).toBe(totalBefore);
  });

  it('price override needs approval; editing a pending revision invalidates it and creates a new draft; approval applies to the exact revision', async () => {
    const sales = await loginAs(fx.email('sales')); const fin = await loginAs(fx.email('finance'));
    const doc = quoteDoc(fx, { lines: [{ id: 'l1', mixRevisionId: fx.cat.mixes.C35!.revId, quantityM3: '40', priceOverride: { perM3: '55', reason: 'Competitive offer' }, costOverride: null }] });
    const q = await createQuote(sales, doc);
    const sub = await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    expect(sub.body.status).toBe('pending_approval');
    expect(sub.body.reasons.map((r: any) => r.code)).toContain('price_override');
    const d = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(d.actions.approve).toBe(false);
    // submitter cannot approve; sales has no approve capability
    expect((await sales.post(`/api/quotations/${q.id}/revisions/1/approve`).send({})).status).toBe(403);
    // sales edits the frozen revision → new draft revision, approval request invalidated
    const edit = await sales.put(`/api/quotations/${q.id}/revisions/1`).send({ baseVersion: d.revision.version, doc: { ...d.revision.doc, lines: [{ ...d.revision.doc.lines[0], quantityM3: '45' }] } });
    expect(edit.status).toBe(200); expect(edit.body.createdNewRevision).toBe(true); expect(edit.body.revNo).toBe(2);
    const ars = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.quotationId, q.id));
    expect(ars.map((a) => a.status)).toEqual(['invalidated']);
    expect((await fin.post(`/api/quotations/${q.id}/revisions/1/approve`).send({})).status).toBe(409);
    // resubmit revision 2 → approve exactly that revision
    expect((await sales.post(`/api/quotations/${q.id}/revisions/2/submit`).send({})).body.status).toBe('pending_approval');
    expect((await fin.post(`/api/quotations/${q.id}/revisions/2/approve`).send({ comment: 'ok' })).status).toBe(200);
    const final = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(final.revision.status).toBe('approved');
    expect(final.revision.snapshot.customer.lines[0].quantityM3).toBe('45');
    // audit trail records the transitions with timestamps
    const trail = (await sales.get(`/api/audit/quotation/${q.id}`)).body.map((e: any) => e.action);
    expect(trail).toEqual(expect.arrayContaining(['created', 'submitted_for_approval', 'revision_created_edit', 'approved']));
  });

  it('missing quantity / missing client block submission with specific messages and nothing is treated as zero', async () => {
    const sales = await loginAs(fx.email('sales'));
    const q = await createQuote(sales, quoteDoc(fx, { clientId: null, projectId: null, lines: [{ id: 'l1', mixRevisionId: fx.cat.mixes.C30!.revId, quantityM3: '', priceOverride: null, costOverride: null }] }));
    expect(q.result.customer.total).toBeNull();
    const sub = await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    expect(sub.status).toBe(422);
    const codes = sub.body.error.blockers.map((b: any) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['client_missing', 'project_missing', 'quantity_invalid']));
    // corrected → saves and prices
    const d = (await sales.get(`/api/quotations/${q.id}`)).body;
    const fixed = await sales.put(`/api/quotations/${q.id}/revisions/1`).send({ baseVersion: d.revision.version, doc: quoteDoc(fx) });
    expect(fixed.status).toBe(200); expect(fixed.body.result.customer.total).toBeTruthy();
  });

  it('issuing requires a verified tax policy and approved terms; delivery/pumping scope pricing works end to end', async () => {
    const fx2 = await makeTenant({ verified: false });
    const sales = await loginAs(fx2.email('sales'));
    const q = await createQuote(sales, quoteDoc(fx2, { scope: 'supply_delivery_pumping', lines: [{ id: 'l1', mixRevisionId: fx2.cat.mixes.C30!.revId, quantityM3: '50', priceOverride: null, costOverride: null }], services: [{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping', units: 1 }] }));
    expect(q.result.services.find((s: any) => s.type === 'pumping').rows[0].amount).toBe('150.000');
    expect(q.result.issues.map((i: any) => i.message)).toContain('Tax policy requires verification before issue.');
    const sub = await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    expect(sub.body.status).toBe('approved');
    const issue = await sales.post(`/api/quotations/${q.id}/revisions/1/issue`).send({});
    expect(issue.status).toBe(422);
    const msgs = issue.body.error.blockers.map((b: any) => b.message);
    expect(msgs).toContain('Tax policy requires verification before issue.');
    expect(msgs).toContain('The selected terms version has not been approved.');
    // an authorised user verifies the policy and approves terms
    const pricing = await loginAs(fx2.email('pricing')); const admin = await loginAs(fx2.email('admin'));
    expect((await sales.post(`/api/tax-policies/${fx2.taxId}/verify`).send({ reference: 'x'.repeat(10) })).status).toBe(403);
    expect((await pricing.post(`/api/tax-policies/${fx2.taxId}/verify`).send({ reference: 'Verified against official guidance (test)' })).status).toBe(200);
    expect((await admin.post(`/api/terms/${fx2.termsId}/approve`).send({})).status).toBe(200);
    expect((await sales.post(`/api/quotations/${q.id}/revisions/1/issue`).send({})).status).toBe(200);
    // economics of a verified policy cannot be edited in place
    await expect(db.execute(sql`update tax_policy_versions set rate_pct = 5 where id = ${fx2.taxId}`)).rejects.toThrow(/immutable/);
  });

  it('records outcomes with lost reason and competitor note; expiry is applied lazily', async () => {
    const sales = await loginAs(fx.email('sales'));
    const q = await createQuote(sales, quoteDoc(fx));
    await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    await sales.post(`/api/quotations/${q.id}/revisions/1/issue`).send({});
    expect((await sales.post(`/api/quotations/${q.id}/revisions/1/outcome`).send({ outcome: 'declined' })).status).toBe(422);
    const r = await sales.post(`/api/quotations/${q.id}/revisions/1/outcome`).send({ outcome: 'declined', lostReason: 'Price', competitorNote: 'Competitor at 58 JOD/m³' });
    expect(r.status).toBe(200);
    const d = (await sales.get(`/api/quotations/${q.id}`)).body;
    expect(d.quotation.status).toBe('declined'); expect(d.quotation.lostReason).toBe('Price');
    const q2 = await createQuote(sales, quoteDoc(fx));
    await sales.post(`/api/quotations/${q2.id}/revisions/1/submit`).send({});
    await sales.post(`/api/quotations/${q2.id}/revisions/1/issue`).send({});
    await db.execute(sql`update quotation_revisions set valid_until = current_date - 1 where quotation_id = ${q2.id}`);
    const list = (await sales.get('/api/quotations')).body;
    expect(list.find((x: any) => x.id === q2.id).status).toBe('expired');
    // invalid transitions are refused
    expect((await sales.post(`/api/quotations/${q2.id}/revisions/1/issue`).send({})).status).toBe(409);
  });

  it('quotation numbers are unique per tenant and generated server-side', async () => {
    const sales = await loginAs(fx.email('sales'));
    const nums = await Promise.all([1, 2, 3, 4, 5].map(() => createQuote(sales, quoteDoc(fx)).then((q) => sales.get(`/api/quotations/${q.id}`).then((r) => r.body.quotation.number))));
    expect(new Set(nums).size).toBe(5);
  });
});

describe('tax-inclusive price entry', () => {
  it('solves the unit rate for an inclusive total; rejects ambiguous (multi-line) and unauthorised use', async () => {
    const sales = await loginAs(fx.email('sales'));
    const one = await sales.post('/api/quotations/solve-inclusive').send({ doc: quoteDoc(fx), target: '4640' });
    expect(one.status).toBe(200);
    expect(Math.abs(Number(one.body.delta))).toBeLessThan(0.05); // forward calculation reproduces the target within rounding
    expect(Number(one.body.achievedTotal)).toBeCloseTo(4640, 1);
    const two = await sales.post('/api/quotations/solve-inclusive').send({ doc: quoteDoc(fx, { lines: [{ id: 'a', mixRevisionId: fx.cat.mixes.C30!.revId, quantityM3: '10', priceOverride: null, costOverride: null }, { id: 'b', mixRevisionId: fx.cat.mixes.C35!.revId, quantityM3: '10', priceOverride: null, costOverride: null }] }), target: '4640' });
    expect(two.status).toBe(422); expect(two.body.error.message).toMatch(/exactly one concrete line/);
    const viewer = await loginAs(fx.email('viewer'));
    expect((await viewer.post('/api/quotations/solve-inclusive').send({ doc: quoteDoc(fx), target: '4640' })).status).toBe(403);
  });
});

describe('PDF rendering', () => {
  it('renders Arabic with RTL, embeds both fonts, repeats table headings across pages and reconciles totals', async () => {
    const sales = await loginAs(fx.email('sales'));
    const lines = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, mixRevisionId: [fx.cat.mixes.C25, fx.cat.mixes.C30, fx.cat.mixes.C35, fx.cat.mixes.C40][i % 4]!.revId, quantityM3: String(10 + i), priceOverride: null, costOverride: null }));
    const q = await createQuote(sales, quoteDoc(fx, { lines, customerNotes: 'ملاحظة طويلة '.repeat(120), paymentTerms: 'الدفع خلال 30 يوما '.repeat(10) }));
    await sales.post(`/api/quotations/${q.id}/revisions/1/submit`).send({});
    const buf = (await sales.get(`/api/quotations/${q.id}/revisions/1/pdf?lang=ar`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); })).body as Buffer;
    const raw = buf.toString('latin1');
    expect(raw).toMatch(/NotoSansArabic/i); expect(raw).toMatch(/Inter/i);
    const { pages, text } = await pdfText(buf);
    expect(pages.length).toBeGreaterThan(1);
    if (process.env.DEBUG_PDF) console.log(JSON.stringify(pages[1]!.slice(0, 400)), JSON.stringify(pages[0]!.slice(0,600)));
    // Arabic header cells carry the unit "دينار/م³" (rows use Latin "m³"); it must appear on every page that has table rows
    const withHeader = pages.filter((pg) => /³\s*م/.test(pg));
    expect(withHeader.length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/[\uFE70-\uFEFF]/); // contextual (shaped) Arabic glyphs present
    const d = (await sales.get(`/api/quotations/${q.id}`)).body;
    const t = d.revision.snapshot.customer.totals;
    const fmt = (v: string) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 3 });
    expect(text).toContain(fmt(t.total)); expect(text).toContain(fmt(t.subtotalExTax));
    const sum = d.revision.snapshot.customer.lines.reduce((a: number, l: any) => a + Number(l.amount), 0);
    expect(sum.toFixed(3)).toBe(t.concreteSubtotal);
    const en = (await sales.get(`/api/quotations/${q.id}/revisions/1/pdf?lang=en`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); })).body as Buffer;
    expect((await pdfText(en)).text).toContain('NOT ISSUED'); // pre-issue copies are stamped
  });
});
