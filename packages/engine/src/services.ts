import { D, Dec, ZERO, rnd, S } from './decimal';
import { PricingError, err } from './errors';
import type {
  DeliveryServiceInput, Issue, OtherServiceInput, PlantCostInput, PumpingServiceInput, ServiceResult,
} from './types';

const row = (key: string, label: string, q: Dec, unit: string, rate: Dec, amount: Dec, mdp: number) => ({
  key, label, quantity: q.toString(), unit, rate: rate.toString(), amount: S(amount, mdp),
});

export function deliveryService(s: DeliveryServiceInput, pc: PlantCostInput, totalM3: Dec, mdp: number, idp: number): ServiceResult {
  const path = `services[${s.id}]`;
  const qty = s.quantityM3 ? D(s.quantityM3, 'delivery quantity') : totalM3;
  if (qty.lte(0)) throw new PricingError([err('qty_invalid', 'Delivery quantity must be greater than zero.', path)]);
  const d = pc.delivery;
  if (s.method === 'per_m3') {
    if (!d.perM3) throw new PricingError([err('delivery_rate_missing', 'No per-m³ delivery rate is configured for this plant.', path)]);
    const charge = s.rateOverride ? D(s.rateOverride.chargePerM3) : D(d.perM3.chargePerM3);
    const amount = rnd(qty.mul(charge), mdp);
    const cost = rnd(qty.mul(D(d.perM3.costPerM3)), idp);
    return { id: s.id, type: 'delivery', component: 'delivery', rows: [row('delivery', 'Delivery', qty, 'm³', charge, amount, mdp)], amount: S(amount, mdp), estimatedCost: S(cost, idp) };
  }
  if (s.method === 'zone') {
    const z = d.zones?.find((x) => x.code === s.zoneCode);
    if (!s.zoneCode || !z) throw new PricingError([err('zone_missing', 'Select a configured delivery zone.', path)]);
    const charge = s.rateOverride ? D(s.rateOverride.chargePerM3) : D(z.chargePerM3);
    const amount = rnd(qty.mul(charge), mdp);
    return { id: s.id, type: 'delivery', component: 'delivery', rows: [row('delivery', `Delivery – ${z.name}`, qty, 'm³', charge, amount, mdp)], amount: S(amount, mdp), estimatedCost: S(qty.mul(D(z.costPerM3)), idp) };
  }
  // trip
  const t = d.trip;
  const issues: Issue[] = [];
  if (!t) issues.push(err('trip_assumptions_missing', 'Trip-based delivery needs truck capacity, trip charge and cost assumptions for this plant.', path));
  if (!s.roundTripKm) issues.push(err('trip_distance_missing', 'Enter the round-trip distance (km) for trip-based delivery.', path));
  if (issues.length) throw new PricingError(issues);
  const cap = D(t!.truckCapacityM3, 'truck capacity');
  if (cap.lte(0)) throw new PricingError([err('trip_capacity_invalid', 'Truck capacity must be greater than zero.', path)]);
  const km = D(s.roundTripKm!, 'round-trip km');
  if (km.lt(0)) throw new PricingError([err('trip_distance_invalid', 'Distance cannot be negative.', path)]);
  const trips = qty.div(cap).ceil();
  const chargeTrip = D(t!.chargePerTrip);
  const amount = rnd(trips.mul(chargeTrip), mdp);
  const cost = rnd(trips.mul(D(t!.fixedCostPerTrip).plus(km.mul(D(t!.costPerKm)))), idp);
  return { id: s.id, type: 'delivery', component: 'delivery', rows: [row('delivery', `Delivery – ${trips} trips`, trips, 'trip', chargeTrip, amount, mdp)], amount: S(amount, mdp), estimatedCost: S(cost, idp) };
}

/** Pumping: volume charge with minimum applied per visit/pour/pump/quotation, plus mobilization and extra hours. */
export function pumpingService(s: PumpingServiceInput, pc: PlantCostInput, totalM3: Dec, mdp: number, idp: number): ServiceResult {
  const path = `services[${s.id}]`;
  const p = pc.pumping;
  if (!p) throw new PricingError([err('pumping_rate_missing', 'No pumping rates are configured for this plant.', path)]);
  const qty = s.quantityM3 ? D(s.quantityM3, 'pumping quantity') : totalM3;
  if (qty.lte(0)) throw new PricingError([err('qty_invalid', 'Pumping quantity must be greater than zero.', path)]);
  const rate = s.rateOverride ? D(s.rateOverride.chargePerM3) : D(p.chargePerM3);
  const min = D(p.minCharge);
  const perQuotation = p.minBasis === 'per_quotation';
  const unitCount = perQuotation ? 1 : s.units ?? 1;
  if (!Number.isInteger(unitCount) || unitCount < 1) throw new PricingError([err('units_invalid', `Enter the number of ${p.minBasis.replace('per_', '')}s (at least 1).`, path)]);
  let quantities: Dec[];
  if (s.visitQuantities && !perQuotation) {
    if (s.visitQuantities.length !== unitCount) throw new PricingError([err('visit_quantities_mismatch', 'Per-visit quantities must match the number of visits.', path)]);
    quantities = s.visitQuantities.map((q) => D(q));
    const sum = quantities.reduce((a, b) => a.plus(b), ZERO);
    if (!sum.eq(qty)) throw new PricingError([err('visit_quantities_sum', 'Per-visit quantities must add up to the pumped volume.', path)]);
  } else {
    // assumption: pumped volume is split evenly across units unless quantities are given explicitly
    quantities = Array.from({ length: unitCount }, () => qty.div(unitCount));
  }
  let volumeCharge = ZERO;
  for (const q of quantities) {
    const c = rnd(q.mul(rate), mdp);
    volumeCharge = volumeCharge.plus(c.lt(min) ? min : c);
  }
  volumeCharge = rnd(volumeCharge, mdp);
  const rows = [row('pumping_volume', `Pumping${min.gt(0) ? ` (minimum ${min} JOD ${p.minBasis.replace('_', ' ')})` : ''}`, qty, 'm³', rate, volumeCharge, mdp)];
  let total = volumeCharge;
  const mob = D(p.mobilizationFee);
  if (mob.gt(0)) {
    const a = rnd(mob.mul(unitCount), mdp);
    rows.push(row('pumping_mobilization', 'Pump mobilization / setup', D(unitCount), p.minBasis.replace('per_', ''), mob, a, mdp));
    total = total.plus(a);
  }
  if (s.extraHours && D(s.extraHours).gt(0)) {
    const hr = D(p.extraHourRate);
    const h = D(s.extraHours);
    const a = rnd(h.mul(hr), mdp);
    rows.push(row('pumping_extra_hours', 'Additional pumping hours', h, 'hour', hr, a, mdp));
    total = total.plus(a);
  }
  const cost = rnd(qty.mul(D(p.costPerM3)).plus(D(p.costPerUnit).mul(unitCount)), idp);
  return { id: s.id, type: 'pumping', component: 'pumping', rows, amount: S(total, mdp), estimatedCost: S(cost, idp) };
}

export function otherService(s: OtherServiceInput, mdp: number): ServiceResult {
  const q = D(s.quantity, 'quantity'), r = D(s.rate, 'rate');
  if (q.lte(0) || r.lt(0)) throw new PricingError([err('other_invalid', `${s.label}: quantity must be positive and rate cannot be negative.`, `services[${s.id}]`)]);
  const a = rnd(q.mul(r), mdp);
  return { id: s.id, type: 'other', component: 'other', rows: [row('other', s.label, q, s.unit, r, a, mdp)], amount: S(a, mdp), estimatedCost: null };
}
