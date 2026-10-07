import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { ApiError, get, post } from '../lib/api';
import { dateFmt, money, qty } from '../lib/format';
import { usePref, useSyncStatus } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { listDrafts, listOutbox, retryOp, discardOp, type Draft, type OutboxOp } from '../offline/store';
import { Alert, Dialog, EmptyState, ErrorState, Icon, Loading, Menu, SearchBox, SelectField, StatusBadge, TextField, Toolbar, useDebounced } from '../components/ui';
import { PageHead } from '../components/Shell';

interface Filters { view: 'mine' | 'all' | 'attention'; status: string; plantId: string; owner: string; from: string; to: string }
const DEFAULT: Filters = { view: 'all', status: '', plantId: '', owner: '', from: '', to: '' };
type SortKey = 'number' | 'client' | 'plantCode' | 'volumeM3' | 'preTaxTotal' | 'status' | 'validUntil' | 'owner' | 'updatedAt';

export function QuotationList() {
  const t = useT();
  const { can, me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const sync = useSyncStatus();
  const [sp, setSp] = useSearchParams();
  const [stored, setStored] = usePref<Filters>('quoteFilters', { ...DEFAULT, view: can('quote.view_all') ? 'all' : 'mine' });
  const [f, setF] = useState<Filters>(stored);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounced(q);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'updatedAt', dir: -1 });
  const [outcome, setOutcome] = useState<any>(null);
  const [offlineRows, setOfflineRows] = useState<{ drafts: Draft[]; ops: OutboxOp[] }>({ drafts: [], ops: [] });
  useEffect(() => { setStored(f); }, [f]);
  useEffect(() => { if (sp.get('q') !== null) setQ(sp.get('q') ?? ''); }, [sp]);
  const params = new URLSearchParams({ view: f.view, ...(dq ? { q: dq } : {}), ...(f.status ? { status: f.status } : {}), ...(f.plantId ? { plantId: f.plantId } : {}), ...(f.owner ? { owner: f.owner } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) });
  const list = useQuery({ queryKey: ['quotations', params.toString()], queryFn: () => get<any[]>(`/quotations?${params}`), enabled: sync.online });
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants'), enabled: sync.online });
  useEffect(() => { void Promise.all([listDrafts(), listOutbox()]).then(([drafts, ops]) => setOfflineRows({ drafts, ops })); }, [sync.online, sync.pending, sync.conflicts, sync.errors, list.dataUpdatedAt]);
  const set = (p: Partial<Filters>) => setF({ ...f, ...p });
  const rows = useMemo(() => {
    const r = [...(list.data ?? [])];
    r.sort((a, b) => { const A = (a as any)[sort.k === 'client' ? 'client' : sort.k] ?? '', B = (b as any)[sort.k === 'client' ? 'client' : sort.k] ?? ''; const num = ['volumeM3', 'preTaxTotal'].includes(sort.k); return (num ? Number(A) - Number(B) : String(A).localeCompare(String(B))) * sort.dir; });
    return r;
  }, [list.data, sort]);
  const duplicate = async (id: string) => { const r = await post(`/quotations/${id}/duplicate`); nav(`/quotations/${r.id}/edit`); };
  const th = (k: SortKey, label: string, n = false) => (
    <th className={n ? 'n' : ''} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : 1 })}>{t(label)}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
  );
  const actions = (r: any) => (
    <Menu label={t('Actions for {n}', { n: r.number })}>{(close) => (<>
      {r.status === 'draft' && can('quote.create') && <Link to={`/quotations/${r.id}/edit`} onClick={close}>{t('Continue draft')}</Link>}
      <Link to={`/quotations/${r.id}`} onClick={close}>{t('Preview')}</Link>
      {can('quote.create') && <button onClick={() => { close(); void duplicate(r.id); }}>{t('Duplicate (revalidates prices)')}</button>}
      {can('quote.create') && ['issued', 'declined', 'expired', 'approved', 'returned', 'pending_approval'].includes(r.status) && <button onClick={async () => { close(); await post(`/quotations/${r.id}/revise`); nav(`/quotations/${r.id}/edit`); }}>{t('Create revision')}</button>}
      {r.status === 'issued' && <button onClick={() => { close(); setOutcome(r); }}>{t('Record outcome')}</button>}
    </>)}</Menu>
  );
  const nothing = !list.isLoading && !rows.length;
  return (
    <div className="page">
      <PageHead title={t('Quotations')}>{can('quote.create') && <Link className="btn btn-primary" to="/quotations/new"><Icon n="plus" size={18} />{t('New quotation')}</Link>}</PageHead>
      {(offlineRows.ops.length > 0 || !sync.online) && <LocalDrafts rows={offlineRows} online={sync.online} />}
      {!sync.online && !list.data ? <Alert tone="info">{t('The full list needs a connection. Your drafts on this device are shown above.')}</Alert> : (
        <>
          <Toolbar>
            <SearchBox value={q} onChange={(v) => { setQ(v); if (sp.get('q') !== null) setSp({}); }} placeholder={t('Search number, client or project')} />
            <div className="seg" role="group" aria-label={t('View')}>
              {([['mine', 'My quotations'], ['all', 'All authorized'], ['attention', 'Needs attention']] as const).map(([v, l]) => <button key={v} aria-pressed={f.view === v} onClick={() => set({ view: v })}>{t(l)}</button>)}
            </div>
            <SelectField label={t('Status')} value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">{t('All statuses')}</option>{['draft', 'pending_approval', 'approved', 'returned', 'issued', 'accepted', 'declined', 'expired', 'cancelled'].map((s) => <option key={s} value={s}>{t(statusLabel(s))}</option>)}</SelectField>
            <SelectField label={t('Plant')} value={f.plantId} onChange={(e) => set({ plantId: e.target.value })}><option value="">{t('All plants')}</option>{(plants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nameEn}</option>)}</SelectField>
            {can('quote.view_all') && <SelectField label={t('Salesperson')} value={f.owner} onChange={(e) => set({ owner: e.target.value })}><option value="">{t('Anyone')}</option><option value="me">{t('Me')}</option></SelectField>}
            <TextField label={t('Created from')} type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /><TextField label={t('to')} type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
            <button className="btn-ghost" onClick={() => { setF({ ...DEFAULT, view: f.view }); setQ(''); }}>{t('Clear filters')}</button>
          </Toolbar>
          {list.isLoading && <Loading />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {nothing && !list.error && <EmptyState title={t('No quotations match')} action={can('quote.create') ? <Link className="btn btn-primary" to="/quotations/new">{t('New quotation')}</Link> : undefined}>{f.view === 'attention' ? t('Nothing needs attention right now.') : t('Adjust the filters or create a new quotation.')}</EmptyState>}
          {rows.length > 0 && (<>
            <div className="table-wrap collapse"><table className="t"><thead><tr>{th('number', 'Number / rev')}{th('client', 'Client / project')}{th('plantCode', 'Plant')}{th('volumeM3', 'Volume (m³)', true)}{th('preTaxTotal', 'Pre-tax total (JOD)', true)}{th('status', 'Status')}{th('validUntil', 'Valid until')}{th('owner', 'Owner')}<th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; nav(`/quotations/${r.id}`); }} style={{ cursor: 'pointer' }}>
                  <td><Link className="rowlink" to={`/quotations/${r.id}`}><span className="ltr">{r.number}</span></Link> <span className="muted small">{t('rev')} {r.revNo}</span></td>
                  <td><div>{r.client ?? '—'}</div><div className="muted small">{r.project ?? ''}</div></td><td>{r.plantCode ?? '—'}</td>
                  <td className="n">{qty(r.volumeM3)}</td><td className="n">{money(r.preTaxTotal)}</td><td><StatusBadge status={r.status} />{r.attention && <span className="chip" style={{ marginInlineStart: 6 }}>{t('Needs attention')}</span>}</td>
                  <td>{dateFmt(r.validUntil)}</td><td>{r.owner}</td><td>{actions(r)}</td></tr>))}</tbody></table></div>
            <div className="cards">{rows.map((r) => (
              <Link key={r.id} to={`/quotations/${r.id}`} className="qcard"><div className="hstack" style={{ justifyContent: 'space-between' }}><strong className="ltr">{r.number}</strong><StatusBadge status={r.status} /></div>
                <div>{r.client ?? '—'}</div><div className="muted small">{r.project ?? ''} · {r.plantCode ?? ''}</div>
                <div className="hstack" style={{ justifyContent: 'space-between' }}><strong className="num">{money(r.preTaxTotal)} JOD</strong><span className="muted small">{r.validUntil ? `${t('Valid until')} ${dateFmt(r.validUntil)}` : t('Draft')}</span></div>
                <span className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>{r.status === 'draft' ? t('Continue draft') : t('Open')}</span></Link>))}</div>
          </>)}
        </>
      )}
      {outcome && <OutcomeDialog q={outcome} onClose={() => setOutcome(null)} onDone={() => { setOutcome(null); void qc.invalidateQueries({ queryKey: ['quotations'] }); }} />}
    </div>
  );
}
export const statusLabel = (s: string) => ({ draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', returned: 'Returned for changes', issued: 'Issued', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' } as Record<string, string>)[s] ?? s;

function LocalDrafts({ rows, online }: { rows: { drafts: Draft[]; ops: OutboxOp[] }; online: boolean }) {
  const t = useT();
  const items = online ? rows.ops : rows.drafts.filter((d) => d.status === 'draft' || rows.ops.some((o) => o.id === d.id));
  if (!items.length) return null;
  const draftOf = (id: string) => rows.drafts.find((d) => d.id === id);
  return (
    <div className="card" style={{ marginBottom: 16 }}><h2>{online ? t('Drafts not yet synced') : t('Drafts on this device')}</h2>
      <div className="stack-sm">{(items as any[]).map((x) => { const id = x.id; const op = rows.ops.find((o) => o.id === id); const d = draftOf(id); return (
        <div key={id} className="hstack" style={{ justifyContent: 'space-between' }}>
          <Link to={`/quotations/${id}/edit`} className="rowlink"><span className="ltr">{d?.number ?? t('New draft (number assigned on sync)')}</span> <span className="muted small">{d?.client ?? ''}</span></Link>
          <span className="hstack">{op ? <span className={`badge ${op.status === 'pending' ? 'warn' : 'err'}`}>{op.status === 'pending' ? t('Waiting to sync') : op.status === 'conflict' ? t('Conflict') : t('Save failed')}</span> : <span className="badge ok">{t('Synced')}</span>}
            {op && op.status === 'error' && <><button className="btn-sm" onClick={() => retryOp(id)}>{t('Retry')}</button><button className="btn-sm btn-danger" onClick={() => discardOp(id)}>{t('Discard')}</button></>}
            {op && op.status === 'conflict' && <Link className="btn btn-sm" to={`/quotations/${id}/edit`}>{t('Resolve')}</Link>}</span></div>); })}</div></div>
  );
}

function OutcomeDialog({ q, onClose, onDone }: { q: any; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [outcome, setOutcome] = useState('accepted'); const [lost, setLost] = useState(''); const [comp, setComp] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await post(`/quotations/${q.id}/revisions/${q.revNo}/outcome`, { outcome, lostReason: lost || undefined, competitorNote: comp || undefined }); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog title={t('Record outcome for {n}', { n: q.number })} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go}>{t('Record outcome')}</button></>}>
      <div className="stack">{err && <Alert tone="err">{err}</Alert>}
        <SelectField label={t('Outcome')} value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="accepted">{t('Accepted by client')}</option><option value="declined">{t('Declined / lost')}</option><option value="expired">{t('Expired')}</option></SelectField>
        {outcome === 'declined' && <><TextField label={t('Lost reason')} value={lost} onChange={(e) => setLost(e.target.value)} error={!lost.trim() && err ? t('Enter the reason the quotation was lost.') : null} /><TextField label={t('Competitor price note (optional)')} value={comp} onChange={(e) => setComp(e.target.value)} hint={t('Internal only.')} /></>}</div>
    </Dialog>
  );
}
