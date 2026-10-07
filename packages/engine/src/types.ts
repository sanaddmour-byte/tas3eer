export const ENGINE_VERSION = 'engine-1.0.0';

export type Unit = 'kg' | 'tonne' | 'L' | 'm3' | 'bag' | 'drum';
export type PriceBasis = 'ex_source' | 'delivered_plant';
export type PricingMode = 'gross_margin' | 'markup';
export type SupplyScope = 'supply_only' | 'supply_delivery' | 'supply_delivery_pumping';
export type MinBasis = 'per_visit' | 'per_pour' | 'per_pump' | 'per_quotation';
export type DeductionBasis = 'per_m3' | 'per_line' | 'per_document';
export type TaxComponent = 'concrete' | 'delivery' | 'pumping' | 'other';

export interface RoundingPolicy {
  moneyDp: number; // customer-facing JOD amounts (3)
  internalDp: number; // internal unit rates (default 4, up to 6)
  priceDp: number; // customer unit rate (3)
}
export const DEFAULT_ROUNDING: RoundingPolicy = { moneyDp: 3, internalDp: 4, priceDp: 3 };

export type Severity = 'error' | 'warning';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  path?: string; // e.g. lines[l1].materials[cement]
  /** Internal-only numeric detail; stripped for users without cost visibility. */
  detail?: Record<string, string>;
}

export interface MaterialInput {
  id: string;
  name: string;
  purchaseUnit: Unit;
  dosageUnit: Unit;
  /** dosage units per ONE purchase unit; required for bag/drum, optional override otherwise */
  conversionFactor?: string | null;
  /** kg per m3; required when converting between mass and volume */
  densityKgPerM3?: string | null;
  /** Percent wastage added to quantity consumed (explicit; 0 allowed) */
  wastagePct: string;
}
export interface PriceInput {
  materialId: string;
  versionId: string;
  price: string | null; // per purchase unit
  basis: PriceBasis;
  freightPerPurchaseUnit?: string | null; // required (may be "0") when basis = ex_source
  effectiveFrom: string;
}
export interface IngredientInput {
  materialId: string;
  dosage: string; // per m3 of concrete, in material.dosageUnit
}

export interface MaterialCostLine {
  materialId: string;
  name: string;
  dosage: string;
  dosageUnit: Unit;
  purchaseUnit: Unit;
  dosageUnitsPerPurchaseUnit: string;
  basePrice: string;
  freight: string;
  effectivePricePerPurchaseUnit: string;
  wastagePct: string;
  costPerM3: string;
  priceVersionId: string;
  priceEffectiveFrom: string;
  formula: string;
}
export interface MaterialCostResult {
  lines: MaterialCostLine[];
  total: string;
}

export interface CostItem {
  key: string;
  name: string;
  /** What the cost represents; used to detect double inclusion. */
  nature: 'wages' | 'depreciation' | 'utilities' | 'maintenance' | 'consumables' | 'other' | 'delivery' | 'overhead' | 'pumping';
}
export interface FixedCostItem extends CostItem { monthlyJod: string }
export interface VariableCostItem extends CostItem { jodPerM3: string }

export interface ForecastInput {
  versionId: string;
  monthlyM3: string;
  validFrom: string;
  validTo?: string | null;
  source: string;
}
export interface DeliveryZone { code: string; name: string; chargePerM3: string; costPerM3: string }
export interface DeliveryAssumptions {
  perM3?: { chargePerM3: string; costPerM3: string } | null;
  zones?: DeliveryZone[];
  trip?: {
    truckCapacityM3: string;
    chargePerTrip: string;
    fixedCostPerTrip: string;
    costPerKm: string;
  } | null;
}
export interface PumpingAssumptions {
  chargePerM3: string;
  minCharge: string;
  minBasis: MinBasis;
  mobilizationFee: string;
  /** mobilization applies per visit/pour/pump per minBasis; per_quotation => once */
  extraHourRate: string;
  costPerM3: string;
  costPerUnit: string; // estimated operating cost per visit/pour/pump
}
export interface PlantCostInput {
  versionId: string;
  fixedCosts: FixedCostItem[];
  variableCosts: VariableCostItem[];
  corporateOverheadPerM3: string;
  riskProvisionPerM3: string;
  delivery: DeliveryAssumptions;
  pumping: PumpingAssumptions | null;
}

export interface ProductionCostResult {
  variableLines: { key: string; name: string; jodPerM3: string }[];
  variableTotal: string;
  fixedLines: { key: string; name: string; monthlyJod: string; perM3: string }[];
  fixedMonthlyTotal: string;
  fixedAllocatedPerM3: string;
  forecast: { monthlyM3: string; versionId: string; validFrom: string; validTo: string | null; source: string };
  corporateOverheadPerM3: string;
  riskProvisionPerM3: string;
  total: string; // variable + fixed allocated + overhead + provision
}

export interface PricingPolicyInput {
  id: string;
  version: number;
  mode: PricingMode;
  /** gross margin % or markup % depending on mode */
  pct: string;
  /** below this actual margin % approval is required */
  minMarginPct: string;
}

export interface TaxPolicyInput {
  id: string;
  name: string;
  status: 'draft' | 'demo' | 'verified' | 'retired';
  ratePct: string;
  taxableComponents: TaxComponent[];
  deductionAmount: string;
  deductionBasis: DeductionBasis;
  nonNegativeBase: boolean;
  exempt?: boolean;
  version?: number;
}

export type DeliveryServiceInput = {
  id: string;
  type: 'delivery';
  method: 'per_m3' | 'zone' | 'trip';
  zoneCode?: string;
  quantityM3?: string;
  roundTripKm?: string;
  rateOverride?: { chargePerM3: string; reason: string } | null;
};
export type PumpingServiceInput = {
  id: string;
  type: 'pumping';
  quantityM3?: string;
  /** visits / pours / pumps depending on the policy minBasis. Ignored for per_quotation. */
  units?: number;
  visitQuantities?: string[];
  extraHours?: string;
  rateOverride?: { chargePerM3: string; reason: string } | null;
};
export type OtherServiceInput = {
  id: string;
  type: 'other';
  label: string;
  quantity: string;
  unit: string;
  rate: string;
};
export type ServiceInput = DeliveryServiceInput | PumpingServiceInput | OtherServiceInput;

export interface QuoteLineInput {
  id: string;
  mixRevisionId: string;
  mixCode: string;
  mixName: string;
  quantityM3: string;
  ingredients: IngredientInput[];
  policy: PricingPolicyInput | null;
  costOverride?: { perM3: string; reason: string } | null;
  priceOverride?: { perM3: string; reason: string } | null;
}

export interface QuoteInput {
  asOf: string; // ISO date
  scope: SupplyScope;
  rounding?: Partial<RoundingPolicy>;
  staleAfterDays?: number;
  materials: MaterialInput[];
  prices: PriceInput[];
  plantCost: PlantCostInput | null;
  forecast: ForecastInput | null;
  lines: QuoteLineInput[];
  services: ServiceInput[];
  tax: TaxPolicyInput | null;
}

export interface ApprovalReason { code: string; message: string; detail?: Record<string, string> }

export interface ServiceResult {
  id: string;
  type: 'delivery' | 'pumping' | 'other';
  component: TaxComponent;
  rows: { key: string; label: string; quantity: string; unit: string; rate: string; amount: string }[];
  amount: string;
  /** internal estimate */
  estimatedCost: string | null;
}
export interface LineResult {
  id: string;
  mixRevisionId: string;
  mixCode: string;
  mixName: string;
  quantityM3: string;
  customerRatePerM3: string | null;
  amount: string | null;
  calculable: boolean;
  internal: {
    materials: MaterialCostResult | null;
    production: ProductionCostResult | null;
    fullCostPerM3: string | null;
    costUsedPerM3: string | null;
    costOverridden: boolean;
    proposedPricePerM3: string | null;
    priceOverridden: boolean;
    pricingMode: PricingMode;
    pricingPct: string;
    marginPct: string | null;
    markupPct: string | null;
    contributionBeforeFixedPerM3: string | null;
    totalCost: string | null;
    contributionBeforeFixed: string | null;
    marginAfterFull: string | null;
  };
}
export interface TaxResult {
  policyId: string;
  policyName: string;
  policyStatus: string;
  ratePct: string;
  taxableComponents: TaxComponent[];
  componentAmounts: Record<TaxComponent, string>;
  taxableBeforeDeduction: string;
  deduction: string;
  deductionBasis: DeductionBasis;
  taxableBase: string;
  tax: string;
}
export interface QuoteResult {
  engineVersion: string;
  rounding: RoundingPolicy;
  lines: LineResult[];
  services: ServiceResult[];
  customer: {
    totalVolumeM3: string;
    concreteSubtotal: string;
    deliveryTotal: string;
    pumpingTotal: string;
    otherTotal: string;
    subtotalExTax: string;
    tax: TaxResult | null;
    taxAmount: string | null;
    total: string | null;
  };
  internal: {
    revenueExTax: string;
    totalConfiguredCost: string | null;
    serviceEstimatedCost: string;
    contributionBeforeFixed: string | null;
    contributionBeforeFixedPct: string | null;
    marginAfterFullCost: string | null;
    marginAfterFullCostPct: string | null;
  };
  issues: Issue[];
  approvals: ApprovalReason[];
  versions: {
    engine: string;
    policyIds: string[];
    taxPolicyId: string | null;
    priceVersionIds: string[];
    plantCostVersionId: string | null;
    forecastVersionId: string | null;
  };
}
