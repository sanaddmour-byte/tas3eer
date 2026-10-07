import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get } from '../lib/api';
import { dateFmt, money, qty } from '../lib/format';
import { useT } from '../lib/i18n';
import { useSyncStatus } from '../lib/hooks';
import { EmptyState, ErrorState, Icon, Loading, StatusBadge } from '../components/ui';
import { PageHead } from '../components/Shell';

function Queue({ title, items, empty, render, to }: { title: string; items: any[]; empty: string; render: (x: any) => React.ReactNode; to?: (x: any) => string }) {
  const t = useT();
  return (
    <section className="card" aria-label={t(title)}><div className="card-head"><h2>{t(title)}</h2><span className="chip">{items.length}</span></div>
      {items.length === 0 ? <p className="muted small">{t(empty)}</p> : items.slice(0, 6).map((x, i) => to ? <Link key={x.id ?? i} className="qitem" to={to(x)}>{render(x)}</Link> : <div key={x.id ?? i} className="qitem">{render(x)}</div>)}
    </section>
  );
}
const qRow = (x: any) => <><div><div className="t1 ltr">{x.number}</div><div className="muted small">{x.client} — {x.project}</div></div><div className="right"><div className="num">{x.preTaxTotal ? `${money(x.preTaxTotal)} JOD` : '—'}</div>{x.validUntil && <div className="muted small">{dateFmt(x.validUntil)}</div>}</div></>;

export function Overview() {
  const t = useT();
  const { me, can } = useAuth();
  const sync = useSyncStatus();
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => get<any>('/dashboard'), enabled: sync.online, refetchInterval: 60_000 });
  const first = me!.user.name.split(' ')[0];
  return (
    <div className="page">
      <PageHead title={t('Hello, {n}', { n: first })} sub={t('Your working queue')}>{can('quote.create') && <Link className="btn btn-primary" to="/quotations/new"><Icon n="plus" size={18} />{t('New quotation')}</Link>}</PageHead>
      {!sync.online && !d.data && <EmptyState title={t('You are offline')} action={can('quote.create') ? <Link className="btn btn-primary" to="/quotations/new">{t('New quotation')}</Link> : undefined}>{t('You can still draft quotations; they sync when you reconnect.')}</EmptyState>}
      {d.isLoading && <Loading />}
      {d.error && <ErrorState error={d.error} retry={() => d.refetch()} />}
      {d.data && (<>
        <div className="kpis" aria-label={t('Projected from open quotations')}>
          <div className="kpi"><div className="v">{d.data.projected.openQuotations}</div><div className="l">{t('Open quotations')}</div></div>
          <div className="kpi"><div className="v">{money(d.data.projected.preTaxValue, 0)} JOD</div><div className="l">{t('Projected quotation value (pre-tax)')}</div></div>
          <div className="kpi"><div className="v">{qty(d.data.projected.volumeM3)} m³</div><div className="l">{t('Projected volume')}</div></div>
          {d.data.projected.contributionBeforeFixed !== undefined && <div className="kpi"><div className="v">{money(d.data.projected.contributionBeforeFixed, 0)} JOD</div><div className="l">{t('Projected contribution before fixed costs')}</div></div>}
          <p className="small muted" style={{ gridColumn: '1/-1', margin: 0 }}>{t('Projected from open quotations (pending, approved, issued). Not realised sales or profit.')}</p>
        </div>
        <div className="queue">
          {d.data.sales && <>
            <Queue title="My drafts" items={d.data.sales.myDrafts} empty="No drafts in progress." to={(x) => `/quotations/${x.id}/edit`} render={qRow} />
            <Queue title="Offers awaiting approval" items={d.data.sales.awaitingApproval} empty="Nothing waiting for approval." to={(x) => `/quotations/${x.id}`} render={qRow} />
            <Queue title="Returned for changes" items={d.data.sales.returned} empty="No returned offers." to={(x) => `/quotations/${x.id}`} render={qRow} />
            <Queue title="Offers expiring soon" items={d.data.sales.expiringSoon} empty="No offers expiring within 7 days." to={(x) => `/quotations/${x.id}`} render={qRow} />
            <Queue title="Follow-up tasks" items={d.data.sales.followUps} empty="No issued offers waiting for an answer." to={(x) => `/quotations/${x.id}`} render={(x) => <>{qRow(x)}</>} />
            <Queue title="Recent quotations" items={d.data.sales.recent} empty="No quotations yet." to={(x) => `/quotations/${x.id}`} render={(x) => <><div><div className="t1 ltr">{x.number}</div><div className="muted small">{x.client}</div></div><StatusBadge status={x.status} /></>} />
          </>}
          {d.data.approvalsPending && can('quote.approve') && <Queue title="Quotations awaiting approval" items={d.data.approvalsPending} empty="No quotations awaiting approval." to={(x) => `/quotations/${x.id}`} render={qRow} />}
          {d.data.pricing && <>
            <Queue title="Price batches awaiting review" items={d.data.pricing.batchesAwaitingReview} empty="No price batches waiting." to={(x) => `/price-book/updates/${x.id}`} render={(x) => <><div className="t1">{x.name}</div><span className="muted small">{dateFmt(x.submittedAt)}</span></>} />
            <Queue title="Stale or missing material prices" items={[...d.data.pricing.missingPrices.map((x: any) => ({ ...x, missing: true })), ...d.data.pricing.stalePrices]} empty="All active prices are fresh." to={() => '/price-book'} render={(x) => x.missing ? <><div><div className="t1">{x.material} — {x.plant}</div><div className="muted small">{t('No active price (used by {m})', { m: x.mix })}</div></div><span className="badge err">{t('Missing')}</span></> : <><div><div className="t1">{x.code} — {x.plant}</div><div className="muted small">{t('Active since {d}', { d: x.validFrom })}</div></div><span className="badge warn">{t('Stale')}</span></>} />
            <Queue title="Low-margin quotation exceptions" items={d.data.pricing.lowMarginExceptions} empty="No low-margin exceptions." to={(x) => `/quotations/${x.id}`} render={(x) => <><div><div className="t1 ltr">{x.number}</div><div className="muted small">{x.client}</div></div><div className="right"><div className="num">{x.marginPct ? `${x.marginPct}%` : '—'}</div><StatusBadge status={x.status} /></div></>} />
            <Queue title="Cost assumptions requiring attention" items={d.data.pricing.costAssumptionsAttention} empty="No cost assumptions need attention." to={() => '/plant-costs'} render={(x) => <><div className="t1">{t('Draft plant cost version')}</div><span className="muted small">{t('effective {d}', { d: x.validFrom })}</span></>} />
          </>}
          {d.data.technical && <>
            <Queue title="Draft mix revisions" items={d.data.technical.draftRevisions} empty="No draft revisions." to={(x) => `/mixes/${x.mixId}`} render={(x) => <><div><div className="t1 ltr">{x.code}</div><div className="muted small">{x.name}</div></div><span className="chip">{t('rev')} {x.revNo}</span></>} />
            <Queue title="Revisions awaiting technical approval" items={d.data.technical.awaitingApproval} empty="Nothing awaiting technical approval." to={(x) => `/mixes/${x.mixId}`} render={(x) => <><div><div className="t1 ltr">{x.code}</div><div className="muted small">{x.name}</div></div><StatusBadge status="pending_technical" /></>} />
            <Queue title="Mixes with missing information" items={d.data.technical.missingInformation} empty="All draft mixes are complete." to={(x) => `/mixes/${x.mixId}`} render={(x) => <><div><div className="t1 ltr">{x.code}</div><div className="muted small">{x.name}</div></div><span className="badge warn">{t('Incomplete')}</span></>} />
          </>}
          {!d.data.sales && !d.data.pricing && !d.data.technical && !d.data.approvalsPending && <EmptyState title={t('Nothing to do here')}>{t('Browse the mix library or open a quotation.')}</EmptyState>}
        </div>
      </>)}
    </div>
  );
}
