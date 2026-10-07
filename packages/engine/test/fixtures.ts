import type { QuoteInput } from '../src';

export const mats = [
  { id: 'cem', name: 'Cement', purchaseUnit: 'tonne', dosageUnit: 'kg', wastagePct: '0' },
  { id: 'sand', name: 'Sand', purchaseUnit: 'tonne', dosageUnit: 'kg', wastagePct: '0' },
  { id: 'adm', name: 'Admixture', purchaseUnit: 'L', dosageUnit: 'kg', densityKgPerM3: '1100', wastagePct: '0' },
] as const;
export const prices = [
  { materialId: 'cem', versionId: 'pv1', price: '100', basis: 'delivered_plant', effectiveFrom: '2026-09-01' },
  { materialId: 'sand', versionId: 'pv2', price: '10', basis: 'ex_source', freightPerPurchaseUnit: '2', effectiveFrom: '2026-09-01' },
  { materialId: 'adm', versionId: 'pv3', price: '1.1', basis: 'delivered_plant', effectiveFrom: '2026-09-01' },
] as const;

export const plantCost = {
  versionId: 'pc1',
  fixedCosts: [{ key: 'w', name: 'Wages', nature: 'wages', monthlyJod: '20000' }, { key: 'd', name: 'Depreciation', nature: 'depreciation', monthlyJod: '10000' }],
  variableCosts: [{ key: 'e', name: 'Electricity', nature: 'utilities', jodPerM3: '1' }],
  corporateOverheadPerM3: '0', riskProvisionPerM3: '0',
  delivery: { perM3: { chargePerM3: '4', costPerM3: '3' }, zones: [{ code: 'Z1', name: 'Zone 1', chargePerM3: '5', costPerM3: '3.5' }], trip: { truckCapacityM3: '7', chargePerTrip: '40', fixedCostPerTrip: '5', costPerKm: '0.5' } },
  pumping: { chargePerM3: '2', minCharge: '150', minBasis: 'per_visit', mobilizationFee: '0', extraHourRate: '30', costPerM3: '1', costPerUnit: '20' },
} as const;

export const forecast = { versionId: 'f1', monthlyM3: '10000', validFrom: '2026-01-01', source: 'Budget 2026' };
export const tax = { id: 't1', name: 'Test tax', status: 'verified', ratePct: '16', taxableComponents: ['concrete', 'delivery', 'pumping', 'other'], deductionAmount: '0', deductionBasis: 'per_m3', nonNegativeBase: true } as const;

export function quote(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    asOf: '2026-10-07', scope: 'supply_only', staleAfterDays: 60,
    materials: mats as any, prices: prices as any, plantCost: plantCost as any, forecast, tax: tax as any,
    lines: [{
      id: 'l1', mixRevisionId: 'm1', mixCode: 'C30', mixName: 'C30', quantityM3: '50',
      ingredients: [{ materialId: 'cem', dosage: '350' }, { materialId: 'sand', dosage: '800' }],
      policy: { id: 'p1', version: 1, mode: 'gross_margin', pct: '20', minMarginPct: '10' },
    }],
    services: [],
    ...over,
  } as QuoteInput;
}
