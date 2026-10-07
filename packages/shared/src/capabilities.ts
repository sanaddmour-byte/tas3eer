export const CAPABILITIES = [
  'tenant.manage', 'user.manage', 'audit.view',
  'cost.view', 'price.view',
  'material.manage', 'pricebatch.propose', 'pricebatch.approve',
  'plantcost.manage', 'plantcost.approve', 'forecast.manage',
  'mix.create', 'mix.approve',
  'policy.manage', 'tax.manage', 'tax.verify', 'terms.manage',
  'client.manage',
  'quote.create', 'quote.view_all', 'quote.override_price', 'quote.override_cost', 'quote.approve', 'quote.issue',
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type Role = 'admin' | 'pricing' | 'technical' | 'sales' | 'viewer';
export const ROLES: Role[] = ['admin', 'pricing', 'technical', 'sales', 'viewer'];

/** Role presets. Memberships can grant/revoke individual capabilities on top of these. */
export const ROLE_PRESETS: Record<Role, Capability[]> = {
  admin: ['tenant.manage', 'user.manage', 'audit.view', 'policy.manage', 'tax.manage', 'terms.manage', 'client.manage', 'price.view', 'quote.view_all', 'material.manage'],
  pricing: [
    'cost.view', 'price.view', 'material.manage', 'pricebatch.propose', 'pricebatch.approve', 'plantcost.manage', 'plantcost.approve',
    'forecast.manage', 'policy.manage', 'tax.manage', 'tax.verify', 'quote.view_all', 'quote.approve', 'quote.override_price', 'quote.override_cost', 'audit.view', 'client.manage',
  ],
  technical: ['mix.create', 'mix.approve', 'material.manage'],
  sales: ['price.view', 'client.manage', 'quote.create', 'quote.issue', 'quote.override_price'],
  viewer: ['price.view', 'quote.view_all'],
};

export function effectiveCapabilities(role: Role, grant: string[] = [], revoke: string[] = []): Capability[] {
  const set = new Set<string>(ROLE_PRESETS[role] ?? []);
  grant.forEach((g) => set.add(g));
  revoke.forEach((r) => set.delete(r));
  return [...set].filter((c): c is Capability => (CAPABILITIES as readonly string[]).includes(c));
}
export const can = (caps: readonly string[], c: Capability) => caps.includes(c);

export const QUOTE_STATUSES = ['draft', 'pending_approval', 'approved', 'issued', 'accepted', 'declined', 'expired', 'cancelled', 'returned', 'superseded'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Permitted transitions for a quotation revision. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'returned', 'cancelled'],
  approved: ['issued', 'cancelled', 'superseded'],
  returned: ['superseded', 'cancelled'],
  issued: ['accepted', 'declined', 'expired', 'cancelled', 'superseded'],
  accepted: [], declined: ['superseded'], expired: ['superseded'], cancelled: [], superseded: [],
};
export const canTransition = (from: QuoteStatus, to: QuoteStatus) => QUOTE_TRANSITIONS[from]?.includes(to) ?? false;
