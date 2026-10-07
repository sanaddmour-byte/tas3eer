import { D, Dec, ZERO, rnd, S } from './decimal';
import { PricingError, err } from './errors';
import type { ForecastInput, Issue, PlantCostInput, ProductionCostResult } from './types';

/** Reject duplicate or double-included cost items across ALL categories of a plant cost version. */
export function validatePlantCost(pc: PlantCostInput): Issue[] {
  const issues: Issue[] = [];
  const names = new Map<string, string>();
  const uniqueNatures = new Set(['wages', 'depreciation', 'utilities', 'maintenance']);
  const natures = new Map<string, string>();
  const check = (cat: string, name: string, nature: string, key: string) => {
    const n = name.trim().toLowerCase();
    if (names.has(n)) issues.push(err('cost_duplicate', `"${name}" appears in both ${names.get(n)} and ${cat}; remove one to avoid double counting.`, key));
    names.set(n, cat);
    if (uniqueNatures.has(nature)) {
      if (natures.has(nature)) issues.push(err('cost_nature_duplicate', `${nature} is already included under ${natures.get(nature)}; including it again under ${cat} would double count it.`, key));
      natures.set(nature, cat);
    }
    if (cat.startsWith('production') && (nature === 'delivery' || nature === 'overhead' || nature === 'pumping')) {
      issues.push(err('cost_misplaced', `${name} is a ${nature} cost and must not be included in production costs.`, key));
    }
  };
  for (const f of pc.fixedCosts) {
    check('production fixed costs', f.name, f.nature, f.key);
    try { if (D(f.monthlyJod).lt(0)) issues.push(err('cost_negative', `${f.name} cannot be negative.`, f.key)); }
    catch { issues.push(err('cost_invalid', `${f.name} amount is invalid.`, f.key)); }
  }
  for (const v of pc.variableCosts) {
    check('production variable costs', v.name, v.nature, v.key);
    try { if (D(v.jodPerM3).lt(0)) issues.push(err('cost_negative', `${v.name} cannot be negative.`, v.key)); }
    catch { issues.push(err('cost_invalid', `${v.name} amount is invalid.`, v.key)); }
  }
  return issues;
}

export function allocateFixed(monthlyFixed: Dec, forecast: ForecastInput | null, internalDp: number): Dec {
  if (!forecast) throw new PricingError([err('forecast_missing', 'Enter a monthly forecast volume to allocate fixed costs.')]);
  let vol: Dec;
  try { vol = D(forecast.monthlyM3, 'forecast volume'); } catch { throw new PricingError([err('forecast_invalid', 'Forecast volume is not a valid number.')]); }
  if (vol.lte(0)) throw new PricingError([err('forecast_nonpositive', 'Forecast volume must be greater than zero to allocate fixed costs.')]);
  return rnd(monthlyFixed.div(vol), internalDp);
}

export function productionCost(pc: PlantCostInput, forecast: ForecastInput | null, internalDp: number): ProductionCostResult {
  const dupIssues = validatePlantCost(pc).filter((i) => i.severity === 'error');
  if (dupIssues.length) throw new PricingError(dupIssues);
  const fixedMonthly = pc.fixedCosts.reduce((s, f) => s.plus(D(f.monthlyJod, f.name)), ZERO);
  const alloc = allocateFixed(fixedMonthly, forecast, internalDp);
  const vol = D(forecast!.monthlyM3);
  const fixedLines = pc.fixedCosts.map((f) => ({
    key: f.key, name: f.name, monthlyJod: D(f.monthlyJod).toString(), perM3: S(D(f.monthlyJod).div(vol), internalDp),
  }));
  const varTotal = pc.variableCosts.reduce((s, v) => s.plus(D(v.jodPerM3, v.name)), ZERO);
  const overhead = D(pc.corporateOverheadPerM3, 'corporate overhead');
  const provision = D(pc.riskProvisionPerM3, 'risk provision');
  if (overhead.lt(0) || provision.lt(0)) throw new PricingError([err('cost_negative', 'Overhead and provision cannot be negative.')]);
  const total = varTotal.plus(alloc).plus(overhead).plus(provision);
  return {
    variableLines: pc.variableCosts.map((v) => ({ key: v.key, name: v.name, jodPerM3: D(v.jodPerM3).toString() })),
    variableTotal: S(varTotal, internalDp),
    fixedLines, fixedMonthlyTotal: fixedMonthly.toString(), fixedAllocatedPerM3: S(alloc, internalDp),
    forecast: { monthlyM3: vol.toString(), versionId: forecast!.versionId, validFrom: forecast!.validFrom, validTo: forecast!.validTo ?? null, source: forecast!.source },
    corporateOverheadPerM3: S(overhead, internalDp), riskProvisionPerM3: S(provision, internalDp),
    total: S(total, internalDp),
  };
}

/** Exploratory only: allocated fixed cost per m3 for alternative monthly volumes. Never mutates published data. */
export function fixedCostSensitivity(fixedMonthly: string, volumes: string[], internalDp = 4) {
  const f = D(fixedMonthly);
  return volumes.map((v) => {
    const vol = D(v);
    if (vol.lte(0)) return { monthlyM3: v, allocatedPerM3: null as string | null, error: 'Volume must be greater than zero' };
    return { monthlyM3: v, allocatedPerM3: S(f.div(vol), internalDp), error: null as string | null };
  });
}
