import { D, Dec, ZERO, HUNDRED, rnd, S } from './decimal';
import { PricingError, err, warn } from './errors';
import { materialCostBreakdown } from './materials';
import { productionCost } from './plant';
import { actualMarginPct, actualMarkupPct, proposedPrice } from './pricing';
import { deliveryService, otherService, pumpingService } from './services';
import { computeTax, inverseConcreteAmount } from './tax';
import {
  DEFAULT_ROUNDING, ENGINE_VERSION, type ApprovalReason, type Issue, type LineResult, type QuoteInput, type QuoteResult,
  type RoundingPolicy, type ServiceResult, type TaxComponent,
} from './types';

export function resolveRounding(p?: Partial<RoundingPolicy>): RoundingPolicy {
  const r = { ...DEFAULT_ROUNDING, ...(p ?? {}) };
  if (r.internalDp < 3 || r.internalDp > 6) throw new Error('internalDp must be between 3 and 6');
  if (r.moneyDp !== 3) throw new Error('moneyDp must be 3 (JOD)');
  return r;
}

const dayDiff = (a: string, b: string) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);

export function priceQuotation(input: QuoteInput): QuoteResult {
  const rounding = resolveRounding(input.rounding);
  const { moneyDp: mdp, internalDp: idp, priceDp: pdp } = rounding;
  const issues: Issue[] = [];
  const approvals: ApprovalReason[] = [];
  const lineResults: LineResult[] = [];
  const serviceResults: ServiceResult[] = [];

  if (input.lines.length === 0) issues.push(err('lines_empty', 'Add at least one concrete line.'));

  // scope validation (prevents delivery/pumping being added when not in scope, or twice)
  const delRows = input.services.filter((s) => s.type === 'delivery');
  const pumpRows = input.services.filter((s) => s.type === 'pumping');
  if (input.scope === 'supply_only' && (delRows.length || pumpRows.length)) issues.push(err('scope_conflict', 'Supply-only quotations cannot include delivery or pumping charges.', 'services'));
  if (input.scope === 'supply_delivery' && pumpRows.length) issues.push(err('scope_conflict', 'Pumping charges require the "supply, delivery and pumping" scope.', 'services'));
  if (input.scope !== 'supply_only' && delRows.length === 0) issues.push(err('delivery_missing', 'Add a delivery service for a delivered quotation.', 'services'));
  if (input.scope === 'supply_delivery_pumping' && pumpRows.length === 0) issues.push(err('pumping_missing', 'Add a pumping service for this scope.', 'services'));
  if (delRows.length > 1) issues.push(err('delivery_duplicate', 'Only one delivery charge is allowed per quotation; adjust trips or zones instead of adding it twice.', 'services'));
  if (pumpRows.length > 1) issues.push(err('pumping_duplicate', 'Only one pumping charge is allowed per quotation; use the number of visits for several pours.', 'services'));
  const seenOther = new Set<string>();
  for (const s of input.services) if (s.type === 'other') {
    const k = `${s.label.trim().toLowerCase()}|${s.unit}`;
    if (seenOther.has(k)) issues.push(err('service_duplicate', `Service "${s.label}" is listed twice.`, `services[${s.id}]`));
    seenOther.add(k);
  }

  // shared production cost
  let production: ReturnType<typeof productionCost> | null = null;
  if (!input.plantCost) issues.push(err('plant_cost_missing', 'No approved plant cost version is effective for this plant and date.', 'plantCost'));
  else try { production = productionCost(input.plantCost, input.forecast, idp); }
  catch (e) { issues.push(...(e instanceof PricingError ? e.issues : [err('production_invalid', (e as Error).message)])); }

  let totalM3 = ZERO;
  let concreteSubtotal = ZERO;
  let totalCost: Dec | null = ZERO;
  let totalVariable: Dec | null = ZERO; // materials + variable production (before fixed allocation)
  const priceVersionIds = new Set<string>();
  const logical = new Map<string, true>();
  const seenLineIds = new Set<string>();

  for (const l of input.lines) {
    const base: LineResult = {
      id: l.id, mixRevisionId: l.mixRevisionId, mixCode: l.mixCode, mixName: l.mixName, quantityM3: l.quantityM3,
      customerRatePerM3: null, amount: null, calculable: false,
      internal: { materials: null, production, fullCostPerM3: null, costUsedPerM3: null, costOverridden: false, proposedPricePerM3: null, priceOverridden: false, pricingMode: l.policy?.mode ?? 'gross_margin', pricingPct: l.policy?.pct ?? '', marginPct: null, markupPct: null, contributionBeforeFixedPerM3: null, totalCost: null, contributionBeforeFixed: null, marginAfterFull: null },
    };
    lineResults.push(base);
    const lp = `lines[${l.id}]`;
    if (seenLineIds.has(l.id)) { issues.push(err('line_duplicate_id', 'Duplicate line id.', lp)); continue; }
    seenLineIds.add(l.id);
    let qty: Dec;
    try {
      qty = D(l.quantityM3, 'quantity');
      if (qty.lte(0)) throw new Error('Quantity must be greater than zero.');
      if (qty.gt(100000)) throw new Error('Quantity exceeds the supported maximum (100,000 m³).');
      if (qty.decimalPlaces() > 3) throw new Error('Quantity supports at most 3 decimal places.');
    } catch (e) {
      issues.push(err('quantity_invalid', `${l.mixCode}: enter a valid quantity in m³. ${(e as Error).message.replace(/ is missing$/, '')}`.trim(), `${lp}.quantity`));
      totalCost = null; totalVariable = null; continue;
    }
    totalM3 = totalM3.plus(qty);
    try {
      if (!l.policy) throw new PricingError([err('policy_missing', `No commercial pricing policy applies to ${l.mixCode} at this plant and date.`, lp)]);
      const mats = materialCostBreakdown(l.ingredients, input.materials, input.prices, idp);
      mats.lines.forEach((m) => priceVersionIds.add(m.priceVersionId));
      base.internal.materials = mats;
      if (!production) throw new PricingError([]); // production issues already reported
      const full = D(mats.total).plus(D(production.total));
      base.internal.fullCostPerM3 = S(full, idp);
      let cost = full;
      if (l.costOverride) {
        if (!l.costOverride.reason?.trim()) issues.push(err('cost_override_reason', `${l.mixCode}: a reason is required for a cost override.`, `${lp}.costOverride`));
        cost = D(l.costOverride.perM3, 'cost override');
        if (cost.lt(0)) throw new PricingError([err('cost_negative', 'Cost override cannot be negative.', `${lp}.costOverride`)]);
        base.internal.costOverridden = true;
        approvals.push({ code: 'cost_override', message: `Cost override on ${l.mixCode}`, detail: { reason: l.costOverride.reason ?? '', computed: S(full, idp), override: S(cost, idp) } });
      }
      base.internal.costUsedPerM3 = S(cost, idp);
      const proposed = proposedPrice(cost, l.policy.mode, l.policy.pct, pdp);
      base.internal.proposedPricePerM3 = S(proposed, pdp);
      let rate = proposed;
      if (l.priceOverride) {
        if (!l.priceOverride.reason?.trim()) issues.push(err('price_override_reason', `${l.mixCode}: a reason is required for a price override.`, `${lp}.priceOverride`));
        rate = rnd(D(l.priceOverride.perM3, 'price override'), pdp);
        if (rate.lte(0)) throw new PricingError([err('price_invalid', 'Price override must be greater than zero.', `${lp}.priceOverride`)]);
        base.internal.priceOverridden = true;
        approvals.push({ code: 'price_override', message: `Price override on ${l.mixCode}`, detail: { reason: l.priceOverride.reason ?? '', proposed: S(proposed, pdp), override: S(rate, pdp) } });
      }
      const amount = rnd(qty.mul(rate), mdp);
      base.customerRatePerM3 = S(rate, pdp);
      base.amount = S(amount, mdp);
      base.calculable = true;
      concreteSubtotal = concreteSubtotal.plus(amount);
      const margin = actualMarginPct(rate, cost);
      base.internal.marginPct = margin ? S(margin, 3) : null;
      const mk = actualMarkupPct(rate, cost);
      base.internal.markupPct = mk ? S(mk, 3) : null;
      const lineCost = rnd(qty.mul(cost), mdp);
      const variablePerM3 = D(mats.total).plus(D(production.variableTotal));
      base.internal.contributionBeforeFixedPerM3 = S(rate.minus(variablePerM3), idp);
      base.internal.totalCost = S(lineCost, mdp);
      base.internal.contributionBeforeFixed = S(amount.minus(rnd(qty.mul(variablePerM3), mdp)), mdp);
      base.internal.marginAfterFull = S(amount.minus(lineCost), mdp);
      if (totalCost) totalCost = totalCost.plus(lineCost);
      if (totalVariable) totalVariable = totalVariable.plus(rnd(qty.mul(variablePerM3), mdp));
      logical.set(`${l.mixRevisionId}|${rate.toString()}`, true);
      const minMargin = D(l.policy.minMarginPct);
      if (margin && margin.lt(minMargin)) {
        approvals.push({ code: 'below_margin_threshold', message: `Margin on ${l.mixCode} is below the approved threshold`, detail: { marginPct: S(margin, 3), thresholdPct: minMargin.toString() } });
      }
      if (rate.lt(cost)) {
        issues.push(warn('below_cost', `${l.mixCode} is priced below its full configured cost.`, lp, { cost: S(cost, idp), price: S(rate, pdp) }));
        approvals.push({ code: 'below_cost', message: `${l.mixCode} is priced below full configured cost`, detail: { cost: S(cost, idp), price: S(rate, pdp) } });
      }
      // stale price warnings
      if (input.staleAfterDays) {
        for (const ml of mats.lines) {
          const age = dayDiff(input.asOf, ml.priceEffectiveFrom);
          if (age > input.staleAfterDays) issues.push(warn('price_stale', `${ml.name} price is ${age} days old (threshold ${input.staleAfterDays}).`, `materials[${ml.name}]`, { ageDays: String(age) }));
        }
      }
    } catch (e) {
      totalCost = null; totalVariable = null;
      if (e instanceof PricingError) issues.push(...e.issues.map((i) => ({ ...i, message: i.message, path: i.path ?? lp })));
      else issues.push(err('line_invalid', `${l.mixCode}: ${(e as Error).message}`, lp));
    }
  }

  // services
  let deliveryTotal = ZERO, pumpingTotal = ZERO, otherTotal = ZERO, serviceCost = ZERO;
  for (const s of input.services) {
    if (!input.plantCost && s.type !== 'other') continue;
    try {
      let r: ServiceResult;
      if (s.type === 'delivery') {
        r = deliveryService(s, input.plantCost!, totalM3, mdp, idp);
        if (s.rateOverride) {
          if (!s.rateOverride.reason?.trim()) issues.push(err('rate_override_reason', 'A reason is required for a delivery rate override.', `services[${s.id}]`));
          approvals.push({ code: 'service_rate_override', message: 'Delivery rate override', detail: { reason: s.rateOverride.reason ?? '' } });
        }
        deliveryTotal = deliveryTotal.plus(D(r.amount));
      } else if (s.type === 'pumping') {
        r = pumpingService(s, input.plantCost!, totalM3, mdp, idp);
        if (s.rateOverride) {
          if (!s.rateOverride.reason?.trim()) issues.push(err('rate_override_reason', 'A reason is required for a pumping rate override.', `services[${s.id}]`));
          approvals.push({ code: 'service_rate_override', message: 'Pumping rate override', detail: { reason: s.rateOverride.reason ?? '' } });
        }
        if (s.quantityM3 && D(s.quantityM3).gt(totalM3)) issues.push(warn('pump_qty_exceeds', 'Pumped volume exceeds the total concrete volume.', `services[${s.id}]`));
        pumpingTotal = pumpingTotal.plus(D(r.amount));
      } else {
        r = otherService(s, mdp);
        otherTotal = otherTotal.plus(D(r.amount));
      }
      if (r.estimatedCost) serviceCost = serviceCost.plus(D(r.estimatedCost));
      serviceResults.push(r);
    } catch (e) {
      if (e instanceof PricingError) issues.push(...e.issues); else issues.push(err('service_invalid', (e as Error).message, `services[${s.id}]`));
    }
  }

  const subtotal = concreteSubtotal.plus(deliveryTotal).plus(pumpingTotal).plus(otherTotal);

  // tax
  let taxResult = null as QuoteResult['customer']['tax'];
  if (!input.tax) {
    issues.push(err('tax_policy_missing', 'No tax policy applies to this quotation date.', 'tax'));
  } else {
    try {
      taxResult = computeTax(input.tax, {
        componentAmounts: { concrete: concreteSubtotal, delivery: deliveryTotal, pumping: pumpingTotal, other: otherTotal } as Record<TaxComponent, Dec>,
        totalConcreteM3: totalM3, logicalLineCount: Math.max(logical.size, 1),
      }, mdp);
      if (input.tax.status !== 'verified') issues.push(err('tax_unverified', 'Tax policy requires verification before issue.', 'tax'));
    } catch (e) { issues.push(...(e instanceof PricingError ? e.issues : [err('tax_invalid', (e as Error).message, 'tax')])); }
  }
  const calcFailed = issues.some((i) => i.severity === 'error' && i.code !== 'tax_unverified') || lineResults.some((l) => !l.calculable);
  const revenue = subtotal;
  let full: Dec | null = null, contrib: Dec | null = null;
  if (totalCost && totalVariable && !calcFailed) {
    full = totalCost.plus(serviceCost);
    contrib = revenue.minus(totalVariable).minus(serviceCost);
  }
  const pct = (n: Dec | null) => (n && revenue.gt(0) ? S(n.div(revenue).mul(HUNDRED), 3) : null);
  const marginAbs = full ? revenue.minus(full) : null;

  return {
    engineVersion: ENGINE_VERSION, rounding, lines: lineResults, services: serviceResults,
    customer: {
      totalVolumeM3: totalM3.toString(), concreteSubtotal: S(concreteSubtotal, mdp), deliveryTotal: S(deliveryTotal, mdp),
      pumpingTotal: S(pumpingTotal, mdp), otherTotal: S(otherTotal, mdp), subtotalExTax: S(subtotal, mdp),
      tax: taxResult, taxAmount: taxResult?.tax ?? null,
      total: taxResult && !calcFailed ? S(subtotal.plus(D(taxResult.tax)), mdp) : null,
    },
    internal: {
      revenueExTax: S(revenue, mdp),
      totalConfiguredCost: full ? S(full, mdp) : null,
      serviceEstimatedCost: S(serviceCost, mdp),
      contributionBeforeFixed: contrib ? S(contrib, mdp) : null,
      contributionBeforeFixedPct: pct(contrib),
      marginAfterFullCost: marginAbs ? S(marginAbs, mdp) : null,
      marginAfterFullCostPct: pct(marginAbs),
    },
    issues, approvals,
    versions: {
      engine: ENGINE_VERSION,
      policyIds: [...new Set(input.lines.filter((l) => l.policy).map((l) => `${l.policy!.id}@v${l.policy!.version}`))],
      taxPolicyId: input.tax?.id ?? null,
      priceVersionIds: [...priceVersionIds], plantCostVersionId: input.plantCost?.versionId ?? null,
      forecastVersionId: input.forecast?.versionId ?? null,
    },
  };
}

/** Solve the concrete unit rate so that the customer total equals a tax-inclusive target. Single concrete line only. */
export function solveRateForInclusiveTotal(
  input: QuoteInput, targetInclusive: string,
): { ratePerM3: string; achievedTotal: string; delta: string } {
  const rounding = resolveRounding(input.rounding);
  if (!input.tax) throw new PricingError([err('tax_policy_missing', 'No tax policy applies.')]);
  if (input.lines.length !== 1) throw new PricingError([err('inversion_ambiguous', 'Tax-inclusive entry needs exactly one concrete line.')]);
  const qty = D(input.lines[0]!.quantityM3);
  // compute services from a scratch run (price override placeholder so the line is calculable)
  const probe = priceQuotation({ ...input, lines: [{ ...input.lines[0]!, priceOverride: { perM3: '1', reason: 'probe' } }] });
  const svc = (t: 'delivery' | 'pumping' | 'other') => probe.services.filter((s) => s.component === t).reduce((a, s) => a.plus(D(s.amount)), ZERO);
  const others = { delivery: svc('delivery'), pumping: svc('pumping'), other: svc('other') };
  const amount = inverseConcreteAmount(input.tax, D(targetInclusive), others, qty, 1);
  if (amount.lte(0)) throw new PricingError([err('inversion_nonpositive', 'The tax-inclusive target is too low for the services already included.')]);
  const rate = rnd(amount.div(qty), rounding.priceDp);
  const check = priceQuotation({ ...input, lines: [{ ...input.lines[0]!, priceOverride: { perM3: rate.toString(), reason: 'inclusive entry' } }] });
  if (check.customer.total === null) throw new PricingError([check.issues.find((i) => i.severity === 'error' && i.code !== 'tax_unverified') ?? err('not_calculable', 'The quotation cannot be calculated yet.')]);
  const total = check.customer.total;
  return { ratePerM3: S(rate, rounding.priceDp), achievedTotal: total, delta: S(D(total).minus(D(targetInclusive)), rounding.moneyDp) };
}

/**
 * Customer-facing totals from fixed unit rates and a charge rate card — used for offline estimates.
 * Contains no cost data. The server's priceQuotation remains the authority at submission.
 */
export interface PreviewInput {
  scope: QuoteInput['scope'];
  rounding?: Partial<RoundingPolicy>;
  lines: { id: string; mixRevisionId: string; quantityM3: string; ratePerM3: string }[];
  services: QuoteInput['services'];
  rateCard: NonNullable<QuoteInput['plantCost']>;
  tax: QuoteInput['tax'];
}
export function previewCustomerTotals(input: PreviewInput) {
  const r = resolveRounding(input.rounding);
  const issues: Issue[] = [];
  let totalM3 = ZERO, concrete = ZERO;
  const lines = input.lines.map((l) => {
    try {
      const q = D(l.quantityM3, 'quantity');
      if (q.lte(0)) throw new Error('quantity');
      const amount = rnd(q.mul(D(l.ratePerM3)), r.moneyDp);
      totalM3 = totalM3.plus(q); concrete = concrete.plus(amount);
      return { id: l.id, amount: S(amount, r.moneyDp) };
    } catch {
      issues.push(err('quantity_invalid', 'Enter a valid quantity in m³.', `lines[${l.id}].quantity`));
      return { id: l.id, amount: null as string | null };
    }
  });
  let delivery = ZERO, pumping = ZERO, other = ZERO;
  const services: ServiceResult[] = [];
  for (const s of input.services) {
    try {
      const x = s.type === 'delivery' ? deliveryService(s, input.rateCard, totalM3, r.moneyDp, r.internalDp)
        : s.type === 'pumping' ? pumpingService(s, input.rateCard, totalM3, r.moneyDp, r.internalDp) : otherService(s, r.moneyDp);
      services.push(x);
      if (s.type === 'delivery') delivery = delivery.plus(D(x.amount)); else if (s.type === 'pumping') pumping = pumping.plus(D(x.amount)); else other = other.plus(D(x.amount));
    } catch (e) { issues.push(...(e instanceof PricingError ? e.issues : [err('service_invalid', (e as Error).message)])); }
  }
  const subtotal = concrete.plus(delivery).plus(pumping).plus(other);
  let tax = null as ReturnType<typeof computeTax> | null;
  if (input.tax && !issues.length) {
    const keys = new Set(input.lines.map((l) => `${l.mixRevisionId}|${D(l.ratePerM3).toString()}`));
    tax = computeTax(input.tax, { componentAmounts: { concrete, delivery, pumping, other } as Record<TaxComponent, Dec>, totalConcreteM3: totalM3, logicalLineCount: Math.max(keys.size, 1) }, r.moneyDp);
  }
  return {
    lines, services, issues, totalVolumeM3: totalM3.toString(), concreteSubtotal: S(concrete, r.moneyDp), deliveryTotal: S(delivery, r.moneyDp),
    pumpingTotal: S(pumping, r.moneyDp), otherTotal: S(other, r.moneyDp), subtotalExTax: S(subtotal, r.moneyDp), tax,
    total: tax ? S(subtotal.plus(D(tax.tax)), r.moneyDp) : null,
  };
}
