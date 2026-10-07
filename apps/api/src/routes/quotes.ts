import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { decisionInput, outcomeInput, quoteDocument, saveDraftInput, syncOperationInput, uuid, canTransition, type QuoteDocument, type QuoteStatus } from '@rm/shared';
import { previewCustomerTotals } from '@rm/engine';
import { db, schema } from '../db/client.js';
import { audit } from '../services/audit.js';
import { conflict, ctxOf, forbidden, has, HttpError, need, parse, plantAllowed, unprocessable, wrap, type Ctx } from '../http.js';
import * as Q from '../services/quotes.js';
import { priceMixAtPlant } from './catalog.js';
import { loadForecast, loadMaterials, loadMixRevs, loadPlantCost, loadPolicies, loadTax, resolvePolicy, taxRow, today } from '../services/reference.js';
import { quotationHtml, renderPdf, sha256Hex, type PdfLang } from '../services/pdf.js';

export const quoteRouter = Router();
const S = schema;
const rid = (v: unknown) => String(v);

function stripSnapshot(snap: any, ctx: Ctx) {
  if (!snap) return snap;
  return has(ctx, 'cost.view') ? snap : { customer: snap.customer };
}
function allowedActions(ctx: Ctx, qu: typeof S.quotations.$inferSelect, rev: typeof S.quotationRevisions.$inferSelect) {
  const mine = qu.ownerMembershipId === ctx.membershipId;
  const st = rev.status as QuoteStatus;
  const latest = rev.revNo === qu.latestRevNo;
  const canEdit = has(ctx, 'quote.create') && (mine || has(ctx, 'quote.approve')) && latest;
  return {
    edit: canEdit && ['draft'].includes(st), reviseFromFrozen: canEdit && ['pending_approval', 'approved', 'returned'].includes(st),
    submit: canEdit && st === 'draft', approve: has(ctx, 'quote.approve') && st === 'pending_approval' && !(ctx.tenantSettings.separateQuoteSubmitterApprover && rev.submittedBy === ctx.userId),
    approveBlockedReason: has(ctx, 'quote.approve') && st === 'pending_approval' && ctx.tenantSettings.separateQuoteSubmitterApprover && rev.submittedBy === ctx.userId ? 'A different user must approve a quotation you submitted.' : null,
    return: has(ctx, 'quote.approve') && st === 'pending_approval', issue: (has(ctx, 'quote.issue') || has(ctx, 'quote.approve')) && st === 'approved' && latest,
    outcome: (mine || has(ctx, 'quote.approve')) && st === 'issued', revise: canEdit && ['issued', 'declined', 'expired'].includes(st), reprice: canEdit && ['issued', 'approved', 'declined', 'expired', 'returned'].includes(st),
    cancel: (mine || has(ctx, 'quote.approve')) && canTransition(st, 'cancelled'), pdf: !!rev.snapshot,
  };
}
async function revisionPayload(ctx: Ctx, qu: typeof S.quotations.$inferSelect, rev: typeof S.quotationRevisions.$inferSelect) {
  const doc = rev.doc as QuoteDocument;
  const [client] = qu.clientId ? await db.select().from(S.clients).where(and(eq(S.clients.tenantId, ctx.tenantId), eq(S.clients.id, qu.clientId))) : [];
  const [project] = qu.projectId ? await db.select().from(S.projects).where(and(eq(S.projects.tenantId, ctx.tenantId), eq(S.projects.id, qu.projectId))) : [];
  const [plant] = qu.plantId ? await db.select().from(S.plants).where(and(eq(S.plants.tenantId, ctx.tenantId), eq(S.plants.id, qu.plantId))) : [];
  const approvals = await db.select({ a: S.approvalRequests, u: S.users }).from(S.approvalRequests).leftJoin(S.users, eq(S.users.id, S.approvalRequests.requestedBy)).where(and(eq(S.approvalRequests.tenantId, ctx.tenantId), eq(S.approvalRequests.revisionId, rev.id))).orderBy(desc(S.approvalRequests.requestedAt));
  const result = rev.result as any;
  const blockers = rev.status === 'draft' ? await Q.submissionBlockers(db, ctx, doc, result) : [];
  const issueB = rev.status === 'approved' ? await Q.issueBlockers(db, ctx, doc, rev) : [];
  const fp = result ? Q.fingerprint(result, doc) : null;
  return {
    quotation: { id: qu.id, number: qu.number, status: qu.status, latestRevNo: qu.latestRevNo, lostReason: qu.lostReason, competitorNote: qu.competitorNote, ownerMembershipId: qu.ownerMembershipId, clientName: client?.name ?? null, projectName: project?.name ?? null, plantCode: plant?.code ?? null },
    revision: {
      revNo: rev.revNo, status: rev.status, version: rev.version, doc: has(ctx, 'cost.view') ? doc : { ...doc, internalNotes: doc.internalNotes && (qu.ownerMembershipId === ctx.membershipId || has(ctx, 'quote.approve')) ? doc.internalNotes : '' },
      result: Q.viewResult(result, ctx), frozenAt: rev.frozenAt, issuedAt: rev.issuedAt, validUntil: rev.validUntil, snapshotHash: rev.snapshotHash, pdfSha256: rev.pdfSha256, parentRevNo: rev.parentRevNo, fingerprint: fp, pinned: doc.pinnedReference,
      snapshot: stripSnapshot(rev.snapshot, ctx),
    },
    blockers, issueBlockers: issueB, approvals: approvals.map(({ a, u }) => ({ id: a.id, status: a.status, reasons: (a.reasons as any[]).map((r) => (has(ctx, 'cost.view') ? r : { code: r.code, message: r.message })), requestedBy: u?.name, requestedAt: a.requestedAt, decidedAt: a.decidedAt, comment: a.comment })),
    actions: allowedActions(ctx, qu, rev),
  };
}

// ---------- list ----------
quoteRouter.get('/quotations', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  await Q.expireOverdue(db, ctx.tenantId);
  const q = z.object({ q: z.string().optional(), status: z.string().optional(), plantId: uuid.optional(), owner: z.string().optional(), from: z.string().optional(), to: z.string().optional(), view: z.enum(['mine', 'all', 'attention']).default('all') }).parse(req.query);
  const rows = await db.select({ qu: S.quotations, rev: S.quotationRevisions, client: S.clients.name, project: S.projects.name, plant: S.plants.code, owner: S.users.name }).from(S.quotations)
    .innerJoin(S.quotationRevisions, and(eq(S.quotationRevisions.quotationId, S.quotations.id), eq(S.quotationRevisions.revNo, S.quotations.latestRevNo), eq(S.quotationRevisions.tenantId, S.quotations.tenantId)))
    .leftJoin(S.clients, and(eq(S.clients.id, S.quotations.clientId), eq(S.clients.tenantId, S.quotations.tenantId)))
    .leftJoin(S.projects, and(eq(S.projects.id, S.quotations.projectId), eq(S.projects.tenantId, S.quotations.tenantId)))
    .leftJoin(S.plants, and(eq(S.plants.id, S.quotations.plantId), eq(S.plants.tenantId, S.quotations.tenantId)))
    .innerJoin(S.memberships, eq(S.memberships.id, S.quotations.ownerMembershipId)).innerJoin(S.users, eq(S.users.id, S.memberships.userId))
    .where(and(eq(S.quotations.tenantId, ctx.tenantId), has(ctx, 'quote.view_all') ? undefined : eq(S.quotations.ownerMembershipId, ctx.membershipId))).orderBy(desc(S.quotations.updatedAt));
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let out = rows.filter((r) => plantAllowed(ctx, r.qu.plantId)).map((r) => {
    const res = r.rev.result as any;
    return { id: r.qu.id, number: r.qu.number, revNo: r.rev.revNo, status: r.qu.status, client: r.client, project: r.project, plantCode: r.plant, plantId: r.qu.plantId, volumeM3: res?.customer?.totalVolumeM3 ?? null, preTaxTotal: res?.customer?.subtotalExTax ?? null,
      validUntil: r.rev.validUntil, owner: r.owner, ownerMembershipId: r.qu.ownerMembershipId, updatedAt: r.qu.updatedAt, createdAt: r.qu.createdAt,
      attention: r.qu.status === 'returned' || (r.qu.status === 'issued' && r.rev.validUntil && r.rev.validUntil <= soon) || (r.qu.status === 'draft' && res?.issues?.some((i: any) => i.severity === 'error')) || (r.qu.status === 'pending_approval' && has(ctx, 'quote.approve')) };
  });
  if (q.view === 'mine') out = out.filter((r) => r.ownerMembershipId === ctx.membershipId);
  if (q.view === 'attention') out = out.filter((r) => r.attention);
  if (q.status) out = out.filter((r) => q.status!.split(',').includes(r.status));
  if (q.plantId) out = out.filter((r) => r.plantId === q.plantId);
  if (q.owner) out = out.filter((r) => r.ownerMembershipId === (q.owner === 'me' ? ctx.membershipId : q.owner));
  if (q.from) out = out.filter((r) => r.createdAt.toISOString().slice(0, 10) >= q.from!);
  if (q.to) out = out.filter((r) => r.createdAt.toISOString().slice(0, 10) <= q.to!);
  if (q.q) { const n = q.q.toLowerCase(); out = out.filter((r) => [r.number, r.client, r.project].some((v) => v?.toLowerCase().includes(n))); }
  res.json(out);
}));

// ---------- create / save ----------
quoteRouter.post('/quotations', wrap(async (req, res) => {
  const ctx = need(req, 'quote.create');
  const full = parse(quoteDocument, { clientId: null, projectId: null, plantId: null, validityDays: ctx.tenantSettings.defaultValidityDays, ...(req.body?.doc ?? {}) });
  const id = crypto.randomUUID();
  const out = await db.transaction((tx) => Q.saveDraft(tx, ctx, { quotationId: id, revNo: 1, baseVersion: 0, doc: full, create: true }));
  res.status(201).json({ id, ...out, result: Q.viewResult(out.result, ctx) });
}));
quoteRouter.put('/quotations/:id/revisions/:revNo', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(saveDraftInput, req.body);
  const out = await db.transaction((tx) => Q.saveDraft(tx, ctx, { quotationId: rid(req.params.id), revNo: Number(req.params.revNo), baseVersion: b.baseVersion, doc: b.doc }));
  res.json({ ...out, result: Q.viewResult(out.result, ctx) });
}));
quoteRouter.get('/quotations/:id', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const qu = await Q.loadQuote(db, ctx, rid(req.params.id));
  const revs = await db.select({ revNo: S.quotationRevisions.revNo, status: S.quotationRevisions.status, frozenAt: S.quotationRevisions.frozenAt, issuedAt: S.quotationRevisions.issuedAt, createdAt: S.quotationRevisions.createdAt, parentRevNo: S.quotationRevisions.parentRevNo }).from(S.quotationRevisions).where(and(eq(S.quotationRevisions.tenantId, ctx.tenantId), eq(S.quotationRevisions.quotationId, qu.id))).orderBy(desc(S.quotationRevisions.revNo));
  const rev = await Q.loadRevision(db, ctx, qu.id, qu.latestRevNo);
  res.json({ ...(await revisionPayload(ctx, qu, rev)), revisions: revs });
}));
quoteRouter.get('/quotations/:id/revisions/:revNo', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const qu = await Q.loadQuote(db, ctx, rid(req.params.id));
  const rev = await Q.loadRevision(db, ctx, qu.id, Number(req.params.revNo));
  res.json(await revisionPayload(ctx, qu, rev));
}));

// ---------- transitions ----------
quoteRouter.post('/quotations/:id/revisions/:revNo/submit', wrap(async (req, res) => {
  const ctx = need(req, 'quote.create');
  const b = parse(z.object({ expectedFingerprint: z.string().optional(), acknowledgeChanges: z.boolean().optional() }), req.body ?? {});
  res.json(await db.transaction((tx) => Q.submitRevision(tx, ctx, rid(req.params.id), Number(req.params.revNo), b)));
}));
quoteRouter.post('/quotations/:id/revisions/:revNo/approve', wrap(async (req, res) => {
  const ctx = ctxOf(req); const b = parse(decisionInput, req.body ?? {});
  await db.transaction((tx) => Q.decideApproval(tx, ctx, rid(req.params.id), Number(req.params.revNo), 'approved', b.comment)); res.json({ ok: true });
}));
quoteRouter.post('/quotations/:id/revisions/:revNo/return', wrap(async (req, res) => {
  const ctx = ctxOf(req); const b = parse(decisionInput, req.body ?? {});
  await db.transaction((tx) => Q.decideApproval(tx, ctx, rid(req.params.id), Number(req.params.revNo), 'returned', b.comment)); res.json({ ok: true });
}));
async function pdfFor(ctx: Ctx, quotationId: string, revNo: number, lang: PdfLang) {
  const qu = await Q.loadQuote(db, ctx, quotationId);
  const rev = await Q.loadRevision(db, ctx, qu.id, revNo);
  if (!rev.snapshot) throw conflict('A PDF is available once the revision has been submitted (frozen).');
  const [stored] = await db.select().from(S.quotationPdfs).where(and(eq(S.quotationPdfs.tenantId, ctx.tenantId), eq(S.quotationPdfs.revisionId, rev.id)));
  if (stored && stored.lang === lang) return { bytes: stored.bytes, qu, rev, stored: true };
  const html = quotationHtml(rev.snapshot, { number: qu.number!, issuedAt: rev.issuedAt, validUntil: rev.validUntil, issued: !!rev.issuedAt }, lang);
  return { bytes: await renderPdf(html, lang, `${qu.number} rev ${rev.revNo}`), qu, rev, stored: false };
}
quoteRouter.post('/quotations/:id/revisions/:revNo/issue', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const { lang } = parse(z.object({ lang: z.enum(['en', 'ar']).default('en') }), req.body ?? {});
  // Render first (outside the transaction); the frozen snapshot cannot change underneath us.
  const qu0 = await Q.loadQuote(db, ctx, rid(req.params.id));
  const rev0 = await Q.loadRevision(db, ctx, qu0.id, Number(req.params.revNo));
  if (rev0.status !== 'approved') throw conflict(`A ${rev0.status.replace('_', ' ')} revision cannot be issued.`);
  const pre = await Q.issueBlockers(db, ctx, rev0.doc as QuoteDocument, rev0);
  if (pre.length) throw unprocessable('The quotation cannot be issued yet.', { blockers: pre });
  const days = (rev0.doc as QuoteDocument).validityDays;
  const bytes = await renderPdf(quotationHtml(rev0.snapshot, { number: qu0.number!, issuedAt: new Date(), validUntil: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10), issued: true }, lang), lang, `${qu0.number} rev ${rev0.revNo}`);
  const sha = sha256Hex(bytes);
  const out = await db.transaction(async (tx) => {
    const r = await Q.issueRevision(tx, ctx, rid(req.params.id), Number(req.params.revNo), sha);
    await tx.insert(S.quotationPdfs).values({ revisionId: rev0.id, tenantId: ctx.tenantId, lang, sha256: sha, bytes });
    return r;
  });
  res.json({ ...out, pdfSha256: sha });
}));
quoteRouter.get('/quotations/:id/revisions/:revNo/pdf', wrap(async (req, res) => {
  const ctx = need(req, 'price.view');
  const lang = (req.query.lang === 'ar' ? 'ar' : 'en') as PdfLang;
  const { bytes, qu, rev } = await pdfFor(ctx, rid(req.params.id), Number(req.params.revNo), lang);
  await audit(db, ctx, 'quotation', qu.id, 'pdf_downloaded', { revNo: rev.revNo, lang });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${qu.number}-rev${rev.revNo}-${lang}.pdf"`);
  res.send(bytes);
}));
quoteRouter.post('/quotations/:id/revisions/:revNo/outcome', wrap(async (req, res) => {
  const ctx = ctxOf(req); const b = parse(outcomeInput, req.body);
  await db.transaction((tx) => Q.recordOutcome(tx, ctx, rid(req.params.id), Number(req.params.revNo), b)); res.json({ ok: true });
}));
quoteRouter.post('/quotations/:id/revisions/:revNo/cancel', wrap(async (req, res) => {
  const ctx = ctxOf(req); const { reason } = parse(z.object({ reason: z.string().min(3, 'Enter a reason') }), req.body ?? {});
  await db.transaction((tx) => Q.cancelQuotation(tx, ctx, rid(req.params.id), Number(req.params.revNo), reason)); res.json({ ok: true });
}));
/** revise = new draft revision at the SAME (pinned) prices; reprice = new draft at CURRENT prices. */
quoteRouter.post('/quotations/:id/:action(revise|reprice)', wrap(async (req, res) => {
  const ctx = need(req, 'quote.create');
  const why = req.params.action === 'revise' ? 'revise' : 'reprice';
  const out = await db.transaction(async (tx) => {
    const qu = await Q.loadQuote(tx, ctx, rid(req.params.id));
    if (qu.ownerMembershipId !== ctx.membershipId && !has(ctx, 'quote.approve')) throw forbidden();
    const from = await Q.loadRevision(tx, ctx, qu.id, qu.latestRevNo, true);
    if (from.status === 'draft') {
      // a pinned draft can be switched to current prices in place; otherwise there is nothing to reprice
      const d = from.doc as QuoteDocument;
      if (why === 'reprice' && d.pinnedReference) {
        const nd = { ...d, pinnedReference: false };
        const { input, result } = await Q.calc(tx, ctx, nd);
        await tx.update(S.quotationRevisions).set({ doc: nd, result, reference: input, version: from.version + 1, updatedAt: new Date() }).where(eq(S.quotationRevisions.id, from.id));
        await audit(tx, ctx, 'quotation', qu.id, 'repriced_in_place', { revNo: from.revNo });
        return { revNo: from.revNo, version: from.version + 1, inPlace: true };
      }
      throw conflict('The latest revision is already a draft.');
    }
    if (['accepted', 'cancelled', 'superseded'].includes(from.status)) throw conflict(`A ${from.status} quotation cannot be revised.`);
    const nr = await Q.createRevisionFrom(tx, ctx, qu, from, why);
    if (why === 'reprice') { const { input, result } = await Q.calc(tx, ctx, nr.doc as QuoteDocument).catch(() => ({ input: null, result: null } as any)); await tx.update(S.quotationRevisions).set({ result, reference: input }).where(eq(S.quotationRevisions.id, nr.id)); }
    return { revNo: nr.revNo, version: nr.version, inPlace: false };
  });
  res.status(201).json(out);
}));
quoteRouter.post('/quotations/:id/duplicate', wrap(async (req, res) => {
  const ctx = need(req, 'quote.create');
  const qu = await Q.loadQuote(db, ctx, rid(req.params.id));
  const rev = await Q.loadRevision(db, ctx, qu.id, qu.latestRevNo);
  const doc = { ...(rev.doc as QuoteDocument), pinnedReference: false };
  const id = crypto.randomUUID();
  const out = await db.transaction(async (tx) => {
    const r = await Q.saveDraft(tx, ctx, { quotationId: id, revNo: 1, baseVersion: 0, doc, create: true });
    await audit(tx, ctx, 'quotation', id, 'duplicated_from', { source: qu.number });
    return r;
  });
  res.status(201).json({ id, ...out, result: Q.viewResult(out.result, ctx) });
}));

// ---------- approvals ----------
quoteRouter.get('/approvals', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const canDecide = has(ctx, 'quote.approve');
  const rows = await db.select({ a: S.approvalRequests, qu: S.quotations, rev: S.quotationRevisions, u: S.users, client: S.clients.name }).from(S.approvalRequests)
    .innerJoin(S.quotations, and(eq(S.quotations.id, S.approvalRequests.quotationId), eq(S.quotations.tenantId, S.approvalRequests.tenantId)))
    .innerJoin(S.quotationRevisions, and(eq(S.quotationRevisions.id, S.approvalRequests.revisionId), eq(S.quotationRevisions.tenantId, S.approvalRequests.tenantId)))
    .innerJoin(S.users, eq(S.users.id, S.approvalRequests.requestedBy)).leftJoin(S.clients, and(eq(S.clients.id, S.quotations.clientId), eq(S.clients.tenantId, S.quotations.tenantId)))
    .where(and(eq(S.approvalRequests.tenantId, ctx.tenantId), eq(S.approvalRequests.status, 'pending'))).orderBy(asc(S.approvalRequests.requestedAt));
  res.json(rows.filter((r) => plantAllowed(ctx, r.qu.plantId) && (canDecide || has(ctx, 'quote.view_all') || r.qu.ownerMembershipId === ctx.membershipId)).map((r) => ({
    id: r.a.id, quotationId: r.qu.id, number: r.qu.number, revNo: r.rev.revNo, client: r.client, requestedBy: r.u.name, requestedAt: r.a.requestedAt, mine: r.a.requestedBy === ctx.userId,
    reasons: (r.a.reasons as any[]).map((x) => (has(ctx, 'cost.view') ? x : { code: x.code, message: x.message })), preTaxTotal: (r.rev.result as any)?.customer?.subtotalExTax ?? null,
    marginPct: has(ctx, 'cost.view') ? (r.rev.result as any)?.internal?.marginAfterFullCostPct ?? null : undefined,
  })));
}));

// ---------- sales reference snapshot (customer-facing rates only; cached for offline drafting) ----------
quoteRouter.get('/reference/sales', wrap(async (req, res) => {
  const ctx = need(req, 'price.view');
  const q = z.object({ plantId: uuid.optional() }).parse(req.query);
  const plants = (await db.select().from(S.plants).where(eq(S.plants.tenantId, ctx.tenantId))).filter((p) => plantAllowed(ctx, p.id) && (!q.plantId || p.id === q.plantId));
  const mixes = await db.select().from(S.mixes).where(eq(S.mixes.tenantId, ctx.tenantId));
  const mixPlants = await db.select().from(S.mixPlants).where(eq(S.mixPlants.tenantId, ctx.tenantId));
  const approved = await db.select().from(S.mixRevisions).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), eq(S.mixRevisions.status, 'approved')));
  const taxRows = await db.select().from(S.taxPolicyVersions).where(and(eq(S.taxPolicyVersions.tenantId, ctx.tenantId), inArray(S.taxPolicyVersions.status, ['verified', 'demo'])));
  const terms = await db.select({ id: S.termsVersions.id, version: S.termsVersions.version, name: S.termsVersions.name, status: S.termsVersions.status }).from(S.termsVersions).where(eq(S.termsVersions.tenantId, ctx.tenantId));
  const clients = await db.select().from(S.clients).where(eq(S.clients.tenantId, ctx.tenantId));
  const projects = await db.select().from(S.projects).where(eq(S.projects.tenantId, ctx.tenantId));
  const out: any = { generatedAt: new Date().toISOString(), asOf: today(), plants: [], taxPolicies: taxRows.map((t) => ({ ...taxRow(t), validFrom: t.validFrom })), terms, clients, projects };
  for (const p of plants) {
    const pc = await loadPlantCost(db, ctx.tenantId, p.id, today());
    const rows = [] as any[];
    for (const m of mixes) {
      const rev = approved.find((r) => r.mixId === m.id);
      if (!rev || !mixPlants.some((mp) => mp.mixId === m.id && mp.plantId === p.id)) continue;
      let rate: string | null = null, reason: string | null = null;
      try { const { result } = await priceMixAtPlant(db, ctx, rev.id, p.id, today()); const l = result.lines[0]!; rate = l.calculable ? l.customerRatePerM3 : null; if (!rate) reason = result.issues.find((i) => i.severity === 'error')?.message ?? 'Not priced'; } catch (e) { reason = (e as Error).message; }
      rows.push({ mixRevisionId: rev.id, mixId: m.id, code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, grade: m.grade, revNo: rev.revNo, spec: rev.spec, ratePerM3: rate, unavailableReason: reason });
    }
    // rate card for offline estimates: customer charges only — operating-cost fields are zeroed
    const card = pc ? { ...pc, fixedCosts: [], variableCosts: [], corporateOverheadPerM3: '0', riskProvisionPerM3: '0',
      delivery: { perM3: pc.delivery.perM3 ? { chargePerM3: pc.delivery.perM3.chargePerM3, costPerM3: '0' } : null, zones: (pc.delivery.zones ?? []).map((z) => ({ ...z, costPerM3: '0' })), trip: pc.delivery.trip ? { ...pc.delivery.trip, fixedCostPerTrip: '0', costPerKm: '0' } : null },
      pumping: pc.pumping ? { ...pc.pumping, costPerM3: '0', costPerUnit: '0' } : null } : null;
    out.plants.push({ id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, mixes: rows, rateCard: card });
  }
  out.fingerprint = crypto.createHash('sha256').update(JSON.stringify(out.plants.map((p: any) => [p.id, p.mixes.map((m: any) => [m.mixRevisionId, m.ratePerM3]), p.rateCard && { d: p.rateCard.delivery, p: p.rateCard.pumping }]))).digest('hex');
  res.json(out);
}));

// ---------- offline sync (idempotent) ----------
quoteRouter.post('/sync/operations', wrap(async (req, res) => {
  const ctx = need(req, 'quote.create');
  const op = parse(syncOperationInput, req.body);
  const prior = await db.select().from(S.syncOperations).where(and(eq(S.syncOperations.tenantId, ctx.tenantId), eq(S.syncOperations.userId, ctx.userId), eq(S.syncOperations.idempotencyKey, op.idempotencyKey)));
  if (prior[0]) return res.status(prior[0].status === 'ok' ? 200 : 409).json({ ...(prior[0].response as object), replayed: true });
  try {
    const out = await db.transaction(async (tx) => {
      const r = await Q.saveDraft(tx, ctx, { quotationId: op.quotationId, revNo: op.revNo, baseVersion: op.baseVersion, doc: op.doc, create: op.create });
      const response = { status: 'ok', quotationId: r.quotationId, revNo: r.revNo, version: r.version, createdNewRevision: r.createdNewRevision, result: Q.viewResult(r.result, ctx), fingerprint: r.fingerprint, number: (await tx.select({ n: S.quotations.number }).from(S.quotations).where(eq(S.quotations.id, r.quotationId)))[0]?.n };
      await tx.insert(S.syncOperations).values({ tenantId: ctx.tenantId, userId: ctx.userId, idempotencyKey: op.idempotencyKey, opType: op.type, entityId: r.quotationId, status: 'ok', response });
      return response;
    });
    res.json(out);
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      const response = { status: 'conflict', error: { code: e.code, message: e.message, ...e.extra } };
      await db.insert(S.syncOperations).values({ tenantId: ctx.tenantId, userId: ctx.userId, idempotencyKey: op.idempotencyKey, opType: op.type, entityId: op.quotationId, status: 'conflict', response }).onConflictDoNothing();
      return res.status(409).json(response);
    }
    throw e;
  }
}));

// ---------- clients & projects ----------
export const clientRouter = Router();
clientRouter.get('/clients', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await db.select().from(S.clients).where(eq(S.clients.tenantId, ctx.tenantId)).orderBy(asc(S.clients.name)));
}));
clientRouter.post('/clients', wrap(async (req, res) => {
  const ctx = need(req, 'client.manage');
  const { clientInput } = await import('@rm/shared');
  const b = parse(clientInput, req.body);
  const [c] = await db.insert(S.clients).values({ ...b, tenantId: ctx.tenantId, createdBy: ctx.userId }).returning();
  await audit(db, ctx, 'client', c!.id, 'created', { name: b.name });
  res.status(201).json(c);
}));
clientRouter.put('/clients/:id', wrap(async (req, res) => {
  const ctx = need(req, 'client.manage');
  const { clientInput } = await import('@rm/shared');
  const b = parse(clientInput, req.body);
  const [c] = await db.update(S.clients).set(b).where(and(eq(S.clients.tenantId, ctx.tenantId), eq(S.clients.id, rid(req.params.id)))).returning();
  if (!c) throw new HttpError(404, 'not_found', 'Client not found');
  await audit(db, ctx, 'client', c.id, 'updated', { name: b.name });
  res.json(c);
}));
clientRouter.get('/projects', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  const q = z.object({ clientId: uuid.optional() }).parse(req.query);
  res.json(await db.select().from(S.projects).where(and(eq(S.projects.tenantId, ctx.tenantId), q.clientId ? eq(S.projects.clientId, q.clientId) : undefined)).orderBy(asc(S.projects.name)));
}));
clientRouter.post('/projects', wrap(async (req, res) => {
  const ctx = need(req, 'client.manage');
  const { projectInput } = await import('@rm/shared');
  const b = parse(projectInput, req.body);
  const [p] = await db.insert(S.projects).values({ ...b, tenantId: ctx.tenantId }).returning(); // composite FKs reject other tenants' clients/plants
  await audit(db, ctx, 'project', p!.id, 'created', { name: b.name });
  res.status(201).json(p);
}));
clientRouter.put('/projects/:id', wrap(async (req, res) => {
  const ctx = need(req, 'client.manage');
  const { projectInput } = await import('@rm/shared');
  const b = parse(projectInput, req.body);
  const [p] = await db.update(S.projects).set(b).where(and(eq(S.projects.tenantId, ctx.tenantId), eq(S.projects.id, rid(req.params.id)))).returning();
  if (!p) throw new HttpError(404, 'not_found', 'Project not found');
  res.json(p);
}));
export { previewCustomerTotals };
