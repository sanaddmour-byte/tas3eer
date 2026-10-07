import { D, Dec, ZERO, HUNDRED, ONE, rnd, S } from './decimal';
import { PricingError, err } from './errors';
import { dosageUnitsPerPurchaseUnit } from './units';
import type { IngredientInput, Issue, MaterialCostLine, MaterialCostResult, MaterialInput, PriceInput } from './types';

/**
 * Cost per m3 of concrete from ingredients.
 * cost = dosage / (dosage units per purchase unit) * effective price per purchase unit * (1 + wastage)
 * Missing prices, units, densities are collected and thrown together (never treated as zero).
 */
export function materialCostBreakdown(
  ingredients: IngredientInput[],
  materials: MaterialInput[],
  prices: PriceInput[],
  internalDp: number,
): MaterialCostResult {
  const issues: Issue[] = [];
  const lines: MaterialCostLine[] = [];
  let total = ZERO;
  const seen = new Set<string>();
  if (ingredients.length === 0) {
    throw new PricingError([err('mix_empty', 'The mix has no ingredients.')]);
  }
  for (const ing of ingredients) {
    const mat = materials.find((m) => m.id === ing.materialId);
    if (!mat) { issues.push(err('material_unknown', `Unknown material ${ing.materialId}.`)); continue; }
    const path = `materials[${mat.name}]`;
    if (seen.has(mat.id)) { issues.push(err('ingredient_duplicate', `${mat.name} appears more than once in the mix.`, path)); continue; }
    seen.add(mat.id);
    try {
      const dosage = D(ing.dosage, `dosage of ${mat.name}`);
      if (dosage.lte(0)) throw new PricingError([err('dosage_invalid', `Dosage of ${mat.name} must be greater than zero.`, path)]);
      const factor = dosageUnitsPerPurchaseUnit(mat);
      const p = prices.find((x) => x.materialId === mat.id);
      if (!p || p.price === null || p.price === undefined || p.price === '') {
        throw new PricingError([err('price_missing', `${mat.name} price is missing for this plant.`, path)]);
      }
      const base = D(p.price, `price of ${mat.name}`);
      if (base.lt(0)) throw new PricingError([err('price_negative', `${mat.name} price cannot be negative.`, path)]);
      let freight = ZERO;
      if (p.basis === 'ex_source') {
        if (p.freightPerPurchaseUnit === null || p.freightPerPurchaseUnit === undefined || p.freightPerPurchaseUnit === '') {
          throw new PricingError([err('freight_missing', `${mat.name} price is ex-source; procurement freight is required (enter 0 if none).`, path)]);
        }
        freight = D(p.freightPerPurchaseUnit, `freight of ${mat.name}`);
        if (freight.lt(0)) throw new PricingError([err('freight_negative', `Freight for ${mat.name} cannot be negative.`, path)]);
      }
      const wastage = D(mat.wastagePct, `wastage of ${mat.name}`);
      if (wastage.lt(0) || wastage.gt(HUNDRED)) throw new PricingError([err('wastage_invalid', `Wastage for ${mat.name} must be between 0 and 100%.`, path)]);
      const eff = base.plus(freight);
      const cost = rnd(dosage.div(factor).mul(eff).mul(ONE.plus(wastage.div(HUNDRED))), internalDp);
      total = total.plus(cost);
      lines.push({
        materialId: mat.id, name: mat.name, dosage: dosage.toString(), dosageUnit: mat.dosageUnit,
        purchaseUnit: mat.purchaseUnit, dosageUnitsPerPurchaseUnit: factor.toString(),
        basePrice: base.toString(), freight: freight.toString(), effectivePricePerPurchaseUnit: eff.toString(),
        wastagePct: wastage.toString(), costPerM3: S(cost, internalDp),
        priceVersionId: p.versionId, priceEffectiveFrom: p.effectiveFrom,
        formula: `${dosage} ${mat.dosageUnit}/m³ ÷ ${factor} ${mat.dosageUnit}/${mat.purchaseUnit} × ${eff} JOD/${mat.purchaseUnit}` +
          (wastage.gt(0) ? ` × (1 + ${wastage}% wastage)` : '') + ` = ${S(cost, internalDp)} JOD/m³`,
      });
    } catch (e) {
      if (e instanceof PricingError) issues.push(...e.issues);
      else issues.push(err('material_invalid', `${mat.name}: ${(e as Error).message}`, path));
    }
  }
  if (issues.length) throw new PricingError(issues);
  return { lines, total: S(total, internalDp) };
}
