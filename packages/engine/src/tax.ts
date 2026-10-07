import { D, Dec, ZERO, ONE, HUNDRED, rnd, S } from './decimal';
import { PricingError, err } from './errors';
import type { TaxComponent, TaxPolicyInput, TaxResult } from './types';

export interface TaxDocument {
  componentAmounts: Record<TaxComponent, Dec>;
  totalConcreteM3: Dec;
  /** Logical lines: lines sharing mix revision AND rate are merged so splitting a line cannot change tax. */
  logicalLineCount: number;
}

export function computeTax(policy: TaxPolicyInput, doc: TaxDocument, moneyDp: number): TaxResult {
  const rate = D(policy.ratePct, 'tax rate');
  if (rate.lt(0) || rate.gt(100)) throw new PricingError([err('tax_rate_range', 'Tax rate must be between 0% and 100%.')]);
  const ded = D(policy.deductionAmount, 'deduction');
  if (ded.lt(0)) throw new PricingError([err('tax_deduction_negative', 'Tax deduction cannot be negative.')]);
  let before = ZERO;
  for (const c of policy.taxableComponents) before = before.plus(doc.componentAmounts[c] ?? ZERO);
  let deduction = ZERO;
  if (ded.gt(0)) {
    deduction = policy.deductionBasis === 'per_m3' ? ded.mul(doc.totalConcreteM3)
      : policy.deductionBasis === 'per_line' ? ded.mul(doc.logicalLineCount) : ded;
  }
  let base = before.minus(deduction);
  if (base.lt(0) && policy.nonNegativeBase) base = ZERO;
  const exempt = !!policy.exempt;
  const tax = exempt ? ZERO : rnd(base.mul(rate).div(HUNDRED), moneyDp);
  const comp = {} as Record<TaxComponent, string>;
  (['concrete', 'delivery', 'pumping', 'other'] as TaxComponent[]).forEach((c) => (comp[c] = S(doc.componentAmounts[c] ?? ZERO, moneyDp)));
  return {
    policyId: policy.id, policyName: policy.name, policyStatus: policy.status, ratePct: rate.toString(),
    taxableComponents: policy.taxableComponents, componentAmounts: comp,
    taxableBeforeDeduction: S(before, moneyDp), deduction: S(deduction, moneyDp), deductionBasis: policy.deductionBasis,
    taxableBase: S(exempt ? ZERO : base, moneyDp), tax: S(tax, moneyDp),
  };
}

/**
 * Inverse: given a desired tax-inclusive document total, solve the concrete-line amount so that
 * subtotal + tax = target. Only unambiguous when exactly one concrete logical line exists and concrete is taxable.
 * Returns the required pre-tax concrete amount (unrounded Decimal) — caller derives the unit rate.
 */
export function inverseConcreteAmount(
  policy: TaxPolicyInput,
  targetInclusive: Dec,
  otherAmounts: Record<Exclude<TaxComponent, 'concrete'>, Dec>,
  totalConcreteM3: Dec,
  concreteLogicalLines: number,
): Dec {
  if (concreteLogicalLines !== 1) throw new PricingError([err('inversion_ambiguous', 'Tax-inclusive entry needs exactly one concrete line; with several lines the split is ambiguous.')]);
  if (!policy.taxableComponents.includes('concrete')) throw new PricingError([err('inversion_unsupported', 'Concrete is not taxable under this policy; tax-inclusive entry is not supported.')]);
  if (policy.exempt) return targetInclusive.minus(Object.values(otherAmounts).reduce((a, b) => a.plus(b), ZERO));
  if (!policy.nonNegativeBase && !D(policy.deductionAmount).eq(0)) {
    // still linear — fine
  }
  const r = D(policy.ratePct).div(HUNDRED);
  const ded = D(policy.deductionAmount);
  const deduction = ded.eq(0) ? ZERO : policy.deductionBasis === 'per_m3' ? ded.mul(totalConcreteM3) : policy.deductionBasis === 'per_line' ? ded.mul(concreteLogicalLines) : ded;
  const taxableOthers = policy.taxableComponents.filter((c) => c !== 'concrete').reduce((s, c) => s.plus(otherAmounts[c as Exclude<TaxComponent, 'concrete'>] ?? ZERO), ZERO);
  const allOthers = Object.values(otherAmounts).reduce((a, b) => a.plus(b), ZERO);
  // total = C + allOthers + max(0, C + taxableOthers - deduction) * r
  // Branch 1: base > 0 => C = (T - allOthers + (deduction - taxableOthers) r) / (1 + r)
  const c1 = targetInclusive.minus(allOthers).plus(deduction.minus(taxableOthers).mul(r)).div(ONE.plus(r));
  if (c1.plus(taxableOthers).minus(deduction).gt(0) || !policy.nonNegativeBase) return c1;
  // Branch 2: base <= 0 clamped => no tax
  return targetInclusive.minus(allOthers);
}
