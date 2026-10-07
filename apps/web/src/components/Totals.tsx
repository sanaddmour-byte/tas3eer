import { useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../lib/i18n';
import { money, pct, qty } from '../lib/format';
import { Icon, StatusBadge } from './ui';
import { issueText } from '../lib/issues';

export function TotalsPanel({ result, estimate, taxLabel }: { result: any; estimate?: boolean; taxLabel?: { name: string; status: string } | null }) {
  const t = useT();
  const c = result?.customer;
  return (
    <section className="card totals" aria-label={t('Offer summary')}>
      <h2>{t('Offer summary')}</h2>
      {estimate && <p className="small muted" role="note">{t('Offline estimate — customer totals are recalculated on the server when you reconnect.')}</p>}
      <div role="group" aria-label={t('Totals')}>
        <Row k={t('Total volume')} v={`${qty(c?.totalVolumeM3)} m³`} />
        <Row k={t('Concrete subtotal')} v={`${money(c?.concreteSubtotal)} JOD`} />
        <Row k={t('Delivery & pumping')} v={`${money(Number(c?.deliveryTotal ?? 0) + Number(c?.pumpingTotal ?? 0) + Number(c?.otherTotal ?? 0))} JOD`} />
        <Row k={t('Subtotal before tax')} v={`${money(c?.subtotalExTax)} JOD`} />
        <Row k={`${t('Tax')}${c?.tax ? ` (${c.tax.ratePct}%\u200E)` : ''}`} v={c?.taxAmount != null ? `${money(c.taxAmount)} JOD` : '—'} />
        {(c?.tax || taxLabel) && <div className="small muted" style={{ margin: '2px 0 6px' }}>{t('Tax policy')}: {(c?.tax?.policyName ?? taxLabel?.name) || '—'} <StatusBadge status={c?.tax?.policyStatus ?? taxLabel?.status ?? 'draft'} /></div>}
        <Row k={t('Customer total')} v={c?.total != null ? `${money(c.total)} JOD` : '—'} grand />
      </div>
      {result?.approvals?.length > 0 && (
        <div style={{ marginTop: 12 }}><strong className="small">{t('Approval required')}</strong>
          <ul className="small" style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{[...new Set(result.approvals.map((a: any) => a.code))].map((code: any) => <li key={code}>{t(approvalLabel(code))}</li>)}</ul></div>
      )}
      <InternalAnalysis result={result} />
    </section>
  );
}
function Row({ k, v, grand }: { k: string; v: string; grand?: boolean }) { return <div className={`trow ${grand ? 'grand' : ''}`}><span>{k}</span><span className="num">{v}</span></div>; }
export const approvalLabel = (c: string) => ({ price_override: 'Price override', cost_override: 'Cost override', below_margin_threshold: 'Margin below approved threshold', below_cost: 'Priced below full configured cost', service_rate_override: 'Service rate override' } as Record<string, string>)[c] ?? c;

export function InternalAnalysis({ result }: { result: any }) {
  const { can } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!can('cost.view') || !result?.internal) return null;
  const i = result.internal;
  return (
    <details className="adv" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{t('Internal pricing analysis')}</summary>
      <p className="small muted">{t('Confidential — not part of the customer quotation.')}</p>
      <Waterfall result={result} />
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', margin: '8px 0 0' }}>
        <dt>{t('Full configured cost')}</dt><dd className="num right" style={{ margin: 0 }}>{money(i.totalConfiguredCost)} JOD</dd>
        <dt>{t('Contribution before fixed-cost allocation')}</dt><dd className="num right" style={{ margin: 0 }}>{money(i.contributionBeforeFixed)} JOD ({pct(i.contributionBeforeFixedPct, 1)})</dd>
        <dt>{t('Margin after full configured cost')}</dt><dd className="num right" style={{ margin: 0 }}>{money(i.marginAfterFullCost)} JOD ({pct(i.marginAfterFullCostPct, 1)})</dd>
      </dl>
      <p className="small muted">{t('Margins are calculated on the pre-tax selling price. Contribution excludes allocated fixed costs and is not EBITDA.')}</p>
    </details>
  );
}

/** Cost waterfall: materials → production → fixed allocation → overhead → provision → services → price. */
export function Waterfall({ result }: { result: any }) {
  const t = useT();
  const L = result.lines.filter((l: any) => l.internal?.materials);
  if (!L.length) return <p className="small muted">{t('Not available until the quotation is fully priced.')}</p>;
  const sum = (f: (l: any) => number) => L.reduce((a: number, l: any) => a + f(l) * Number(l.quantityM3), 0);
  const rows = [
    { k: 'Materials', v: sum((l) => Number(l.internal.materials.total)) },
    { k: 'Production variable', v: sum((l) => Number(l.internal.production.variableTotal)) },
    { k: 'Allocated fixed (per forecast)', v: sum((l) => Number(l.internal.production.fixedAllocatedPerM3)) },
    { k: 'Corporate overhead', v: sum((l) => Number(l.internal.production.corporateOverheadPerM3)) },
    { k: 'Risk / finance provision', v: sum((l) => Number(l.internal.production.riskProvisionPerM3)) },
    { k: 'Delivery & pumping (estimated)', v: Number(result.internal.serviceEstimatedCost) },
  ];
  const max = Math.max(Number(result.internal.revenueExTax), ...rows.map((r) => r.v), 1);
  const f = L[0].internal.production.forecast;
  return (
    <div className="waterfall" role="img" aria-label={t('Cost waterfall')}>
      {rows.map((r) => <div className="wf-row" key={r.k}><span>{t(r.k)}</span><span className="wf-bar" style={{ width: `${(r.v / max) * 100}%` }} /><span className="num right">{money(r.v)}</span></div>)}
      <div className="wf-row"><strong>{t('Selling price (pre-tax)')}</strong><span className="wf-bar price" style={{ width: `${(Number(result.internal.revenueExTax) / max) * 100}%` }} /><strong className="num right">{money(result.internal.revenueExTax)}</strong></div>
      <p className="small muted" style={{ margin: 0 }}>{t('Fixed costs allocated over {v} m³/month ({s})', { v: qty(f.monthlyM3), s: f.source })}</p>
    </div>
  );
}

export function IssuesList({ issues, tone = 'warn', onFocus }: { issues: any[]; tone?: 'warn' | 'err'; onFocus?: (path?: string) => void }) {
  const t = useT();
  if (!issues.length) return null;
  return (
    <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
      {issues.map((i, n) => <li key={n}>{onFocus && i.path ? <a href={`#${fieldId(i.path)}`} onClick={(e) => { e.preventDefault(); onFocus(i.path); }}>{issueText(i, t)}</a> : issueText(i, t)}</li>)}
    </ul>
  );
}
export const fieldId = (path: string) => {
  const m = /^lines\[(.+?)\]\.quantity$/.exec(path); if (m) return `line-${m[1]}-qty`;
  const l = /^lines\[(.+?)\]/.exec(path); if (l) return `line-${l[1]}`;
  const s = /^services\[(.+?)\]/.exec(path); if (s) return `service-${s[1]}`;
  return path.replace(/[^\w]+/g, '-');
};
export { Icon };
