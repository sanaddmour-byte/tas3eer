import { sql } from 'drizzle-orm';
import {
  bigserial, customType, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const customBytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull().references(() => tenants.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 18, scale: 6 });

export const tenants = pgTable('tenants', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull().unique(),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`), isDemo: boolean('is_demo').notNull().default(false), createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(), email: text('email').notNull(), name: text('name').notNull(), passwordHash: text('password_hash').notNull(),
  locale: text('locale').notNull().default('en'), disabled: boolean('disabled').notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0), lockedUntil: timestamp('locked_until', { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_lower').on(sql`lower(${t.email})`)]);

export const memberships = pgTable('memberships', {
  id: id(), tenantId: tenantId(), userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(), grant: text('grant_caps').array().notNull().default(sql`'{}'`), revoke: text('revoke_caps').array().notNull().default(sql`'{}'`),
  allPlants: boolean('all_plants').notNull().default(false), status: text('status').notNull().default('active'), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.userId), unique().on(t.tenantId, t.id), check('memberships_role', sql`${t.role} in ('admin','pricing','technical','sales','viewer')`)]);

export const plants = pgTable('plants', {
  id: id(), tenantId: tenantId(), code: text('code').notNull(), nameEn: text('name_en').notNull(), nameAr: text('name_ar').notNull().default(''),
  address: text('address').notNull().default(''), active: boolean('active').notNull().default(true),
}, (t) => [unique().on(t.tenantId, t.code), unique().on(t.tenantId, t.id)]);

export const plantAssignments = pgTable('plant_assignments', {
  tenantId: tenantId(), membershipId: uuid('membership_id').notNull(), plantId: uuid('plant_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.membershipId, t.plantId] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), userId: uuid('user_id').notNull().references(() => users.id), tenantId: tenantId(), membershipId: uuid('membership_id').notNull(),
  csrfToken: text('csrf_token').notNull(), createdAt: createdAt(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }), userAgent: text('user_agent'),
}, (t) => [foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] })]);

export const invitations = pgTable('invitations', {
  id: id(), tenantId: tenantId(), email: text('email').notNull(), role: text('role').notNull(), plantIds: jsonb('plant_ids').notNull().default(sql`'[]'::jsonb`),
  allPlants: boolean('all_plants').notNull().default(false), tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), usedAt: timestamp('used_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
});

export const materials = pgTable('materials', {
  id: id(), tenantId: tenantId(), code: text('code').notNull(), nameEn: text('name_en').notNull(), nameAr: text('name_ar').notNull().default(''),
  category: text('category').notNull().default('other'), purchaseUnit: text('purchase_unit').notNull(), dosageUnit: text('dosage_unit').notNull(),
  conversionFactor: numeric('conversion_factor', { precision: 18, scale: 8 }), densityKgPerM3: numeric('density_kg_m3', { precision: 18, scale: 4 }),
  wastagePct: numeric('wastage_pct', { precision: 8, scale: 4 }).notNull().default('0'), active: boolean('active').notNull().default(true), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.code), unique().on(t.tenantId, t.id), check('materials_wastage', sql`${t.wastagePct} >= 0 and ${t.wastagePct} <= 100`)]);

export const priceBatches = pgTable('price_batches', {
  id: id(), tenantId: tenantId(), name: text('name').notNull(), plantId: uuid('plant_id'), status: text('status').notNull().default('draft'),
  currentRevision: integer('current_revision').notNull().default(1), source: text('source').notNull().default('manual'), fileName: text('file_name'),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(), createdBy: uuid('created_by').notNull().references(() => users.id), submittedBy: uuid('submitted_by').references(() => users.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }), decidedBy: uuid('decided_by').references(() => users.id), decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionComment: text('decision_comment'), publishedAt: timestamp('published_at', { withTimezone: true }), createdAt: createdAt(),
  history: jsonb('history').notNull().default(sql`'[]'::jsonb`),
}, (t) => [unique().on(t.tenantId, t.id), check('price_batches_status', sql`${t.status} in ('draft','submitted','published','rejected','returned')`)]);

export const materialPriceVersions = pgTable('material_price_versions', {
  id: id(), tenantId: tenantId(), materialId: uuid('material_id').notNull(), plantId: uuid('plant_id').notNull(),
  price: money('price').notNull(), basis: text('basis').notNull(), freight: money('freight'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }),
  source: text('source').notNull().default(''), batchId: uuid('batch_id'), createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materials.tenantId, materials.id] }),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [priceBatches.tenantId, priceBatches.id] }),
  check('mpv_price', sql`${t.price} >= 0`), check('mpv_basis', sql`${t.basis} in ('ex_source','delivered_plant')`),
  check('mpv_freight', sql`${t.basis} = 'delivered_plant' or ${t.freight} is not null`), check('mpv_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  index('mpv_lookup').on(t.tenantId, t.plantId, t.materialId, t.validFrom),
]);

export const priceBatchItems = pgTable('price_batch_items', {
  id: id(), tenantId: tenantId(), batchId: uuid('batch_id').notNull(), batchRevision: integer('batch_revision').notNull().default(1),
  rowNo: integer('row_no').notNull().default(0), materialId: uuid('material_id').notNull(), plantId: uuid('plant_id').notNull(),
  baseVersionId: uuid('base_version_id'), basePrice: money('base_price'), baseBasis: text('base_basis'), baseFreight: money('base_freight'),
  proposedPrice: money('proposed_price').notNull(), proposedBasis: text('proposed_basis').notNull(), proposedFreight: money('proposed_freight'),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(), impact: jsonb('impact').notNull().default(sql`'{}'::jsonb`),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [priceBatches.tenantId, priceBatches.id] }),
  foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materials.tenantId, materials.id] }),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  foreignKey({ columns: [t.tenantId, t.baseVersionId], foreignColumns: [materialPriceVersions.tenantId, materialPriceVersions.id] }),
  unique().on(t.batchId, t.batchRevision, t.materialId, t.plantId), check('pbi_price', sql`${t.proposedPrice} >= 0`),
]);

export const plantCostVersions = pgTable('plant_cost_versions', {
  id: id(), tenantId: tenantId(), plantId: uuid('plant_id').notNull(), status: text('status').notNull().default('draft'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }),
  fixedCosts: jsonb('fixed_costs').notNull(), variableCosts: jsonb('variable_costs').notNull(),
  corporateOverheadPerM3: money('corporate_overhead_per_m3').notNull(), riskProvisionPerM3: money('risk_provision_per_m3').notNull(),
  delivery: jsonb('delivery').notNull(), pumping: jsonb('pumping'), note: text('note').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id), publishedBy: uuid('published_by').references(() => users.id), publishedAt: timestamp('published_at', { withTimezone: true }), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  check('pcv_status', sql`${t.status} in ('draft','published')`), check('pcv_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
]);

export const forecastVolumes = pgTable('forecast_volumes', {
  id: id(), tenantId: tenantId(), plantId: uuid('plant_id').notNull(), monthlyM3: numeric('monthly_m3', { precision: 18, scale: 3 }).notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }), source: text('source').notNull(),
  createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  check('fv_positive', sql`${t.monthlyM3} > 0`), check('fv_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
]);

export const mixes = pgTable('mixes', {
  id: id(), tenantId: tenantId(), code: text('code').notNull(), nameEn: text('name_en').notNull(), nameAr: text('name_ar').notNull().default(''),
  grade: text('grade').notNull(), active: boolean('active').notNull().default(true), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.code), unique().on(t.tenantId, t.id)]);

export const mixPlants = pgTable('mix_plants', {
  tenantId: tenantId(), mixId: uuid('mix_id').notNull(), plantId: uuid('plant_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.mixId, t.plantId] }),
  foreignKey({ columns: [t.tenantId, t.mixId], foreignColumns: [mixes.tenantId, mixes.id] }),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
]);

export const mixRevisions = pgTable('mix_revisions', {
  id: id(), tenantId: tenantId(), mixId: uuid('mix_id').notNull(), revNo: integer('rev_no').notNull(), status: text('status').notNull().default('draft'),
  spec: jsonb('spec').notNull().default(sql`'{}'::jsonb`), notes: text('notes').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id), submittedBy: uuid('submitted_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id), approvedAt: timestamp('approved_at', { withTimezone: true }), createdAt: createdAt(),
}, (t) => [
  unique().on(t.mixId, t.revNo), unique().on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.mixId], foreignColumns: [mixes.tenantId, mixes.id] }),
  check('mr_status', sql`${t.status} in ('draft','pending_technical','approved','superseded','rejected')`),
]);

export const mixIngredients = pgTable('mix_ingredients', {
  id: id(), tenantId: tenantId(), mixRevisionId: uuid('mix_revision_id').notNull(), materialId: uuid('material_id').notNull(),
  dosage: numeric('dosage', { precision: 18, scale: 6 }).notNull(),
}, (t) => [
  unique().on(t.mixRevisionId, t.materialId),
  foreignKey({ columns: [t.tenantId, t.mixRevisionId], foreignColumns: [mixRevisions.tenantId, mixRevisions.id] }),
  foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materials.tenantId, materials.id] }),
  check('mi_dosage', sql`${t.dosage} > 0`),
]);

export const pricingPolicies = pgTable('commercial_pricing_policies', {
  id: id(), tenantId: tenantId(), name: text('name').notNull(), version: integer('version').notNull().default(1), mode: text('mode').notNull(),
  pct: numeric('pct', { precision: 9, scale: 4 }).notNull(), minMarginPct: numeric('min_margin_pct', { precision: 9, scale: 4 }).notNull(),
  plantId: uuid('plant_id'), mixId: uuid('mix_id'), validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }),
  createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  foreignKey({ columns: [t.tenantId, t.mixId], foreignColumns: [mixes.tenantId, mixes.id] }),
  check('cpp_mode', sql`${t.mode} in ('gross_margin','markup')`),
  check('cpp_pct', sql`(${t.mode} = 'gross_margin' and ${t.pct} >= 0 and ${t.pct} < 100) or (${t.mode} = 'markup' and ${t.pct} >= 0 and ${t.pct} <= 1000)`),
]);

export const clients = pgTable('clients', {
  id: id(), tenantId: tenantId(), name: text('name').notNull(), taxNumber: text('tax_number').notNull().default(''), notes: text('notes').notNull().default(''),
  contacts: jsonb('contacts').notNull().default(sql`'[]'::jsonb`), createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.id)]);

export const projects = pgTable('projects', {
  id: id(), tenantId: tenantId(), clientId: uuid('client_id').notNull(), name: text('name').notNull(), siteAddress: text('site_address').notNull().default(''),
  siteContact: jsonb('site_contact').notNull().default(sql`'{}'::jsonb`), defaultPlantId: uuid('default_plant_id'), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.clientId], foreignColumns: [clients.tenantId, clients.id] }),
  foreignKey({ columns: [t.tenantId, t.defaultPlantId], foreignColumns: [plants.tenantId, plants.id] }),
]);

export const taxPolicyVersions = pgTable('tax_policy_versions', {
  id: id(), tenantId: tenantId(), policyKey: text('policy_key').notNull(), name: text('name').notNull(), status: text('status').notNull().default('draft'),
  ratePct: numeric('rate_pct', { precision: 9, scale: 4 }).notNull(), taxableComponents: jsonb('taxable_components').notNull(),
  deductionAmount: money('deduction_amount').notNull().default('0'), deductionBasis: text('deduction_basis').notNull().default('per_document'),
  nonNegativeBase: boolean('non_negative_base').notNull().default(true), exemptionNote: text('exemption_note').notNull().default(''),
  sourceReference: text('source_reference').notNull().default(''), isDemo: boolean('is_demo').notNull().default(false),
  verifiedBy: uuid('verified_by').references(() => users.id), verifiedAt: timestamp('verified_at', { withTimezone: true }), verificationReference: text('verification_reference'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(), validTo: date('valid_to', { mode: 'string' }),
  createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(),
}, (t) => [
  unique().on(t.tenantId, t.id), check('tpv_status', sql`${t.status} in ('draft','demo','verified','retired')`),
  check('tpv_basis', sql`${t.deductionBasis} in ('per_m3','per_line','per_document')`), check('tpv_rate', sql`${t.ratePct} >= 0 and ${t.ratePct} <= 100`),
]);

export const termsVersions = pgTable('terms_versions', {
  id: id(), tenantId: tenantId(), version: integer('version').notNull(), name: text('name').notNull(), clauses: jsonb('clauses').notNull(),
  status: text('status').notNull().default('draft'), isPlaceholder: boolean('is_placeholder').notNull().default(false),
  approvedBy: uuid('approved_by').references(() => users.id), approvedAt: timestamp('approved_at', { withTimezone: true }), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.version), unique().on(t.tenantId, t.id), check('tv_status', sql`${t.status} in ('draft','approved','retired')`)]);

export const quotations = pgTable('quotations', {
  id: uuid('id').primaryKey(), tenantId: tenantId(), number: text('number'), clientId: uuid('client_id'), projectId: uuid('project_id'), plantId: uuid('plant_id'),
  ownerMembershipId: uuid('owner_membership_id').notNull(), status: text('status').notNull().default('draft'), latestRevNo: integer('latest_rev_no').notNull().default(1),
  lostReason: text('lost_reason'), competitorNote: text('competitor_note'), outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.tenantId, t.id), uniqueIndex('quotations_number').on(t.tenantId, t.number),
  foreignKey({ columns: [t.tenantId, t.clientId], foreignColumns: [clients.tenantId, clients.id] }),
  foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }),
  foreignKey({ columns: [t.tenantId, t.plantId], foreignColumns: [plants.tenantId, plants.id] }),
  foreignKey({ columns: [t.tenantId, t.ownerMembershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
]);

export const quotationRevisions = pgTable('quotation_revisions', {
  id: id(), tenantId: tenantId(), quotationId: uuid('quotation_id').notNull(), revNo: integer('rev_no').notNull(), status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1), doc: jsonb('doc').notNull(), result: jsonb('result'), reference: jsonb('reference'),
  snapshot: jsonb('snapshot'), snapshotHash: text('snapshot_hash'), frozenAt: timestamp('frozen_at', { withTimezone: true }), submittedBy: uuid('submitted_by').references(() => users.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }), issuedBy: uuid('issued_by').references(() => users.id), validUntil: date('valid_until', { mode: 'string' }), pdfSha256: text('pdf_sha256'),
  parentRevNo: integer('parent_rev_no'), createdBy: uuid('created_by').references(() => users.id), createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.quotationId, t.revNo), unique().on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.quotationId], foreignColumns: [quotations.tenantId, quotations.id] }),
  check('qr_status', sql`${t.status} in ('draft','pending_approval','approved','returned','issued','accepted','declined','expired','cancelled','superseded')`),
]);

export const quotationLines = pgTable('quotation_lines', {
  id: text('id').notNull(), tenantId: tenantId(), revisionId: uuid('revision_id').notNull(), position: integer('position').notNull(), mixRevisionId: uuid('mix_revision_id').notNull(),
  quantityM3: numeric('quantity_m3', { precision: 18, scale: 3 }), priceOverride: jsonb('price_override'), costOverride: jsonb('cost_override'),
}, (t) => [
  primaryKey({ columns: [t.revisionId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.revisionId], foreignColumns: [quotationRevisions.tenantId, quotationRevisions.id] }),
  foreignKey({ columns: [t.tenantId, t.mixRevisionId], foreignColumns: [mixRevisions.tenantId, mixRevisions.id] }),
]);

export const serviceCharges = pgTable('service_charges', {
  id: text('id').notNull(), tenantId: tenantId(), revisionId: uuid('revision_id').notNull(), position: integer('position').notNull(), type: text('type').notNull(),
  params: jsonb('params').notNull(), amount: numeric('amount', { precision: 18, scale: 3 }),
}, (t) => [
  primaryKey({ columns: [t.revisionId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.revisionId], foreignColumns: [quotationRevisions.tenantId, quotationRevisions.id] }),
  check('sc_type', sql`${t.type} in ('delivery','pumping','other')`),
]);

export const approvalRequests = pgTable('approval_requests', {
  id: id(), tenantId: tenantId(), quotationId: uuid('quotation_id').notNull(), revisionId: uuid('revision_id').notNull(), reasons: jsonb('reasons').notNull(),
  status: text('status').notNull().default('pending'), requestedBy: uuid('requested_by').notNull().references(() => users.id), requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid('decided_by').references(() => users.id), decidedAt: timestamp('decided_at', { withTimezone: true }), comment: text('comment'),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.revisionId], foreignColumns: [quotationRevisions.tenantId, quotationRevisions.id] }),
  foreignKey({ columns: [t.tenantId, t.quotationId], foreignColumns: [quotations.tenantId, quotations.id] }),
  check('ar_status', sql`${t.status} in ('pending','approved','returned','cancelled','invalidated')`),
]);

export const auditEvents = pgTable('audit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), tenantId: tenantId(), actorUserId: uuid('actor_user_id'), actorLabel: text('actor_label'),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), action: text('action').notNull(), detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_entity').on(t.tenantId, t.entityType, t.entityId), index('audit_time').on(t.tenantId, t.at)]);

export const syncOperations = pgTable('sync_operations', {
  id: id(), tenantId: tenantId(), userId: uuid('user_id').notNull().references(() => users.id), idempotencyKey: text('idempotency_key').notNull(),
  opType: text('op_type').notNull(), entityId: text('entity_id'), status: text('status').notNull(), response: jsonb('response').notNull(), createdAt: createdAt(),
}, (t) => [unique().on(t.tenantId, t.userId, t.idempotencyKey)]);

export const numberSequences = pgTable('number_sequences', {
  tenantId: tenantId(), key: text('key').notNull(), last: integer('last').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);

export const quotationPdfs = pgTable('quotation_pdfs', {
  revisionId: uuid('revision_id').primaryKey(), tenantId: tenantId(), lang: text('lang').notNull().default('en'), sha256: text('sha256').notNull(),
  bytes: customBytea('bytes').notNull(), createdAt: createdAt(),
}, (t) => [foreignKey({ columns: [t.tenantId, t.revisionId], foreignColumns: [quotationRevisions.tenantId, quotationRevisions.id] })]);
