/** Translate engine/server issue codes into the current language; unknown codes fall back to the server text. */
export function issueText(i: { code?: string; message: string; path?: string }, t: (s: string, v?: Record<string, string | number>) => string): string {
  const m = i.message;
  const name = (re: RegExp) => re.exec(m)?.[1] ?? '';
  switch (i.code) {
    case 'price_missing': return t('{name} price is missing for this plant.', { name: name(/^(.*) price is missing/) });
    case 'quantity_invalid': return t('Enter a valid quantity in m³ for {mix}.', { mix: name(/^(\S+):/) });
    case 'forecast_missing': return t('Enter a monthly forecast volume to allocate fixed costs.');
    case 'forecast_nonpositive': return t('Forecast volume must be greater than zero to allocate fixed costs.');
    case 'tax_unverified': return t('Tax policy requires verification before issue.');
    case 'tax_policy_missing': return t('No tax policy applies to this quotation date.');
    case 'plant_cost_missing': return t('No approved plant cost version is effective for this plant and date.');
    case 'policy_missing': return t('No commercial pricing policy applies to {mix} at this plant and date.', { mix: name(/applies to (\S+)/) });
    case 'lines_empty': return t('Add at least one concrete line.');
    case 'client_missing': return t('Select a client.');
    case 'project_missing': return t('Select a project.');
    case 'plant_missing': return t('Select the supplying plant.');
    case 'terms_missing': return t('Select an approved terms version.');
    case 'payment_terms_missing': return t('Enter the payment terms.');
    case 'delivery_missing': return t('Add a delivery service for a delivered quotation.');
    case 'pumping_missing': return t('Add a pumping service for this scope.');
    case 'delivery_duplicate': return t('Only one delivery charge is allowed per quotation.');
    case 'pumping_duplicate': return t('Only one pumping charge is allowed per quotation; use the number of visits for several pours.');
    case 'scope_conflict': return t('The services do not match the selected supply scope.');
    case 'price_override_reason': case 'cost_override_reason': case 'rate_override_reason': return t('Enter a reason for the override.');
    case 'trip_distance_missing': return t('Enter the round-trip distance (km) for trip-based delivery.');
    case 'trip_assumptions_missing': return t('Trip-based delivery needs truck capacity, trip charge and cost assumptions for this plant.');
    case 'zone_missing': return t('Select a configured delivery zone.');
    case 'price_stale': return t('A material price is older than the freshness threshold.');
    case 'below_cost': return t('This line is priced below its full configured cost.');
    case 'terms_unapproved': return t('The selected terms version has not been approved.');
    case 'not_approved': return t('The revision must be approved before it can be issued.');
    case 'density_missing': case 'conversion_required': case 'freight_missing': return m;
    default: return m;
  }
}
