import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { priceQuotation, previewCustomerTotals, type QuoteInput, type QuoteResult, type QuoteLineInput, type ServiceInput, type Issue } from '@rm/engine';
import { canTransition, type QuoteDocument, type QuoteStatus } from '@rm/shared';
import { schema, type Db, type Tx } from '../db/client.js';
import { conflict, forbidden, HttpError, has, plantAllowed, unprocessable, type Ctx } from '../http.js';
import { audit } from './audit.js';
import { loadForecast, loadMaterials, loadMixRevs, loadPlantCost, loadPolicies, loadPrices, loadTax, resolvePolicy, taxRow, today } from './reference.js';

const { quotations, quotationRevisions, quotationLines, serviceCharges, approvalRequests, clients, projects, plants, termsVersions, memberships, taxPolicyVersions } = schema;
type Q = Db | Tx;

export const emptyDoc = (ctx: Ctx): QuoteDocument => ({
  clientId: null, projectId: null, plantId: null, scope: 'supply_only', taxPolicyId: null, termsVersionId: null, validityDays: ctx.tenantSettings.defaultValidityDays,
  paymentTerms: '', supplySchedule: '', customerNotes: '', internalNotes: '', lines: [], services: [], pinnedReference: false,
});

const sha = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Build engine input from a draft document using CURRENT reference data (or a pinned stored reference). */
export async function buildInput(q: Q, ctx: Ctx, doc: QuoteDocument, stored?: QuoteInput | null): Promise<QuoteInput> {
  const asOf = today();
  const lines: QuoteLineInput[] = [];
  const mixIds = doc.lines.map((l) => l.mixRevisionId);
  const mixRevs = await loadMixRevs(q, ctx.tenantId, mixIds);
  const pinned = doc.pinnedReference && stored;
  const policies = pinned ? [] : await loadPolicies(q, ctx.tenantId, asOf);
  for (const l of doc.lines) {
    const mr = mixRevs.get(l.mixRevisionId);
    if (!mr) throw unprocessable('A selected mix revision does not exist in this company.', { path: `lines.${l.id}` });
    const storedLine = stored?.lines.find((x) => x.mixRevisionId === l.mixRevisionId);
    if (pinned && !storedLine) throw unprocessable('This revision is pinned to earlier prices; use "Reprice as new revision" to add mixes at current prices.');
    if (!pinned && mr.status !== 'approved') throw unprocessable(`Mix ${mr.code} rev ${mr.revNo} is not approved and cannot be quoted.`, { path: `lines.${l.id}` });
    lines.push({
      id: l.id, mixRevisionId: mr.id, mixCode: mr.code, mixName: mr.nameEn, quantityM3: l.quantityM3, ingredients: pinned ? storedLine!.ingredients : mr.ingredients,
      policy: pinned ? storedLine!.policy : doc.plantId ? resolvePolicy(policies, mr.mixId, doc.plantId) : null,
      priceOverride: l.priceOverride, costOverride: l.costOverride,
    });
  }
  const services = doc.services as ServiceInput[];
  if (pinned) return { ...stored!, scope: doc.scope, lines, services };
  if (!doc.plantId) throw unprocessable('Select the supplying plant.', { path: 'plantId' });
  const materials = await loadMaterials(q, ctx.tenantId);
  const prices = await loadPrices(q, ctx.tenantId, doc.plantId, asOf);
  const plantCost = await loadPlantCost(q, ctx.tenantId, doc.plantId, asOf);
  const forecast = await loadForecast(q, ctx.tenantId, doc.plantId, asOf);
  const taxRowDb = await loadTax(q, ctx.tenantId, asOf, doc.taxPolicyId);
  return {
    asOf, scope: doc.scope, staleAfterDays: ctx.tenantSettings.staleAfterDays, rounding: { internalDp: ctx.tenantSettings.internalDp },
    materials, prices, plantCost, forecast, lines, services, tax: taxRowDb ? taxRow(taxRowDb) : null,
  };
}

export function fingerprint(r: QuoteResult, doc: QuoteDocument) {
  return sha({ p: [...r.versions.priceVersionIds].sort(), pc: r.versions.plantCostVersionId, f: r.versions.forecastVersionId, pol: [...r.versions.policyIds].sort(), tax: r.versions.taxPolicyId, scope: doc.scope });
}

/** Strip confidential fields unless the caller may see costs. */
export function viewResult(r: QuoteResult | null, ctx: Ctx) {
  if (!r) return null;
  if (has(ctx, 'cost.view')) return r;
  return {
    ...r,
    lines: r.lines.map(({ internal: _i, ...l }) => l),
    internal: undefined,
    issues: r.issues.map(({ detail: _d, ...i }) => i),
    approvals: r.approvals.map(({ detail: _d, ...a }) => a),
    versions: { ...r.versions, priceVersionIds: [] },
  };
}

export async function calc(q: Q, ctx: Ctx, doc: QuoteDocument, stored?: QuoteInput | null) {
  const input = await buildInput(q, ctx, doc, stored);
  const result = priceQuotation(input);
  return { input, result, fingerprint: fingerprint(result, doc) };
}

async function nextNumber(tx: Tx, tenantId: string) {
  const year = new Date().getFullYear();
  const key = `quote-${year}`;
  const [row] = await tx.insert(schema.numberSequences).values({ tenantId, key, last: 1 }).onConflictDoUpdate({ target: [schema.numberSequences.tenantId, schema.numberSequences.key], set: { last: sql`${schema.numberSequences.last} + 1` } }).returning();
  return `Q-${year}-${String(row!.last).padStart(5, '0')}`;
}

function checkPermissions(ctx: Ctx, doc: QuoteDocument) {
  if (doc.plantId && !plantAllowed(ctx, doc.plantId)) throw forbidden('This plant is outside your plant scope.');
  const hasPrice = doc.lines.some((l) => l.priceOverride) || doc.services.some((s) => (s as any).rateOverride);
  const hasCost = doc.lines.some((l) => l.costOverride);
  if (hasPrice && !has(ctx, 'quote.override_price')) throw forbidden('You are not permitted to override prices.');
  if (hasCost && !has(ctx, 'quote.override_cost')) throw forbidden('You are not permitted to override costs.');
}

export async function loadQuote(q: Q, ctx: Ctx, id: string) {
  const [qu] = await q.select().from(quotations).where(and(eq(quotations.tenantId, ctx.tenantId), eq(quotations.id, id)));
  if (!qu) throw new HttpError(404, 'not_found', 'Quotation not found');
  if (!(has(ctx, 'quote.view_all') || qu.ownerMembershipId === ctx.membershipId)) throw new HttpError(404, 'not_found', 'Quotation not found');
  if (qu.plantId && !plantAllowed(ctx, qu.plantId)) throw new HttpError(404, 'not_found', 'Quotation not found');
  return qu;
}
export async function loadRevision(q: Q, ctx: Ctx, quotationId: string, revNo: number, lock = false) {
  const base = q.select().from(quotationRevisions).where(and(eq(quotationRevisions.tenantId, ctx.tenantId), eq(quotationRevisions.quotationId, quotationId), eq(quotationRevisions.revNo, revNo)));
  const [rev] = await (lock ? base.for('update') : base);
  if (!rev) throw new HttpError(404, 'not_found', 'Revision not found');
  return rev;
}

async function writeLines(tx: Tx, ctx: Ctx, revisionId: string, doc: QuoteDocument, result: QuoteResult) {
  await tx.delete(quotationLines).where(eq(quotationLines.revisionId, revisionId));
  await tx.delete(serviceCharges).where(eq(serviceCharges.revisionId, revisionId));
  if (doc.lines.length) await tx.insert(quotationLines).values(doc.lines.map((l, i) => ({
    id: l.id, tenantId: ctx.tenantId, revisionId, position: i, mixRevisionId: l.mixRevisionId, quantityM3: /^\d+(\.\d{1,3})?$/.test(l.quantityM3) ? l.quantityM3 : null,
    priceOverride: l.priceOverride, costOverride: l.costOverride,
  })));
  if (doc.services.length) await tx.insert(serviceCharges).values(doc.services.map((s, i) => ({
    id: s.id, tenantId: ctx.tenantId, revisionId, position: i, type: s.type, params: s, amount: result.services.find((x) => x.id === s.id)?.amount ?? null,
  })));
}

async function applyHeader(tx: Tx, ctx: Ctx, quotationId: string, doc: QuoteDocument, status?: QuoteStatus) {
  await tx.update(quotations).set({ clientId: doc.clientId, projectId: doc.projectId, plantId: doc.plantId, updatedAt: new Date(), ...(status ? { status } : {}) })
    .where(and(eq(quotations.tenantId, ctx.tenantId), eq(quotations.id, quotationId)));
}

export interface SaveOutcome { quotationId: string; revNo: number; version: number; createdNewRevision: boolean; created: boolean }

/**
 * Create or update a draft. Optimistic concurrency via baseVersion. Editing a frozen revision creates a new
 * draft revision (and invalidates any pending approval on the old one).
 */
export async function saveDraft(tx: Tx, ctx: Ctx, args: { quotationId: string; revNo: number; baseVersion: number; doc: QuoteDocument; create?: boolean }): Promise<SaveOutcome & { result: QuoteResult; fingerprint: string }> {
  checkPermissions(ctx, args.doc);
  let created = false;
  let [qu] = await tx.select().from(quotations).where(and(eq(quotations.tenantId, ctx.tenantId), eq(quotations.id, args.quotationId)));
  if (!qu) {
    if (!args.create) throw new HttpError(404, 'not_found', 'Quotation not found');
    if (!has(ctx, 'quote.create')) throw forbidden();
    // the id may be client generated (offline). A foreign tenant's id collides on the PK → reject
    const [clash] = await tx.select({ id: quotations.id }).from(quotations).where(eq(quotations.id, args.quotationId));
    if (clash) throw new HttpError(409, 'conflict', 'Identifier already in use.');
    const number = await nextNumber(tx, ctx.tenantId);
    [qu] = await tx.insert(quotations).values({ id: args.quotationId, tenantId: ctx.tenantId, number, ownerMembershipId: ctx.membershipId, status: 'draft', latestRevNo: 1 }).returning();
    await tx.insert(quotationRevisions).values({ tenantId: ctx.tenantId, quotationId: qu!.id, revNo: 1, status: 'draft', version: 0, doc: args.doc, createdBy: ctx.userId });
    created = true;
    await audit(tx, ctx, 'quotation', qu!.id, 'created', { number });
  } else {
    if (!(has(ctx, 'quote.view_all') || qu.ownerMembershipId === ctx.membershipId)) throw new HttpError(404, 'not_found', 'Quotation not found');
    if (!has(ctx, 'quote.create')) throw forbidden();
    if (qu.ownerMembershipId !== ctx.membershipId && !has(ctx, 'quote.approve')) throw forbidden('Only the owner can edit this quotation.');
  }
  let rev = await loadRevision(tx, ctx, qu!.id, args.revNo, true);
  let createdNew = false;
  if (rev.status !== 'draft') {
    // editing a submitted/frozen revision => new draft revision, old approval invalidated
    if (rev.revNo !== qu!.latestRevNo) throw conflict('This revision is no longer the latest.', { latestRevNo: qu!.latestRevNo });
    rev = await createRevisionFrom(tx, ctx, qu!, rev, 'edit');
    createdNew = true;
  } else if (rev.version !== args.baseVersion) {
    throw conflict('This draft was changed elsewhere.', { serverVersion: rev.version, serverDoc: rev.doc, revNo: rev.revNo });
  }
  const stored = args.doc.pinnedReference ? ((rev.reference as QuoteInput | null) ?? null) : null;
  const { input, result, fingerprint: fp } = await calc(tx, ctx, { ...args.doc }, stored).catch((e) => {
    // incomplete drafts (no plant yet etc.) must still be saveable
    if (e instanceof HttpError && e.status === 422) return { input: null as any, result: null as any, fingerprint: '' };
    throw e;
  });
  await writeLines(tx, ctx, rev.id, args.doc, result ?? ({ services: [] } as any));
  const [upd] = await tx.update(quotationRevisions).set({ doc: args.doc, result: result ?? null, reference: input ?? null, version: rev.version + 1, updatedAt: new Date() })
    .where(eq(quotationRevisions.id, rev.id)).returning();
  await applyHeader(tx, ctx, qu!.id, args.doc, 'draft');
  return { quotationId: qu!.id, revNo: rev.revNo, version: upd!.version, createdNewRevision: createdNew, created, result: result, fingerprint: fp };
}

export async function createRevisionFrom(tx: Tx, ctx: Ctx, qu: typeof quotations.$inferSelect, from: typeof quotationRevisions.$inferSelect, why: 'edit' | 'revise' | 'reprice') {
  const newNo = qu.latestRevNo + 1;
  const doc = { ...(from.doc as QuoteDocument) };
  doc.pinnedReference = why === 'reprice' ? false : why === 'revise' ? true : (from.doc as QuoteDocument).pinnedReference;
  if (from.status === 'pending_approval') {
    await tx.update(approvalRequests).set({ status: 'invalidated', decidedAt: new Date(), comment: 'Revision edited; approval invalidated.' }).where(and(eq(approvalRequests.revisionId, from.id), eq(approvalRequests.status, 'pending')));
  }
  if (['draft', 'pending_approval', 'approved', 'returned'].includes(from.status)) {
    await tx.update(quotationRevisions).set({ status: 'superseded', updatedAt: new Date() }).where(eq(quotationRevisions.id, from.id));
  } else if (from.status === 'issued') {
    await tx.update(quotationRevisions).set({ status: 'superseded', updatedAt: new Date() }).where(eq(quotationRevisions.id, from.id));
  }
  const [nr] = await tx.insert(quotationRevisions).values({
    tenantId: ctx.tenantId, quotationId: qu.id, revNo: newNo, status: 'draft', version: 0, doc, reference: doc.pinnedReference ? (from.snapshot as any)?.internal?.input ?? from.reference : null, parentRevNo: from.revNo, createdBy: ctx.userId,
  }).returning();
  await tx.update(quotations).set({ latestRevNo: newNo, status: 'draft', updatedAt: new Date() }).where(eq(quotations.id, qu.id));
  await audit(tx, ctx, 'quotation', qu.id, `revision_created_${why}`, { from: from.revNo, to: newNo, previousStatus: from.status });
  return nr!;
}

export interface Blocker { code: string; message: string }

/** Everything that must hold before a revision can leave draft. */
export async function submissionBlockers(tx: Q, ctx: Ctx, doc: QuoteDocument, result: QuoteResult | null): Promise<Blocker[]> {
  const b: Blocker[] = [];
  if (!doc.clientId) b.push({ code: 'client_missing', message: 'Select a client.' });
  if (!doc.projectId) b.push({ code: 'project_missing', message: 'Select a project.' });
  if (!doc.plantId) b.push({ code: 'plant_missing', message: 'Select the supplying plant.' });
  if (!doc.termsVersionId) b.push({ code: 'terms_missing', message: 'Select an approved terms version.' });
  if (!doc.paymentTerms.trim()) b.push({ code: 'payment_terms_missing', message: 'Enter the payment terms.' });
  if (!result) b.push({ code: 'not_calculable', message: 'The quotation could not be calculated.' });
  else for (const i of result.issues) if (i.severity === 'error' && i.code !== 'tax_unverified') b.push({ code: i.code, message: i.message });
  return b;
}
export async function issueBlockers(tx: Q, ctx: Ctx, doc: QuoteDocument, rev: typeof quotationRevisions.$inferSelect): Promise<Blocker[]> {
  const b: Blocker[] = [];
  if (rev.status !== 'approved') b.push({ code: 'not_approved', message: 'The revision must be approved before it can be issued.' });
  const snap: any = rev.snapshot;
  const taxId = snap?.customer?.totals?.tax?.policyId;
  if (taxId) {
    const [t] = await tx.select().from(taxPolicyVersions).where(and(eq(taxPolicyVersions.tenantId, ctx.tenantId), eq(taxPolicyVersions.id, taxId)));
    if (!t || t.status !== 'verified') b.push({ code: 'tax_unverified', message: 'Tax policy requires verification before issue.' });
  } else b.push({ code: 'tax_missing', message: 'No tax policy is recorded for this revision.' });
  if (doc.termsVersionId) {
    const [tv] = await tx.select().from(termsVersions).where(and(eq(termsVersions.tenantId, ctx.tenantId), eq(termsVersions.id, doc.termsVersionId)));
    if (!tv || tv.status !== 'approved') b.push({ code: 'terms_unapproved', message: 'The selected terms version has not been approved.' });
  }
  return b;
}

export async function submitRevision(tx: Tx, ctx: Ctx, quotationId: string, revNo: number, opts: { expectedFingerprint?: string; acknowledgeChanges?: boolean }) {
  const qu = await loadQuote(tx, ctx, quotationId);
  const rev = await loadRevision(tx, ctx, quotationId, revNo, true);
  if (qu.ownerMembershipId !== ctx.membershipId && !has(ctx, 'quote.approve')) throw forbidden();
  if (!has(ctx, 'quote.create')) throw forbidden();
  if (!canTransition(rev.status as QuoteStatus, 'pending_approval')) throw conflict(`A ${rev.status.replace('_', ' ')} revision cannot be submitted.`);
  if (rev.revNo !== qu.latestRevNo) throw conflict('Only the latest revision can be submitted.');
  const doc = rev.doc as QuoteDocument;
  checkPermissions(ctx, doc);
  const stored = doc.pinnedReference ? (rev.reference as QuoteInput) : null;
  const { input, result, fingerprint: fp } = await calc(tx, ctx, doc, stored);
  if (opts.expectedFingerprint && opts.expectedFingerprint !== fp && !opts.acknowledgeChanges) {
    throw conflict('Prices or policies changed since you last reviewed this quotation. Review the updated totals and submit again.', { code: 'reference_changed', fingerprint: fp, total: result.customer.total });
  }
  const blockers = await submissionBlockers(tx, ctx, doc, result);
  if (blockers.length) throw unprocessable('The quotation is not ready to submit.', { blockers });
  const [client] = await tx.select().from(clients).where(and(eq(clients.tenantId, ctx.tenantId), eq(clients.id, doc.clientId!)));
  const [project] = await tx.select().from(projects).where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, doc.projectId!)));
  const [plant] = await tx.select().from(plants).where(and(eq(plants.tenantId, ctx.tenantId), eq(plants.id, doc.plantId!)));
  const [terms] = await tx.select().from(termsVersions).where(and(eq(termsVersions.tenantId, ctx.tenantId), eq(termsVersions.id, doc.termsVersionId!)));
  if (!client || !project || !plant || !terms) throw unprocessable('Client, project, plant or terms not found in this company.');
  const mixRevs = await loadMixRevs(tx, ctx.tenantId, doc.lines.map((l) => l.mixRevisionId));
  const [taxRowDb] = result.customer.tax ? await tx.select().from(taxPolicyVersions).where(and(eq(taxPolicyVersions.tenantId, ctx.tenantId), eq(taxPolicyVersions.id, result.customer.tax.policyId))) : [];
  const frozenAt = new Date();
  const snapshot = {
    customer: {
      quotationNumber: qu.number, revNo, frozenAt: frozenAt.toISOString(), client: { name: client.name, taxNumber: client.taxNumber }, project: { name: project.name, siteAddress: project.siteAddress },
      plant: { code: plant.code, nameEn: plant.nameEn, nameAr: plant.nameAr, address: plant.address }, scope: doc.scope, validityDays: doc.validityDays,
      paymentTerms: doc.paymentTerms, supplySchedule: doc.supplySchedule, customerNotes: doc.customerNotes,
      terms: { id: terms.id, version: terms.version, name: terms.name, clauses: terms.clauses },
      company: ctx.tenantSettings.company,
      mixes: doc.lines.map((l) => { const m = mixRevs.get(l.mixRevisionId)!; return { lineId: l.id, mixRevisionId: m.id, code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, grade: m.grade, revNo: m.revNo, spec: m.spec }; }),
      lines: result.lines.map((l) => ({ id: l.id, mixRevisionId: l.mixRevisionId, mixCode: l.mixCode, mixName: l.mixName, quantityM3: l.quantityM3, customerRatePerM3: l.customerRatePerM3, amount: l.amount })),
      services: result.services, totals: result.customer,
      taxPolicy: taxRowDb ? { id: taxRowDb.id, name: taxRowDb.name, status: taxRowDb.status, ratePct: taxRowDb.ratePct, verifiedAt: taxRowDb.verifiedAt, verificationReference: taxRowDb.verificationReference } : null,
    },
    internal: {
      input, result: { lines: result.lines.map((l) => l.internal), internal: result.internal, issues: result.issues, approvals: result.approvals }, versions: result.versions,
      mixRevisions: doc.lines.map((l) => ({ lineId: l.id, ...mixRevs.get(l.mixRevisionId)! })), internalNotes: doc.internalNotes, fingerprint: fp,
    },
  };
  const snapshotHash = sha(snapshot);
  const approvals = result.approvals;
  const needsApproval = approvals.length > 0;
  const newStatus: QuoteStatus = needsApproval ? 'pending_approval' : 'approved';
  await tx.update(quotationRevisions).set({ status: newStatus, snapshot, snapshotHash, frozenAt, result, reference: input, submittedBy: ctx.userId, updatedAt: new Date(), version: rev.version + 1 }).where(eq(quotationRevisions.id, rev.id));
  await tx.update(quotations).set({ status: newStatus, updatedAt: new Date() }).where(eq(quotations.id, qu.id));
  let approvalId: string | null = null;
  if (needsApproval) {
    const [ar] = await tx.insert(approvalRequests).values({ tenantId: ctx.tenantId, quotationId: qu.id, revisionId: rev.id, reasons: approvals, requestedBy: ctx.userId }).returning();
    approvalId = ar!.id;
  }
  await audit(tx, ctx, 'quotation', qu.id, needsApproval ? 'submitted_for_approval' : 'submitted_auto_approved', { revNo, snapshotHash, reasons: approvals.map((a) => a.code) });
  return { status: newStatus, snapshotHash, approvalId, reasons: approvals };
}

export async function decideApproval(tx: Tx, ctx: Ctx, quotationId: string, revNo: number, decision: 'approved' | 'returned', comment: string) {
  if (!has(ctx, 'quote.approve')) throw forbidden();
  const qu = await loadQuote(tx, ctx, quotationId);
  const rev = await loadRevision(tx, ctx, quotationId, revNo, true);
  if (rev.status !== 'pending_approval') throw conflict(`This revision is ${rev.status.replace('_', ' ')}, not awaiting approval.`);
  const [ar] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.revisionId, rev.id), eq(approvalRequests.status, 'pending'))).for('update');
  if (!ar) throw conflict('No pending approval request for this revision.');
  if (ctx.tenantSettings.separateQuoteSubmitterApprover && ar.requestedBy === ctx.userId) throw forbidden('A different user must approve a quotation you submitted.');
  if (decision === 'returned' && !comment.trim()) throw unprocessable('Explain what needs to change when returning for changes.');
  await tx.update(approvalRequests).set({ status: decision, decidedBy: ctx.userId, decidedAt: new Date(), comment }).where(eq(approvalRequests.id, ar.id));
  await tx.update(quotationRevisions).set({ status: decision, updatedAt: new Date(), version: rev.version + 1 }).where(eq(quotationRevisions.id, rev.id));
  await tx.update(quotations).set({ status: decision, updatedAt: new Date() }).where(eq(quotations.id, qu.id));
  await audit(tx, ctx, 'quotation', qu.id, decision === 'approved' ? 'approved' : 'returned_for_changes', { revNo, comment, snapshotHash: rev.snapshotHash });
}

export async function issueRevision(tx: Tx, ctx: Ctx, quotationId: string, revNo: number, pdfSha: string | null) {
  if (!has(ctx, 'quote.issue') && !has(ctx, 'quote.approve')) throw forbidden();
  const qu = await loadQuote(tx, ctx, quotationId);
  const rev = await loadRevision(tx, ctx, quotationId, revNo, true);
  if (!canTransition(rev.status as QuoteStatus, 'issued')) throw conflict(`A ${rev.status.replace('_', ' ')} revision cannot be issued.`);
  const blockers = await issueBlockers(tx, ctx, rev.doc as QuoteDocument, rev);
  if (blockers.length) throw unprocessable('The quotation cannot be issued yet.', { blockers });
  const now = new Date();
  const days = (rev.doc as QuoteDocument).validityDays;
  const validUntil = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  await tx.update(quotationRevisions).set({ status: 'issued', issuedAt: now, issuedBy: ctx.userId, validUntil, pdfSha256: pdfSha, updatedAt: new Date(), version: rev.version + 1 }).where(eq(quotationRevisions.id, rev.id));
  await tx.update(quotations).set({ status: 'issued', updatedAt: now }).where(eq(quotations.id, qu.id));
  await audit(tx, ctx, 'quotation', qu.id, 'issued', { revNo, validUntil, pdfSha256: pdfSha, snapshotHash: rev.snapshotHash });
  return { validUntil };
}

export async function recordOutcome(tx: Tx, ctx: Ctx, quotationId: string, revNo: number, o: { outcome: 'accepted' | 'declined' | 'expired'; lostReason?: string; competitorNote?: string }) {
  const qu = await loadQuote(tx, ctx, quotationId);
  if (qu.ownerMembershipId !== ctx.membershipId && !has(ctx, 'quote.approve')) throw forbidden();
  const rev = await loadRevision(tx, ctx, quotationId, revNo, true);
  if (!canTransition(rev.status as QuoteStatus, o.outcome)) throw conflict(`Cannot record "${o.outcome}" for a ${rev.status.replace('_', ' ')} revision.`);
  if (o.outcome === 'declined' && !o.lostReason?.trim()) throw unprocessable('Enter the reason the quotation was lost.');
  await tx.update(quotationRevisions).set({ status: o.outcome, updatedAt: new Date(), version: rev.version + 1 }).where(eq(quotationRevisions.id, rev.id));
  await tx.update(quotations).set({ status: o.outcome, lostReason: o.lostReason ?? null, competitorNote: o.competitorNote ?? null, outcomeAt: new Date(), updatedAt: new Date() }).where(eq(quotations.id, qu.id));
  await audit(tx, ctx, 'quotation', qu.id, `outcome_${o.outcome}`, { revNo, lostReason: o.lostReason, competitorNote: o.competitorNote });
}

export async function cancelQuotation(tx: Tx, ctx: Ctx, quotationId: string, revNo: number, reason: string) {
  const qu = await loadQuote(tx, ctx, quotationId);
  if (qu.ownerMembershipId !== ctx.membershipId && !has(ctx, 'quote.approve')) throw forbidden();
  const rev = await loadRevision(tx, ctx, quotationId, revNo, true);
  if (!canTransition(rev.status as QuoteStatus, 'cancelled')) throw conflict(`A ${rev.status.replace('_', ' ')} revision cannot be cancelled.`);
  await tx.update(approvalRequests).set({ status: 'cancelled', decidedAt: new Date() }).where(and(eq(approvalRequests.revisionId, rev.id), eq(approvalRequests.status, 'pending')));
  await tx.update(quotationRevisions).set({ status: 'cancelled', updatedAt: new Date(), version: rev.version + 1 }).where(eq(quotationRevisions.id, rev.id));
  await tx.update(quotations).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(quotations.id, qu.id));
  await audit(tx, ctx, 'quotation', qu.id, 'cancelled', { revNo, reason });
}

/** Lazily mark issued quotations past validity as expired. */
export async function expireOverdue(q: Db, tenantId: string) {
  const rows = await q.select({ id: quotationRevisions.id, qid: quotationRevisions.quotationId }).from(quotationRevisions)
    .where(and(eq(quotationRevisions.tenantId, tenantId), eq(quotationRevisions.status, 'issued'), sql`${quotationRevisions.validUntil} < current_date`));
  if (!rows.length) return;
  await q.transaction(async (tx) => {
    for (const r of rows) {
      await tx.update(quotationRevisions).set({ status: 'expired', updatedAt: new Date() }).where(and(eq(quotationRevisions.id, r.id), eq(quotationRevisions.status, 'issued')));
      await tx.update(quotations).set({ status: 'expired' }).where(and(eq(quotations.id, r.qid), eq(quotations.status, 'issued')));
      await audit(tx, { tenantId, userId: null, userName: 'system' }, 'quotation', r.qid, 'expired', {});
    }
  });
}
export { previewCustomerTotals };
