import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useT } from '../lib/i18n';
import { EmptyState, ErrorState, Loading, StatusBadge } from '../components/ui';
import { PageHead } from '../components/Shell';
import { approvalLabel } from '../components/Totals';

export function Approvals() {
  const t = useT(); const { can } = useAuth();
  const quotes = useQuery({ queryKey: ['approvals'], queryFn: () => get<any[]>('/approvals'), enabled: can('quote.approve') });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => get<any>('/dashboard') });
  if (dash.isLoading || quotes.isLoading) return <div className="page"><Loading /></div>;
  if (dash.error) return <div className="page"><ErrorState error={dash.error} /></div>;
  const batches = dash.data.pricing?.batchesAwaitingReview ?? []; const mixes = dash.data.technical?.awaitingApproval ?? [];
  const none = !(quotes.data?.length || batches.length || mixes.length);
  return (
    <div className="page">
      <PageHead title={t('Approvals')} sub={t('Each approval applies to one exact, frozen revision or version.')} />
      {none && <EmptyState title={t('Nothing is waiting for your approval')} />}
      {can('quote.approve') && (quotes.data?.length ?? 0) > 0 && <section className="card"><h2>{t('Quotations')}</h2><div className="table-wrap"><table className="t"><thead><tr><th>{t('Quotation')}</th><th>{t('Client')}</th><th>{t('Reasons')}</th><th className="n">{t('Pre-tax total')} (JOD)</th><th>{t('Requested')}</th></tr></thead><tbody>
        {quotes.data!.map((a) => <tr key={a.id}><td><Link className="rowlink" to={`/quotations/${a.quotationId}`}><span className="ltr">{a.number}</span> <span className="muted">r{a.revNo}</span></Link></td><td>{a.client}</td>
          <td><ul style={{ margin: 0, paddingInlineStart: 16 }}>{[...new Set(a.reasons.map((r: any) => r.code))].map((c: any) => <li key={c}>{t(approvalLabel(c))}</li>)}</ul></td><td className="n">{money(a.preTaxTotal)}</td><td>{a.requestedBy}<div className="muted small">{dateTime(a.requestedAt)}</div>{a.mine && <span className="badge">{t('Your submission')}</span>}</td></tr>)}</tbody></table></div></section>}
      {batches.length > 0 && <section className="card"><h2>{t('Price updates')}</h2>{batches.map((b: any) => <Link key={b.id} className="qitem" to={`/price-book/updates/${b.id}`}><span className="t1">{b.name}</span><StatusBadge status="submitted" /></Link>)}</section>}
      {mixes.length > 0 && <section className="card"><h2>{t('Mix revisions')}</h2>{mixes.map((m: any) => <Link key={m.revisionId} className="qitem" to={`/mixes/${m.mixId}`}><span><span className="t1 ltr">{m.code}</span> {m.name} — {t('rev')} {m.revNo}</span><StatusBadge status="pending_technical" /></Link>)}</section>}
    </div>
  );
}
