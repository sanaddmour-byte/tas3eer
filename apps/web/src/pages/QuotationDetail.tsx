import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { ApiError, download, get, post } from '../lib/api';
import { dateFmt, dateTime, money, qty } from '../lib/format';
import { useLang, useT } from '../lib/i18n';
import { issueText } from '../lib/issues';
import { Alert, AreaField, AuditTimeline, Dialog, ErrorState, Icon, Loading, StatusBadge, Tabs, TextField, SelectField } from '../components/ui';
import { PageHead } from '../components/Shell';
import { InternalAnalysis, TotalsPanel, approvalLabel } from '../components/Totals';
import { CustomerPreview } from './QuotationBuilder';

export function ApprovalBanner({ approvals, status }: { approvals: any[]; status: string }) {
  const t = useT();
  const latest = approvals[0];
  if (!latest) return null;
  const tone = latest.status === 'pending' ? 'warn' : latest.status === 'approved' ? 'ok' : latest.status === 'returned' ? 'err' : 'info';
  return (
    <Alert tone={tone as any} title={latest.status === 'pending' ? t('Awaiting approval') : latest.status === 'approved' ? t('Approved for this exact revision') : latest.status === 'returned' ? t('Returned for changes') : t('Approval {s}', { s: t(latest.status) })}>
      <div className="small">{t('Requested by {u} on {d}', { u: latest.requestedBy ?? '—', d: dateTime(latest.requestedAt) })}</div>
      <ul>{latest.reasons.map((r: any, i: number) => <li key={i}>{r.message}{r.detail?.reason ? ` — “${r.detail.reason}”` : ''}{r.detail?.marginPct ? ` (${t('margin')} ${r.detail.marginPct}% / ${t('threshold')} ${r.detail.thresholdPct}%)` : ''}</li>)}</ul>
      {latest.comment && <div>“{latest.comment}”</div>}
    </Alert>
  );
}

export function QuotationDetail() {
  const t = useT();
  const { lang } = useLang();
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const rev = sp.get('rev');
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [tab, setTab] = useState('summary');
  const [dialog, setDialog] = useState<null | 'approve' | 'return' | 'outcome' | 'cancel'>(null);
  const [comment, setComment] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('accepted'); const [lost, setLost] = useState(''); const [comp, setComp] = useState('');
  const [pdfLang, setPdfLang] = useState<'en' | 'ar'>(lang);
  const url = rev ? `/quotations/${id}/revisions/${rev}` : `/quotations/${id}`;
  const q = useQuery({ queryKey: ['quotation', id, rev], queryFn: () => get<any>(url) });
  const audit = useQuery({ queryKey: ['quotation-audit', id], queryFn: () => get<any[]>(`/audit/quotation/${id}`), enabled: tab === 'history' });
  const revs = useQuery({ queryKey: ['quotation', id, 'revs'], queryFn: () => get<any>(`/quotations/${id}`), enabled: !!rev });
  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data; const r = d.revision; const a = d.actions; const snap = r.snapshot?.customer; const res = r.result;
  const reload = () => { void qc.invalidateQueries({ queryKey: ['quotation', id] }); void qc.invalidateQueries({ queryKey: ['quotations'] }); void qc.invalidateQueries({ queryKey: ['approvals'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const act = async (fn: () => Promise<any>) => { setBusy(true); setErr(''); try { await fn(); setDialog(null); setComment(''); reload(); } catch (e) { const x = e as ApiError; setErr(x.body?.blockers ? x.body.blockers.map((b: any) => issueText(b, t)).join(' ') : x.message); } finally { setBusy(false); } };
  const revisionsList: any[] = (revs.data?.revisions ?? d.revisions) ?? [];
  const latestRev = d.quotation.latestRevNo;
  const customerLines = snap?.lines ?? res?.lines ?? [];
  const showPreview = snap ? { customer: snap.totals, lines: snap.lines, services: snap.services } : res;
  const issueBlock = d.issueBlockers ?? [];
  return (
    <div className="page">
      <PageHead title={<>{t('Quotation')} <span className="ltr">{d.quotation.number}</span></>} sub={<span className="hstack"><StatusBadge status={r.status} /><span>{t('Revision')} {r.revNo}</span>{r.revNo !== latestRev && <Link to={`/quotations/${id}`}>{t('View latest (rev {n})', { n: latestRev })}</Link>}<span className="muted">{d.quotation.clientName} — {d.quotation.projectName}</span></span>}>
        {a.edit && <Link className="btn btn-primary" to={`/quotations/${id}/edit`}><Icon n="edit" size={16} />{t('Continue draft')}</Link>}
        {a.approve && <button className="btn-primary" onClick={() => setDialog('approve')}>{t('Approve revision')}</button>}
        {a.return && <button onClick={() => setDialog('return')}>{t('Return for changes')}</button>}
        {a.issue && <button className="btn-primary" disabled={issueBlock.length > 0 || busy} aria-describedby="issue-why" onClick={() => act(() => post(`/quotations/${id}/revisions/${r.revNo}/issue`, { lang: pdfLang }))}>{t('Issue quotation')}</button>}
        {a.pdf && <button onClick={() => download(`/quotations/${id}/revisions/${r.revNo}/pdf?lang=${pdfLang}`, `${d.quotation.number}-rev${r.revNo}-${pdfLang}.pdf`)}><Icon n="download" size={16} />{t('Download PDF')}</button>}
      </PageHead>
      {err && <div style={{ marginBottom: 12 }}><Alert tone="err">{err}</Alert></div>}
      {a.issue && issueBlock.length > 0 && <div id="issue-why" style={{ marginBottom: 12 }}><Alert tone="warn" title={t('Issuing is disabled until:')}><ul>{issueBlock.map((b: any) => <li key={b.code}>{issueText(b, t)}</li>)}</ul></Alert></div>}
      {a.approveBlockedReason && <div style={{ marginBottom: 12 }}><Alert tone="info">{a.approveBlockedReason}</Alert></div>}
      {r.status === 'issued' && <div style={{ marginBottom: 12 }}><Alert tone="ok" title={t('Issued')}>{t('Valid until {d}. The issued PDF is stored and unchanged by later price updates.', { d: dateFmt(r.validUntil) })}</Alert></div>}
      <div style={{ marginBottom: 12 }}><ApprovalBanner approvals={d.approvals} status={r.status} /></div>
      {d.quotation.lostReason && <div style={{ marginBottom: 12 }}><Alert tone="info" title={t('Lost reason')}>{d.quotation.lostReason}{d.quotation.competitorNote ? ` — ${d.quotation.competitorNote}` : ''}</Alert></div>}

      <div className="hstack" style={{ marginBottom: 12 }}>
        {a.revise && <button onClick={() => act(async () => { await post(`/quotations/${id}/revise`); nav(`/quotations/${id}/edit`); })}>{t('Create revision')}</button>}
        {a.reviseFromFrozen && <button onClick={() => act(async () => { await post(`/quotations/${id}/revise`); nav(`/quotations/${id}/edit`); })}>{t('Edit as new revision')}</button>}
        {a.reprice && <button onClick={() => act(async () => { await post(`/quotations/${id}/reprice`); nav(`/quotations/${id}/edit`); })} title={t('Creates a new draft revision priced with current prices')}>{t('Reprice as new revision')}</button>}
        {a.outcome && <button onClick={() => setDialog('outcome')}>{t('Record outcome')}</button>}
        {a.cancel && <button className="btn-danger" onClick={() => setDialog('cancel')}>{t('Cancel quotation')}</button>}
        {can('quote.create') && <button onClick={() => act(async () => { const x = await post(`/quotations/${id}/duplicate`); nav(`/quotations/${x.id}/edit`); })}><Icon n="copy" size={16} />{t('Duplicate')}</button>}
        <span className="grow" />
        {a.pdf && <SelectField label={<span className="sr-only">{t('PDF language')}</span>} value={pdfLang} onChange={(e) => setPdfLang(e.target.value as any)} style={{ width: 140 }}><option value="en">English PDF</option><option value="ar">PDF بالعربية</option></SelectField>}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'summary', label: t('Customer view') }, ...(can('cost.view') ? [{ id: 'pricing', label: t('Internal pricing') }] : []), { id: 'revisions', label: t('Revisions') }, { id: 'history', label: t('History') }]} />
      {tab === 'summary' && (
        <div className="builder">
          <div className="stack">
            <CustomerPreview doc={{ ...r.doc, paymentTerms: snap?.paymentTerms ?? r.doc.paymentTerms, customerNotes: snap?.customerNotes ?? r.doc.customerNotes }} result={showPreview} client={{ name: d.quotation.clientName }} project={{ name: d.quotation.projectName }} plant={snap?.plant ? { nameEn: snap.plant.nameEn, nameAr: snap.plant.nameAr, mixes: [] } : null} lang={lang} terms={snap?.terms} />
            {snap && <div className="card"><h3>{t('Frozen references')}</h3><dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}>
              <dt className="muted">{t('Frozen at')}</dt><dd className="ltr" style={{ margin: 0 }}>{dateTime(snap.frozenAt)} UTC</dd>
              <dt className="muted">{t('Snapshot hash')}</dt><dd className="ltr" style={{ margin: 0 }}>{r.snapshotHash?.slice(0, 16)}…</dd>
              <dt className="muted">{t('Tax policy')}</dt><dd style={{ margin: 0 }}>{snap.taxPolicy?.name} <StatusBadge status={snap.taxPolicy?.status ?? 'draft'} /></dd>
              <dt className="muted">{t('Terms version')}</dt><dd style={{ margin: 0 }}>{snap.terms?.name} v{snap.terms?.version}</dd>
              <dt className="muted">{t('Mix revisions')}</dt><dd style={{ margin: 0 }}>{snap.mixes?.map((m: any) => `${m.code} rev ${m.revNo}`).join(', ')}</dd></dl></div>}
          </div>
          <aside className="summary desktop" style={{ display: 'flex' }}><TotalsPanel result={{ customer: snap ? snap.totals : res?.customer, approvals: res?.approvals ?? [], internal: res?.internal, lines: res?.lines ?? [] }} /></aside>
        </div>
      )}
      {tab === 'pricing' && can('cost.view') && (res?.internal ? <div className="card"><h2>{t('Internal pricing analysis')}</h2><InternalAnalysisOpen result={res} /><VersionList result={r.snapshot?.internal ?? { versions: res.versions }} /></div> : <Alert tone="info">{t('Not available until the quotation is fully priced.')}</Alert>)}
      {tab === 'revisions' && (
        <div className="card"><div className="table-wrap"><table className="t"><thead><tr><th>{t('Revision')}</th><th>{t('Status')}</th><th>{t('Created')}</th><th>{t('Frozen')}</th><th>{t('Issued')}</th></tr></thead><tbody>
          {revisionsList.map((x: any) => <tr key={x.revNo}><td><Link to={`/quotations/${id}?rev=${x.revNo}`}>{t('Revision')} {x.revNo}</Link>{x.parentRevNo ? <span className="muted small"> ← {x.parentRevNo}</span> : null}</td><td><StatusBadge status={x.status} /></td><td>{dateTime(x.createdAt)}</td><td>{dateTime(x.frozenAt)}</td><td>{dateTime(x.issuedAt)}</td></tr>)}</tbody></table></div></div>
      )}
      {tab === 'history' && <div className="card">{audit.isLoading ? <Loading /> : audit.error ? <ErrorState error={audit.error} /> : <AuditTimeline events={audit.data ?? []} />}</div>}

      {dialog === 'approve' && <Dialog title={t('Approve revision {n}', { n: r.revNo })} onClose={() => setDialog(null)} footer={<><button onClick={() => setDialog(null)}>{t('Cancel')}</button><button className="btn-primary" disabled={busy} onClick={() => act(() => post(`/quotations/${id}/revisions/${r.revNo}/approve`, { comment }))}>{t('Approve revision')}</button></>}>
        <div className="stack"><p>{t('Your approval applies to this exact frozen revision (hash {h}). Any edit creates a new revision that needs its own approval.', { h: r.snapshotHash?.slice(0, 10) })}</p><AreaField label={t('Comment (optional)')} value={comment} onChange={(e) => setComment(e.target.value)} /></div></Dialog>}
      {dialog === 'return' && <Dialog title={t('Return for changes')} onClose={() => setDialog(null)} footer={<><button onClick={() => setDialog(null)}>{t('Cancel')}</button><button className="btn-primary" disabled={busy || !comment.trim()} onClick={() => act(() => post(`/quotations/${id}/revisions/${r.revNo}/return`, { comment }))}>{t('Return for changes')}</button></>}>
        <AreaField label={t('What needs to change?')} value={comment} onChange={(e) => setComment(e.target.value)} error={err && !comment.trim() ? t('Explain what needs to change when returning for changes.') : null} /></Dialog>}
      {dialog === 'cancel' && <Dialog title={t('Cancel quotation')} onClose={() => setDialog(null)} footer={<><button onClick={() => setDialog(null)}>{t('Keep quotation')}</button><button className="btn-danger" disabled={busy || comment.trim().length < 3} onClick={() => act(() => post(`/quotations/${id}/revisions/${r.revNo}/cancel`, { reason: comment }))}>{t('Cancel quotation')}</button></>}>
        <AreaField label={t('Reason')} value={comment} onChange={(e) => setComment(e.target.value)} /></Dialog>}
      {dialog === 'outcome' && <Dialog title={t('Record outcome')} onClose={() => setDialog(null)} footer={<><button onClick={() => setDialog(null)}>{t('Cancel')}</button><button className="btn-primary" disabled={busy} onClick={() => act(() => post(`/quotations/${id}/revisions/${r.revNo}/outcome`, { outcome, lostReason: lost || undefined, competitorNote: comp || undefined }))}>{t('Record outcome')}</button></>}>
        <div className="stack"><SelectField label={t('Outcome')} value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="accepted">{t('Accepted by client')}</option><option value="declined">{t('Declined / lost')}</option><option value="expired">{t('Expired')}</option></SelectField>
          {outcome === 'declined' && <><TextField label={t('Lost reason')} value={lost} onChange={(e) => setLost(e.target.value)} /><TextField label={t('Competitor price note (optional)')} value={comp} onChange={(e) => setComp(e.target.value)} /></>}</div></Dialog>}
    </div>
  );
}
function InternalAnalysisOpen({ result }: { result: any }) { return <div><TotalsPanelMini result={result} /></div>; }
function TotalsPanelMini({ result }: { result: any }) {
  const t = useT();
  return (<div className="stack">
    <div className="table-wrap"><table className="t"><thead><tr><th>{t('Mix')}</th><th className="n">m³</th><th className="n">{t('Full cost')} JOD/m³</th><th className="n">{t('Price')} JOD/m³</th><th className="n">{t('Margin')}</th><th>{t('Mode')}</th></tr></thead><tbody>
      {result.lines.map((l: any) => <tr key={l.id}><td>{l.mixCode}</td><td className="n">{qty(l.quantityM3)}</td><td className="n">{money(l.internal?.costUsedPerM3, 4)}{l.internal?.costOverridden ? ' *' : ''}</td><td className="n">{money(l.customerRatePerM3)}{l.internal?.priceOverridden ? ' *' : ''}</td><td className="n">{l.internal?.marginPct ? `${l.internal.marginPct}%` : '—'}</td><td>{l.internal?.pricingMode === 'markup' ? t('Markup') : t('Gross margin')} {l.internal?.pricingPct}%</td></tr>)}</tbody></table></div>
    <InternalAnalysis result={result} defaultOpen /></div>);
}
function VersionList({ result }: { result: any }) {
  const t = useT(); const v = result?.versions; if (!v) return null;
  return <div className="small muted" style={{ marginTop: 12 }}><strong>{t('Versions used')}:</strong> {t('engine')} {v.engine} · {t('price versions')}: {v.priceVersionIds?.length ?? 0} · {t('policies')}: {v.policyIds?.join(', ')} · {t('plant cost')} {v.plantCostVersionId?.slice(0, 8)} · {t('forecast')} {v.forecastVersionId?.slice(0, 8)}</div>;
}
export { approvalLabel };
