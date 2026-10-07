import { Dec, D, ONE } from './decimal';
import type { MaterialInput, Unit } from './types';
import { PricingError, err } from './errors';

type Dim = 'mass' | 'volume' | 'count';
const UNITS: Record<Unit, { dim: Dim; toBase: string }> = {
  kg: { dim: 'mass', toBase: '1' }, // base: kg
  tonne: { dim: 'mass', toBase: '1000' },
  L: { dim: 'volume', toBase: '0.001' }, // base: m3
  m3: { dim: 'volume', toBase: '1' },
  bag: { dim: 'count', toBase: '1' },
  drum: { dim: 'count', toBase: '1' },
};
export const UNIT_LIST = Object.keys(UNITS) as Unit[];
export const isUnit = (u: string): u is Unit => u in UNITS;

/**
 * Dosage units obtained from ONE purchase unit of the material.
 * e.g. purchase tonne, dosage kg => 1000. Purchase L, dosage kg with density 1100 kg/m3 => 1.1.
 * Throws PricingError for incompatible units, missing density or invalid factors.
 */
export function dosageUnitsPerPurchaseUnit(m: MaterialInput): Dec {
  const path = `materials[${m.name}]`;
  if (!isUnit(m.purchaseUnit) || !isUnit(m.dosageUnit)) {
    throw new PricingError([err('unit_unknown', `Unknown unit for ${m.name}.`, path)]);
  }
  if (m.conversionFactor !== null && m.conversionFactor !== undefined && m.conversionFactor !== '') {
    const f = D(m.conversionFactor, 'conversion factor');
    if (f.lte(0)) throw new PricingError([err('conversion_invalid', `Conversion factor for ${m.name} must be greater than zero.`, path)]);
    return f;
  }
  const from = UNITS[m.purchaseUnit];
  const to = UNITS[m.dosageUnit];
  if (m.purchaseUnit === m.dosageUnit) return ONE;
  if (from.dim === 'count' || to.dim === 'count') {
    throw new PricingError([err('conversion_required', `${m.name}: a conversion factor is required between ${m.purchaseUnit} and ${m.dosageUnit}.`, path)]);
  }
  if (from.dim === to.dim) return D(from.toBase).div(D(to.toBase));
  // mass <-> volume
  if (m.densityKgPerM3 === null || m.densityKgPerM3 === undefined || m.densityKgPerM3 === '') {
    throw new PricingError([err('density_missing', `Density (kg/m³) is required for ${m.name} to convert ${m.purchaseUnit} to ${m.dosageUnit}.`, path)]);
  }
  const dens = D(m.densityKgPerM3, 'density');
  if (dens.lte(0)) throw new PricingError([err('density_invalid', `Density for ${m.name} must be greater than zero.`, path)]);
  // base amounts: mass in kg, volume in m3
  const fromBase = D(from.toBase);
  const toBase = D(to.toBase);
  if (from.dim === 'mass') {
    // 1 purchase unit = fromBase kg = fromBase/dens m3 = (fromBase/dens)/toBase dosage units
    return fromBase.div(dens).div(toBase);
  }
  // volume -> mass: 1 purchase = fromBase m3 = fromBase*dens kg
  return fromBase.mul(dens).div(toBase);
}
