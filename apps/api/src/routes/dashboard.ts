import { Router } from 'express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { ctxOf, has, plantAllowed, wrap } from '../http.js';
import { expireOverdue } from '../services/quotes.js';
import { today } from '../services/reference.js';

export const dashboardRouter = Router();
const S = schema;

dashboardRouter.get('/dashboard', wrap(async (req, res) => {
  const ctx = ctxOf(req);
  await expireOverdue(db, ctx.tenantId);
  const rows = await db.select({ qu: S.quotations, rev: S.quotationRevisions, client: S.clients.name, project: S.projects.name }).from(S.quotations)
    .innerJoin(S.quotationRevisions, and(eq(S.quotationRevisions.quotationId, S.quotations.id), eq(S.quotationRevisions.revNo, S.quotations.latestRevNo), eq(S.quotationRevisions.tenantId, S.quotations.tenantId)))
    .leftJoin(S.clients, and(eq(S.clients.id, S.quotations.clientId), eq(S.clients.tenantId, S.quotations.tenantId))).leftJoin(S.projects, and(eq(S.projects.id, S.quotations.projectId), eq(S.projects.tenantId, S.quotations.tenantId)))
    .where(and(eq(S.quotations.tenantId, ctx.tenantId), has(ctx, 'quote.view_all') ? undefined : eq(S.quotations.ownerMembershipId, ctx.membershipId))).orderBy(desc(S.quotations.updatedAt));
  const visible = rows.filter((r) => plantAllowed(ctx, r.qu.plantId));
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const mine = visible.filter((r) => r.qu.ownerMembershipId === ctx.membershipId);
  const brief = (r: (typeof visible)[number]) => ({ id: r.qu.id, number: r.qu.number, revNo: r.rev.revNo, status: r.qu.status, client: r.client, project: r.project, preTaxTotal: (r.rev.result as any)?.customer?.subtotalExTax ?? null, validUntil: r.rev.validUntil, updatedAt: r.qu.updatedAt });
  const out: any = { role: ctx.role, generatedAt: new Date().toISOString() };
  // projected measures — labelled as projections (not realised sales)
  const open = visible.filter((r) => ['pending_approval', 'approved', 'issued'].includes(r.qu.status));
  const sum = (f: (r: (typeof open)[number]) => number) => open.reduce((a, r) => a + f(r), 0);
  out.projected = {
    label: 'Projected from open quotations (pending, approved, issued). Not realised sales or profit.', openQuotations: open.length,
    preTaxValue: sum((r) => Number((r.rev.result as any)?.customer?.subtotalExTax ?? 0)).toFixed(3), volumeM3: sum((r) => Number((r.rev.result as any)?.customer?.totalVolumeM3 ?? 0)).toFixed(3),
    contributionBeforeFixed: has(ctx, 'cost.view') ? sum((r) => Number((r.rev.result as any)?.internal?.contributionBeforeFixed ?? 0)).toFixed(3) : undefined,
  };
  if (has(ctx, 'quote.create')) {
    out.sales = {
      myDrafts: mine.filter((r) => r.qu.status === 'draft').slice(0, 8).map(brief), awaitingApproval: mine.filter((r) => r.qu.status === 'pending_approval').map(brief), returned: mine.filter((r) => r.qu.status === 'returned').map(brief),
      expiringSoon: mine.filter((r) => r.qu.status === 'issued' && r.rev.validUntil && r.rev.validUntil <= soon).map(brief),
      followUps: mine.filter((r) => r.qu.status === 'issued' && r.rev.issuedAt && Date.now() - r.rev.issuedAt.getTime() > 3 * 86400000).map(brief),
      recent: mine.slice(0, 6).map(brief),
    };
  }
  if (has(ctx, 'quote.approve') || has(ctx, 'quote.view_all')) {
    out.approvalsPending = visible.filter((r) => r.qu.status === 'pending_approval').map(brief);
    out.expiringSoon = visible.filter((r) => r.qu.status === 'issued' && r.rev.validUntil && r.rev.validUntil <= soon).map(brief);
  }
  if (has(ctx, 'cost.view')) {
    const batches = await db.select().from(S.priceBatches).where(and(eq(S.priceBatches.tenantId, ctx.tenantId), eq(S.priceBatches.status, 'submitted')));
    const lowMargin = visible.filter((r) => ['pending_approval', 'approved', 'issued'].includes(r.qu.status) && ((r.rev.result as any)?.approvals ?? []).some((a: any) => ['below_margin_threshold', 'below_cost'].includes(a.code)))
      .map((r) => ({ ...brief(r), marginPct: (r.rev.result as any)?.internal?.marginAfterFullCostPct ?? null }));
    const stale = ctx.tenantSettings.staleAfterDays;
    const cutoff = new Date(Date.now() - stale * 86400000).toISOString().slice(0, 10);
    const stalePrices = await db.select({ materialId: S.materialPriceVersions.materialId, plantId: S.materialPriceVersions.plantId, validFrom: S.materialPriceVersions.validFrom, code: S.materials.code, name: S.materials.nameEn, plant: S.plants.code })
      .from(S.materialPriceVersions).innerJoin(S.materials, and(eq(S.materials.id, S.materialPriceVersions.materialId), eq(S.materials.tenantId, S.materialPriceVersions.tenantId))).innerJoin(S.plants, and(eq(S.plants.id, S.materialPriceVersions.plantId), eq(S.plants.tenantId, S.materialPriceVersions.tenantId)))
      .where(and(eq(S.materialPriceVersions.tenantId, ctx.tenantId), isNull(S.materialPriceVersions.validTo), sql`${S.materialPriceVersions.validFrom} < ${cutoff}`));
    // missing prices: approved-mix ingredients with no active price at a plant where the mix is offered
    const missing = await db.execute(sql`select distinct m.code as mix, mat.code as material, p.code as plant from mix_plants mp
      join mixes m on m.id = mp.mix_id and m.tenant_id = mp.tenant_id join mix_revisions r on r.mix_id = m.id and r.status = 'approved'
      join mix_ingredients i on i.mix_revision_id = r.id join materials mat on mat.id = i.material_id join plants p on p.id = mp.plant_id
      where mp.tenant_id = ${ctx.tenantId} and not exists (select 1 from material_price_versions v where v.tenant_id = mp.tenant_id and v.plant_id = mp.plant_id and v.material_id = i.material_id and v.valid_from <= ${today()} and (v.valid_to is null or v.valid_to > ${today()}))`);
    const draftCosts = await db.select({ id: S.plantCostVersions.id, plantId: S.plantCostVersions.plantId, validFrom: S.plantCostVersions.validFrom }).from(S.plantCostVersions).where(and(eq(S.plantCostVersions.tenantId, ctx.tenantId), eq(S.plantCostVersions.status, 'draft')));
    out.pricing = {
      batchesAwaitingReview: batches.map((b) => ({ id: b.id, name: b.name, submittedAt: b.submittedAt })), stalePrices: stalePrices.filter((p) => plantAllowed(ctx, p.plantId)).map(({ plantId: _p, ...x }) => x), missingPrices: (missing.rows as any[]),
      lowMarginExceptions: lowMargin, costAssumptionsAttention: [...draftCosts.map((d) => ({ kind: 'draft_plant_cost', id: d.id, validFrom: d.validFrom }))],
    };
  }
  if (has(ctx, 'mix.create') || has(ctx, 'mix.approve')) {
    const revs = await db.select({ r: S.mixRevisions, m: S.mixes }).from(S.mixRevisions).innerJoin(S.mixes, and(eq(S.mixes.id, S.mixRevisions.mixId), eq(S.mixes.tenantId, S.mixRevisions.tenantId))).where(and(eq(S.mixRevisions.tenantId, ctx.tenantId), inArray(S.mixRevisions.status, ['draft', 'pending_technical'])));
    const ing = await db.select({ rid: S.mixIngredients.mixRevisionId, n: sql<number>`count(*)::int` }).from(S.mixIngredients).where(eq(S.mixIngredients.tenantId, ctx.tenantId)).groupBy(S.mixIngredients.mixRevisionId);
    const b = (x: (typeof revs)[number]) => ({ mixId: x.m.id, revisionId: x.r.id, code: x.m.code, name: x.m.nameEn, revNo: x.r.revNo, status: x.r.status });
    out.technical = {
      draftRevisions: revs.filter((x) => x.r.status === 'draft').map(b), awaitingApproval: revs.filter((x) => x.r.status === 'pending_technical').map(b),
      missingInformation: revs.filter((x) => !(x.r.spec as any).strengthMpa || !(x.r.spec as any).slumpMm || !ing.find((i) => i.rid === x.r.id)?.n).map(b),
    };
  }
  res.json(out);
}));
