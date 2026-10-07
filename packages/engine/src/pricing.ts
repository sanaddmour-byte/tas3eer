import { D, Dec, ZERO, ONE, HUNDRED, rnd, S } from './decimal';
import { PricingError, err } from './errors';
import type { PricingMode } from './types';

export function validatePct(mode: PricingMode, pctStr: string): Dec {
  const pct = D(pctStr, 'percentage');
  if (mode === 'gross_margin') {
    if (pct.lt(0) || pct.gte(100)) throw new PricingError([err('margin_range', 'Gross margin must be at least 0% and below 100%.')]);
  } else if (pct.lt(0) || pct.gt(1000)) {
    throw new PricingError([err('markup_range', 'Markup must be between 0% and 1000%.')]);
  }
  return pct;
}

/** gross margin: price = cost / (1 - m); markup: price = cost * (1 + k) */
export function proposedPrice(cost: Dec, mode: PricingMode, pctStr: string, dp: number): Dec {
  const pct = validatePct(mode, pctStr);
  if (cost.lt(0)) throw new PricingError([err('cost_negative', 'Cost cannot be negative.')]);
  const raw = mode === 'gross_margin' ? cost.div(ONE.minus(pct.div(HUNDRED))) : cost.mul(ONE.plus(pct.div(HUNDRED)));
  return rnd(raw, dp);
}

/** Actual margin on the final pre-tax selling price: (price - cost) / price, in percent. */
export function actualMarginPct(price: Dec, cost: Dec): Dec | null {
  if (price.lte(0)) return null;
  return price.minus(cost).div(price).mul(HUNDRED);
}
export function actualMarkupPct(price: Dec, cost: Dec): Dec | null {
  if (cost.lte(0)) return null;
  return price.minus(cost).div(cost).mul(HUNDRED);
}
export { ZERO };
