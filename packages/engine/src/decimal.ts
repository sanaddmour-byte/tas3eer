import Decimal from 'decimal.js';

// Isolated constructor so the engine never mutates global Decimal config used elsewhere.
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;
export type DecInput = string | number | Dec;

export const ZERO = new Dec(0);
export const ONE = new Dec(1);
export const HUNDRED = new Dec(100);

export function D(v: DecInput | null | undefined, field = 'value'): Dec {
  if (v === null || v === undefined || v === '') throw new Error(`${field} is missing`);
  try {
    const d = new Dec(v as any);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new Error(`${field} is not a valid number`);
  }
}

/** Round half-up to `dp` decimal places and return Decimal. */
export function rnd(v: Dec, dp: number): Dec {
  return v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Fixed-scale decimal string (JSON-safe monetary representation). */
export function S(v: Dec, dp: number): string {
  return rnd(v, dp).toFixed(dp);
}

export function isDecimalString(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim());
}
