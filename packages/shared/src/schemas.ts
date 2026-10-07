import { z } from 'zod';

export const dec = z.string().regex(/^-?\d+(\.\d+)?$/, 'Enter a valid number');
export const posDec = z.string().regex(/^\d+(\.\d+)?$/, 'Enter a non-negative number');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const uuid = z.string().uuid();
export const unit = z.enum(['kg', 'tonne', 'L', 'm3', 'bag', 'drum']);

export const loginInput = z.object({ email: z.string().email(), password: z.string().min(1).max(200), tenantSlug: z.string().optional() });
export const acceptInviteInput = z.object({ token: z.string().min(20), name: z.string().min(1).max(120), password: z.string().min(10).max(200) });
export const inviteInput = z.object({ email: z.string().email(), role: z.enum(['admin', 'pricing', 'technical', 'sales', 'viewer']), plantIds: z.array(uuid).default([]), allPlants: z.boolean().default(false) });
export const setupInput = z.object({
  token: z.string().min(1), companyName: z.string().min(2).max(120), slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  adminName: z.string().min(1), adminEmail: z.string().email(), password: z.string().min(10).max(200),
});

export const materialInput = z.object({
  code: z.string().min(1).max(40), nameEn: z.string().min(1).max(120), nameAr: z.string().max(120).default(''),
  category: z.enum(['cement', 'aggregate', 'sand', 'water', 'admixture', 'additive', 'fibre', 'other']).default('other'),
  purchaseUnit: unit, dosageUnit: unit, conversionFactor: posDec.nullable().default(null),
  densityKgPerM3: posDec.nullable().default(null), wastagePct: posDec.default('0'),
});
export const plantInput = z.object({ code: z.string().min(1).max(20), nameEn: z.string().min(1), nameAr: z.string().default(''), address: z.string().default('') });

const fixedCost = z.object({ key: z.string().min(1), name: z.string().min(1), nature: z.enum(['wages', 'depreciation', 'utilities', 'maintenance', 'consumables', 'other', 'delivery', 'overhead', 'pumping']), monthlyJod: posDec });
const varCost = z.object({ key: z.string().min(1), name: z.string().min(1), nature: z.enum(['wages', 'depreciation', 'utilities', 'maintenance', 'consumables', 'other', 'delivery', 'overhead', 'pumping']), jodPerM3: posDec });
export const deliveryAssumptions = z.object({
  perM3: z.object({ chargePerM3: posDec, costPerM3: posDec }).nullable().default(null),
  zones: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), chargePerM3: posDec, costPerM3: posDec })).default([]),
  trip: z.object({ truckCapacityM3: posDec, chargePerTrip: posDec, fixedCostPerTrip: posDec, costPerKm: posDec }).nullable().default(null),
});
export const pumpingAssumptions = z.object({
  chargePerM3: posDec, minCharge: posDec, minBasis: z.enum(['per_visit', 'per_pour', 'per_pump', 'per_quotation']),
  mobilizationFee: posDec, extraHourRate: posDec, costPerM3: posDec, costPerUnit: posDec,
});
export const plantCostInput = z.object({
  plantId: uuid, validFrom: isoDate, fixedCosts: z.array(fixedCost), variableCosts: z.array(varCost),
  corporateOverheadPerM3: posDec, riskProvisionPerM3: posDec, delivery: deliveryAssumptions, pumping: pumpingAssumptions.nullable().default(null), note: z.string().default(''),
});
export const forecastInput = z.object({ plantId: uuid, validFrom: isoDate, monthlyM3: posDec, source: z.string().min(2) });

export const mixInput = z.object({
  code: z.string().min(1).max(30), nameEn: z.string().min(1), nameAr: z.string().default(''), grade: z.string().min(1),
  plantIds: z.array(uuid).min(1),
  spec: z.object({
    strengthMpa: z.string().default(''), slumpMm: z.string().default(''), maxAggregateMm: z.string().default(''),
    cementType: z.string().default(''), exposure: z.string().default(''), notes: z.string().default(''),
  }).default({}),
  ingredients: z.array(z.object({ materialId: uuid, dosage: posDec })).default([]),
});
export const mixRevisionInput = z.object({ spec: mixInput.shape.spec, ingredients: mixInput.shape.ingredients, notes: z.string().default('') });

export const policyInput = z.object({
  name: z.string().min(1), mode: z.enum(['gross_margin', 'markup']), pct: posDec, minMarginPct: posDec,
  plantId: uuid.nullable().default(null), mixId: uuid.nullable().default(null), validFrom: isoDate,
});
export const taxPolicyInput = z.object({
  policyKey: z.string().min(1), name: z.string().min(1), ratePct: posDec, taxableComponents: z.array(z.enum(['concrete', 'delivery', 'pumping', 'other'])).min(1),
  deductionAmount: posDec.default('0'), deductionBasis: z.enum(['per_m3', 'per_line', 'per_document']).default('per_document'),
  nonNegativeBase: z.boolean().default(true), exemptionNote: z.string().default(''), sourceReference: z.string().default(''), validFrom: isoDate,
});
export const termsInput = z.object({ name: z.string().min(1), clauses: z.array(z.object({ title: z.string().min(1), text: z.string().min(1) })) });

export const clientInput = z.object({
  name: z.string().min(1).max(160), taxNumber: z.string().default(''), notes: z.string().default(''),
  contacts: z.array(z.object({ name: z.string(), phone: z.string().default(''), email: z.string().default('') })).default([]),
});
export const projectInput = z.object({
  clientId: uuid, name: z.string().min(1).max(160), siteAddress: z.string().default(''),
  siteContact: z.object({ name: z.string().default(''), phone: z.string().default('') }).default({}), defaultPlantId: uuid.nullable().default(null),
});

const override = z.object({ perM3: posDec, reason: z.string() });
export const quoteLineDoc = z.object({
  id: z.string().min(1), mixRevisionId: uuid, quantityM3: z.string(),
  priceOverride: override.nullable().default(null), costOverride: override.nullable().default(null),
});
export const serviceDoc = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('delivery'), method: z.enum(['per_m3', 'zone', 'trip']), zoneCode: z.string().optional(), quantityM3: z.string().optional(), roundTripKm: z.string().optional(), rateOverride: z.object({ chargePerM3: posDec, reason: z.string() }).nullable().optional() }),
  z.object({ id: z.string(), type: z.literal('pumping'), quantityM3: z.string().optional(), units: z.number().int().min(1).max(500).optional(), visitQuantities: z.array(z.string()).optional(), extraHours: z.string().optional(), rateOverride: z.object({ chargePerM3: posDec, reason: z.string() }).nullable().optional() }),
  z.object({ id: z.string(), type: z.literal('other'), label: z.string(), quantity: z.string(), unit: z.string().min(1), rate: z.string() }),
]);
export const quoteDocument = z.object({
  clientId: uuid.nullable(), projectId: uuid.nullable(), plantId: uuid.nullable(),
  scope: z.enum(['supply_only', 'supply_delivery', 'supply_delivery_pumping']).default('supply_only'),
  taxPolicyId: uuid.nullable().default(null), termsVersionId: uuid.nullable().default(null),
  validityDays: z.number().int().min(1).max(365).default(14),
  paymentTerms: z.string().max(500).default(''),
  supplySchedule: z.string().max(500).default(''),
  customerNotes: z.string().max(4000).default(''), internalNotes: z.string().max(4000).default(''),
  lines: z.array(quoteLineDoc).default([]), services: z.array(serviceDoc).default([]),
  pinnedReference: z.boolean().default(false),
});
export type QuoteDocument = z.infer<typeof quoteDocument>;

export const saveDraftInput = z.object({ baseVersion: z.number().int().min(0), doc: quoteDocument });
export const syncOperationInput = z.object({
  idempotencyKey: z.string().min(8).max(100),
  type: z.enum(['quotation.save']),
  quotationId: uuid, revNo: z.number().int().min(1).default(1), baseVersion: z.number().int().min(0),
  create: z.boolean().default(false), doc: quoteDocument,
});
export const outcomeInput = z.object({ outcome: z.enum(['accepted', 'declined', 'expired']), lostReason: z.string().max(500).optional(), competitorNote: z.string().max(500).optional() });
export const decisionInput = z.object({ comment: z.string().max(1000).default('') });
