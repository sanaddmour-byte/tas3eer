import { describe, expect, it } from 'vitest';
import {
  allocateFixed, dosageUnitsPerPurchaseUnit, fixedCostSensitivity, materialCostBreakdown, priceQuotation,
  proposedPrice, actualMarginPct, Dec, PricingError, solveRateForInclusiveTotal, computeTax, validatePlantCost,
} from '../src';
import { forecast, mats, plantCost, prices, quote, tax } from './fixtures';

const m = (id: string) => (mats as any).find((x: any) => x.id === id);

describe('unit conversions & material costing', () => {
  it('350 kg cement/m3 × 100 JOD/tonne = 35 JOD/m3', () => {
    const r = materialCostBreakdown([{ materialId: 'cem', dosage: '350' }], mats as any, prices as any, 4);
    expect(r.total).toBe('35.0000');
    expect(r.lines[0]!.formula).toContain('= 35.0000 JOD/m³');
  });
  it('adds procurement freight for ex-source prices', () => {
    const r = materialCostBreakdown([{ materialId: 'sand', dosage: '800' }], mats as any, prices as any, 4);
    expect(r.total).toBe('9.6000'); // 800/1000 × (10+2)
  });
  it('converts litres to kg using density', () => {
    expect(dosageUnitsPerPurchaseUnit(m('adm') as any).toString()).toBe('1.1'); // 1 L = 1.1 kg
  });
  it('rejects missing density for mass/volume conversion', () => {
    expect(() => dosageUnitsPerPurchaseUnit({ ...m('adm'), densityKgPerM3: null } as any)).toThrow(/Density/);
  });
  it('rejects bag→kg without explicit factor and invalid factors', () => {
    expect(() => dosageUnitsPerPurchaseUnit({ id: 'x', name: 'X', purchaseUnit: 'bag', dosageUnit: 'kg', wastagePct: '0' } as any)).toThrow(/conversion factor/);
    expect(() => dosageUnitsPerPurchaseUnit({ id: 'x', name: 'X', purchaseUnit: 'bag', dosageUnit: 'kg', conversionFactor: '0', wastagePct: '0' } as any)).toThrow(/greater than zero/);
    expect(dosageUnitsPerPurchaseUnit({ id: 'x', name: 'X', purchaseUnit: 'bag', dosageUnit: 'kg', conversionFactor: '50', wastagePct: '0' } as any).toString()).toBe('50');
  });
  it('never treats a missing price as zero and reports all missing items together', () => {
    const p = prices.filter((x) => x.materialId !== 'cem').map((x) => ({ ...x })) as any;
    try { materialCostBreakdown([{ materialId: 'cem', dosage: '350' }, { materialId: 'sand', dosage: '800' }], mats as any, p, 4); expect.unreachable(); }
    catch (e) { expect((e as PricingError).issues[0]!.message).toBe('Cement price is missing for this plant.'); }
  });
  it('requires explicit freight for ex-source price', () => {
    const p = [{ ...prices[1], freightPerPurchaseUnit: null }] as any;
    expect(() => materialCostBreakdown([{ materialId: 'sand', dosage: '800' }], mats as any, p, 4)).toThrow(/freight is required/);
  });
  it('applies wastage', () => {
    const ms = [{ ...m('cem'), wastagePct: '2' }] as any;
    expect(materialCostBreakdown([{ materialId: 'cem', dosage: '350' }], ms, prices as any, 4).total).toBe('35.7000');
  });
  it('rejects duplicate ingredients', () => {
    expect(() => materialCostBreakdown([{ materialId: 'cem', dosage: '1' }, { materialId: 'cem', dosage: '2' }], mats as any, prices as any, 4)).toThrow(/more than once/);
  });
});

describe('plant costing', () => {
  it('30,000 JOD/month / 10,000 m3/month = 3 JOD/m3', () => {
    expect(allocateFixed(new Dec(30000), forecast, 4).toString()).toBe('3');
  });
  it('rejects zero, negative and missing forecast', () => {
    expect(() => allocateFixed(new Dec(30000), { ...forecast, monthlyM3: '0' }, 4)).toThrow(/greater than zero/);
    expect(() => allocateFixed(new Dec(30000), { ...forecast, monthlyM3: '-5' }, 4)).toThrow(/greater than zero/);
    expect(() => allocateFixed(new Dec(30000), null, 4)).toThrow(/monthly forecast volume/);
  });
  it('sensitivity does not change allocation inputs', () => {
    const s = fixedCostSensitivity('30000', ['5000', '10000', '0']);
    expect(s.map((x) => x.allocatedPerM3)).toEqual(['6.0000', '3.0000', null]);
  });
  it('detects double inclusion of wages/depreciation and misplaced delivery', () => {
    const pc = { ...plantCost, fixedCosts: [...plantCost.fixedCosts, { key: 'w2', name: 'Staff salaries', nature: 'wages', monthlyJod: '100' }, { key: 'x', name: 'Trucks', nature: 'delivery', monthlyJod: '5' }] } as any;
    const codes = validatePlantCost(pc).map((i) => i.code);
    expect(codes).toContain('cost_nature_duplicate');
    expect(codes).toContain('cost_misplaced');
    const dupName = { ...plantCost, variableCosts: [{ key: 'q', name: 'wages', nature: 'other', jodPerM3: '1' }] } as any;
    expect(validatePlantCost(dupName).map((i) => i.code)).toContain('cost_duplicate');
  });
});

describe('pricing modes and overrides', () => {
  const c = new Dec(40);
  it('gross margin 20% on cost 40 = 50', () => expect(proposedPrice(c, 'gross_margin', '20', 3).toString()).toBe('50'));
  it('markup 20% on cost 40 = 48', () => expect(proposedPrice(c, 'markup', '20', 3).toString()).toBe('48'));
  it('override 45 → margin ≈ 11.111%', () => expect(actualMarginPct(new Dec(45), c)!.toFixed(3)).toBe('11.111'));
  it('validates ranges', () => {
    expect(() => proposedPrice(c, 'gross_margin', '100', 3)).toThrow(/Gross margin/);
    expect(() => proposedPrice(c, 'gross_margin', '-1', 3)).toThrow();
    expect(() => proposedPrice(c, 'markup', '-5', 3)).toThrow(/Markup/);
  });
  it('quotation: cost incl. fixed allocation; price & margin exclude tax', () => {
    const r = priceQuotation(quote());
    const l = r.lines[0]!;
    // materials 35 + 9.6 = 44.6; production 1 + 3 = 4 → 48.6; price = 48.6/0.8 = 60.75
    expect(l.internal.fullCostPerM3).toBe('48.6000');
    expect(l.customerRatePerM3).toBe('60.750');
    expect(l.amount).toBe('3037.500');
    expect(l.internal.marginPct).toBe('20.000');
    expect(r.customer.tax!.tax).toBe('486.000');
    expect(r.customer.total).toBe('3523.500');
    expect(r.internal.marginAfterFullCostPct).toBe('20.000');
    // contribution before fixed: 3037.5 − 50×(44.6+1)= 757.5
    expect(r.internal.contributionBeforeFixed).toBe('757.500');
  });
  it('price override requires reason and triggers approval; margin from final price', () => {
    const q = quote(); q.lines[0]!.priceOverride = { perM3: '54', reason: '' };
    const r = priceQuotation(q);
    expect(r.issues.map((i) => i.code)).toContain('price_override_reason');
    expect(r.approvals.map((a) => a.code)).toContain('price_override');
    q.lines[0]!.priceOverride = { perM3: '50', reason: 'competitor' };
    const r2 = priceQuotation(q);
    expect(r2.lines[0]!.internal.marginPct).toBe('2.800'); // (50-48.6)/50
    expect(r2.approvals.map((a) => a.code)).toContain('below_margin_threshold');
  });
  it('cost override needs reason and approval', () => {
    const q = quote(); q.lines[0]!.costOverride = { perM3: '40', reason: 'bulk deal' };
    const r = priceQuotation(q);
    expect(r.lines[0]!.customerRatePerM3).toBe('50.000');
    expect(r.approvals.map((a) => a.code)).toContain('cost_override');
  });
  it('flags below-cost pricing', () => {
    const q = quote(); q.lines[0]!.priceOverride = { perM3: '40', reason: 'x' };
    expect(priceQuotation(q).approvals.map((a) => a.code)).toContain('below_cost');
  });
  it('missing quantity is an error, not zero', () => {
    const q = quote(); q.lines[0]!.quantityM3 = '';
    const r = priceQuotation(q);
    expect(r.issues.some((i) => i.code === 'quantity_invalid')).toBe(true);
    expect(r.customer.total).toBeNull();
  });
  it('missing forecast blocks pricing', () => {
    const r = priceQuotation(quote({ forecast: null }));
    expect(r.issues.map((i) => i.message)).toContain('Enter a monthly forecast volume to allocate fixed costs.');
  });
  it('reports stale prices', () => {
    const r = priceQuotation(quote({ asOf: '2027-02-01' }));
    expect(r.issues.some((i) => i.code === 'price_stale')).toBe(true);
  });
});

describe('delivery & pumping', () => {
  const svc = (s: any[], scope: any = 'supply_delivery_pumping') => priceQuotation(quote({ scope, services: s }));
  it('pumping 2 JOD/m3 × 50 m3 with 150/visit minimum = 150', () => {
    const r = svc([{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping' }]);
    const p = r.services.find((s) => s.type === 'pumping')!;
    expect(p.rows[0]!.amount).toBe('150.000');
    expect(p.amount).toBe('150.000');
  });
  it('minimum applies per visit: two visits of 25 m3 → 300', () => {
    const r = svc([{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping', units: 2 }]);
    expect(r.services.find((s) => s.type === 'pumping')!.amount).toBe('300.000');
  });
  it('minimum per quotation applies once', () => {
    const pc = { ...plantCost, pumping: { ...plantCost.pumping, minBasis: 'per_quotation' } } as any;
    const r = priceQuotation(quote({ scope: 'supply_delivery_pumping', plantCost: pc, services: [{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping', units: 3 }] }));
    expect(r.services.find((s) => s.type === 'pumping')!.amount).toBe('150.000');
  });
  it('mobilization and extra hours are separate rows', () => {
    const pc = { ...plantCost, pumping: { ...plantCost.pumping, mobilizationFee: '25' } } as any;
    const r = priceQuotation(quote({ scope: 'supply_delivery_pumping', plantCost: pc, services: [{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping', units: 1, extraHours: '2' }] }));
    const p = r.services.find((s) => s.type === 'pumping')!;
    expect(p.rows.map((x) => x.amount)).toEqual(['150.000', '25.000', '60.000']);
    expect(p.amount).toBe('235.000');
  });
  it('trip delivery requires distance and capacity assumptions; trips rounded up', () => {
    const miss = svc([{ id: 'd', type: 'delivery', method: 'trip' }, { id: 'p', type: 'pumping' }]);
    expect(miss.issues.map((i) => i.code)).toContain('trip_distance_missing');
    const ok = svc([{ id: 'd', type: 'delivery', method: 'trip', roundTripKm: '20' }, { id: 'p', type: 'pumping' }]);
    const d = ok.services.find((s) => s.type === 'delivery')!;
    expect(d.rows[0]!.quantity).toBe('8'); // ceil(50/7)
    expect(d.amount).toBe('320.000');
    expect(d.estimatedCost).toBe('120.0000'); // 8 × (5 + 20×0.5)
  });
  it('rejects double inclusion of delivery/pumping and out-of-scope services', () => {
    const dup = svc([{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'd2', type: 'delivery', method: 'zone', zoneCode: 'Z1' }, { id: 'p', type: 'pumping' }]);
    expect(dup.issues.map((i) => i.code)).toContain('delivery_duplicate');
    const oos = svc([{ id: 'd', type: 'delivery', method: 'per_m3' }], 'supply_only');
    expect(oos.issues.map((i) => i.code)).toContain('scope_conflict');
    expect(svc([], 'supply_delivery').issues.map((i) => i.code)).toContain('delivery_missing');
  });
  it('separates estimated cost from customer charge and includes service cost in margin', () => {
    const r = svc([{ id: 'd', type: 'delivery', method: 'per_m3' }, { id: 'p', type: 'pumping' }]);
    expect(r.customer.deliveryTotal).toBe('200.000');
    // delivery cost 50×3 = 150; pumping cost 50×1 + 1 visit×20 = 70
    expect(r.internal.serviceEstimatedCost).toBe('220.000');
  });
});

describe('tax', () => {
  it('line splitting does not change tax (even with per_line deduction)', () => {
    const pol = { ...tax, deductionAmount: '5', deductionBasis: 'per_line' } as any;
    const one = priceQuotation(quote({ tax: pol }));
    const q = quote({ tax: pol });
    const l = q.lines[0]!;
    q.lines = [{ ...l, id: 'a', quantityM3: '30' }, { ...l, id: 'b', quantityM3: '20' }];
    const two = priceQuotation(q);
    expect(two.customer.tax!.deduction).toBe(one.customer.tax!.deduction);
    expect(two.customer.taxAmount).toBe(one.customer.taxAmount);
  });
  it('per-m3 deduction, non-negative base', () => {
    const pol = { ...tax, deductionAmount: '16', deductionBasis: 'per_m3' } as any;
    const r = priceQuotation(quote({ tax: pol }));
    expect(r.customer.tax!.deduction).toBe('800.000');
    expect(r.customer.tax!.taxableBase).toBe('2237.500');
    const huge = computeTax({ ...pol, deductionAmount: '1000' }, { componentAmounts: { concrete: new Dec(100), delivery: new Dec(0), pumping: new Dec(0), other: new Dec(0) }, totalConcreteM3: new Dec(1), logicalLineCount: 1 }, 3);
    expect(huge.taxableBase).toBe('0.000'); expect(huge.tax).toBe('0.000');
  });
  it('taxable components and delivery treatment follow the policy', () => {
    const pol = { ...tax, taxableComponents: ['concrete'] } as any;
    const r = priceQuotation(quote({ tax: pol, scope: 'supply_delivery', services: [{ id: 'd', type: 'delivery', method: 'per_m3' } as any] }));
    expect(r.customer.tax!.taxableBeforeDeduction).toBe(r.customer.concreteSubtotal);
  });
  it('unverified policy raises a blocker (not a calculation failure)', () => {
    const r = priceQuotation(quote({ tax: { ...tax, status: 'demo' } as any }));
    expect(r.issues.some((i) => i.code === 'tax_unverified' && i.message === 'Tax policy requires verification before issue.')).toBe(true);
    expect(r.customer.total).not.toBeNull();
  });
  it('tax-inclusive inversion returns the forward-consistent rate', () => {
    const q = quote();
    const out = solveRateForInclusiveTotal(q, '4000');
    expect(Math.abs(Number(out.delta))).toBeLessThan(0.05);
    const withDed = quote({ tax: { ...tax, deductionAmount: '16', deductionBasis: 'per_m3' } as any });
    const o2 = solveRateForInclusiveTotal(withDed, '4000');
    expect(Math.abs(Number(o2.delta))).toBeLessThan(0.05);
  });
  it('rejects ambiguous inversion (multiple lines)', () => {
    const q = quote(); q.lines = [q.lines[0]!, { ...q.lines[0]!, id: 'l2' }];
    expect(() => solveRateForInclusiveTotal(q, '4000')).toThrow(/exactly one concrete line/);
  });
});

describe('reconciliation', () => {
  it('displayed lines sum to displayed totals', () => {
    const q = quote({ scope: 'supply_delivery_pumping', services: [{ id: 'd', type: 'delivery', method: 'per_m3' } as any, { id: 'p', type: 'pumping', units: 3 } as any] });
    q.lines[0]!.quantityM3 = '33.333';
    const r = priceQuotation(q);
    const sum = r.lines.reduce((a, l) => a + Number(l.amount), 0) + r.services.reduce((a, s) => a + Number(s.amount), 0);
    expect(sum.toFixed(3)).toBe(r.customer.subtotalExTax);
    expect((Number(r.customer.subtotalExTax) + Number(r.customer.taxAmount)).toFixed(3)).toBe(r.customer.total);
  });
});

import { previewCustomerTotals } from '../src';
describe('offline preview parity', () => {
  it('previewCustomerTotals matches the authoritative engine for customer totals', () => {
    const q = quote({ scope: 'supply_delivery_pumping', services: [{ id: 'd', type: 'delivery', method: 'zone', zoneCode: 'Z1' } as any, { id: 'p', type: 'pumping', units: 2 } as any] });
    const full = priceQuotation(q);
    const pv = previewCustomerTotals({
      scope: q.scope, lines: full.lines.map((l) => ({ id: l.id, mixRevisionId: l.mixRevisionId, quantityM3: l.quantityM3, ratePerM3: l.customerRatePerM3! })),
      services: q.services, rateCard: q.plantCost!, tax: q.tax,
    });
    expect(pv.total).toBe(full.customer.total);
    expect(pv.subtotalExTax).toBe(full.customer.subtotalExTax);
  });
});

describe('company tax scenarios: Exempt 0% / 8% / 16% on the amount above JOD 16 per line', () => {
  const sc = (ratePct: string) => ({ ...tax, ratePct, deductionAmount: '16', deductionBasis: 'per_line' }) as any;
  const doc = (lines: [number, number][], svc = 0) => ({ componentAmounts: { concrete: new Dec(lines.reduce((a, l) => a + l[0], 0)), delivery: new Dec(svc), pumping: new Dec(0), other: new Dec(0) }, totalConcreteM3: new Dec(1), logicalLineCount: lines.length, lines: lines.map(([c, q]) => ({ concrete: new Dec(c), qty: new Dec(q) })) });
  it('JOD 100 → 6.72 at 8% and 13.44 at 16%; 16 or less → 0', () => {
    expect(computeTax(sc('8'), doc([[100, 1]]), 3).tax).toBe('6.720');
    expect(computeTax(sc('16'), doc([[100, 1]]), 3).tax).toBe('13.440');
    expect(computeTax(sc('16'), doc([[16, 1]]), 3).tax).toBe('0.000');
    expect(computeTax(sc('16'), doc([[9, 1]]), 3).tax).toBe('0.000');
    expect(computeTax({ ...sc('0') } as any, doc([[100, 1]]), 3).tax).toBe('0.000'); // Exempt
  });
  it('each line is taxed separately: a small line contributes nothing (not netted against a big one)', () => {
    expect(computeTax(sc('16'), doc([[100, 1], [10, 1]]), 3).tax).toBe('13.440'); // document-level netting would give 16 × (110 − 32) = 12.48
  });
  it('delivery/pumping charges join the line subtotal pro rata by quantity', () => {
    // lines 60 m3 (amount 20) and 40 m3 (amount 10) + 100 delivery → shares 60 / 40 → subtotals 80 and 50 → tax 16%×(64+34)
    expect(computeTax(sc('16'), doc([[20, 60], [10, 40]], 100), 3).tax).toBe('15.680');
  });
  it('splitting a line with the same mix and rate cannot change tax', () => {
    const q = quote({ tax: sc('16') }); const one = priceQuotation(q);
    const l = q.lines[0]!; q.lines = [{ ...l, id: 'a', quantityM3: '30' }, { ...l, id: 'b', quantityM3: '20' }];
    expect(priceQuotation(q).customer.taxAmount).toBe(one.customer.taxAmount);
  });
  it('a manually overridden line is taxed like any other line', () => {
    const q = quote({ tax: sc('16') }); q.lines[0]!.priceOverride = { perM3: '50', reason: 'x' };
    expect(priceQuotation(q).customer.taxAmount).toBe((Math.round((2500 - 16) * 0.16 * 1000) / 1000).toFixed(3));
  });
});
