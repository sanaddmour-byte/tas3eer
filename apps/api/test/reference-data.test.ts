import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { importReferencePrices, importablePrices, referencePrices } from '../src/seed/reference-prices.js';
import { importCompanyTerms, mobileTerms, standardTerms } from '../src/seed/terms.js';
import { quotationHtml } from '../src/services/pdf.js';
import { createTenant, createUser } from '../src/seed/fixture.js';
import { PW, uniq } from './helpers.js';

describe('company-supplied reference data', () => {
  it('terms: 13 + 13 clauses, each with Arabic; imported as drafts; Arabic PDF html uses the Arabic text', async () => {
    expect(standardTerms).toHaveLength(13); expect(mobileTerms).toHaveLength(13);
    for (const c of [...standardTerms, ...mobileTerms]) { expect(c.text.length).toBeGreaterThan(10); expect(c.textAr).toMatch(/[؀-ۿ]/); }
    const t = await createTenant('Terms Co', `terms-${uniq()}`);
    await importCompanyTerms(t.id);
    const rows = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.tenantId, t.id));
    expect(rows.map((r) => r.status)).toEqual(['draft', 'draft']);
    const snap = { customer: { quotationNumber: 'Q', revNo: 1, frozenAt: new Date().toISOString(), client: { name: 'c' }, project: { name: 'p', siteAddress: '' }, plant: { nameEn: 'P', nameAr: '' }, scope: 'supply_only', validityDays: 14, paymentTerms: 'x', mixes: [], lines: [], services: [], totals: { subtotalExTax: '0', total: '0', tax: null }, terms: { name: 'n', version: 1, clauses: rows[0]!.clauses }, company: {} } };
    const ar = quotationHtml(snap, { number: 'Q', issuedAt: null, validUntil: null, issued: false }, 'ar');
    expect(ar).toContain('الأسعار سارية فقط'); expect(ar).not.toContain('Prices are valid only through');
    expect(quotationHtml(snap, { number: 'Q', issuedAt: null, validUntil: null, issued: false }, 'en')).toContain('Prices are valid only through');
  });
  it('reference prices: 12 plants × 16 materials, zeros skipped, imported only as a draft batch (nothing published)', async () => {
    expect(referencePrices).toHaveLength(192);
    expect(importablePrices.every((p) => p.price > 0)).toBe(true);
    expect(referencePrices.length - importablePrices.length).toBe(17); // 16 Project Batch Plant rows + Jiza water
    const t = await createTenant('Prices Co', `prices-${uniq()}`);
    const { user } = await createUser(t.id, `p-${uniq()}@x.example`, 'P', 'pricing', PW);
    const r = await importReferencePrices(t.id, user.id);
    expect(r.items).toBe(importablePrices.length);
    const [b] = await db.select().from(schema.priceBatches).where(eq(schema.priceBatches.id, r.batchId));
    expect(b!.status).toBe('draft');
    expect(await db.select().from(schema.materialPriceVersions).where(eq(schema.materialPriceVersions.tenantId, t.id))).toHaveLength(0);
    const marka = (await db.select().from(schema.plants).where(and(eq(schema.plants.tenantId, t.id), eq(schema.plants.code, 'MRK'))))[0]!;
    const opc = (await db.select().from(schema.materials).where(and(eq(schema.materials.tenantId, t.id), eq(schema.materials.code, 'OPC'))))[0]!;
    const item = (await db.select().from(schema.priceBatchItems).where(and(eq(schema.priceBatchItems.batchId, r.batchId), eq(schema.priceBatchItems.plantId, marka.id), eq(schema.priceBatchItems.materialId, opc.id))))[0]!;
    expect(Number(item.proposedPrice)).toBe(77.71);
  });
});
