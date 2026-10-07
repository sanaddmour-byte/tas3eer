import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get, post, put } from '../lib/api';
import { dateFmt, money, ageDays } from '../lib/format';
import { useT } from '../lib/i18n';
import { usePref } from '../lib/hooks';
import { Alert, Dialog, EmptyState, ErrorState, Loading, NumField, SelectField, StatusBadge, Tabs, TextField } from '../components/ui';
import { PageHead } from '../components/Shell';

export function PriceBook() {
  const t = useT(); const { can, me } = useAuth(); const nav = useNavigate();
  const [plantId, setPlantId] = usePref<string>('pricebookPlant', '');
  const [view, setView] = usePref<'plant' | 'matrix'>('pricebookView', 'plant');
  const [propose, setPropose] = useState<any>(null);
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const mats = useQuery({ queryKey: ['materials'], queryFn: () => get<any[]>('/materials') });
  const pid = plantId || plants.data?.[0]?.id || '';
  const book = useQuery({ queryKey: ['pricebook', view === 'matrix' ? 'all' : pid], queryFn: () => get<any>(`/price-book${view === 'plant' ? `?plantId=${pid}` : ''}`), enabled: view === 'matrix' || !!pid });
  const loading = plants.isLoading || mats.isLoading || book.isLoading;
  const err = plants.error ?? mats.error ?? book.error;
  const stale = me!.settings.staleAfterDays;
  const rows = useMemo(() => (mats.data ?? []).map((m) => {
    const p = (book.data?.prices ?? []).find((x: any) => x.materialId === m.id && x.plantId === pid);
    const prop = (book.data?.proposals ?? []).find((x: any) => x.materialId === m.id && x.plantId === pid);
    return { m, p, prop };
  }), [mats.data, book.data, pid]);
  return (
    <div className="page">
      <PageHead title={t('Price Book')} sub={t('Active material prices by plant. Changes are proposed, reviewed and published as a batch — never edited in place.')}>
        <Link className="btn" to="/price-book/updates">{t('Price updates')}</Link></PageHead>
      <Tabs value="prices" onChange={(x) => x === 'updates' && nav('/price-book/updates')} tabs={[{ id: 'prices', label: t('Prices') }, { id: 'updates', label: t('Price updates') }]} />
      <div className="toolbar">
        <SelectField label={t('Plant')} value={pid} onChange={(e) => setPlantId(e.target.value)} disabled={view === 'matrix'}>{(plants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nameEn} ({p.code})</option>)}</SelectField>
        {(plants.data?.length ?? 0) > 1 && <div className="seg" role="group" aria-label={t('View')}><button aria-pressed={view === 'plant'} onClick={() => setView('plant')}>{t('By plant')}</button><button aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>{t('Material × plant')}</button></div>}
        <span className="muted small">{t('Prices as of {d}', { d: book.data?.asOf ?? '—' })}</span>
      </div>
      {loading && <Loading />}{err && <ErrorState error={err} retry={() => book.refetch()} />}
      {!loading && !err && view === 'plant' && (
        <>
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Material')}</th><th>{t('Purchase unit')}</th><th className="n">{t('Active price')}</th><th>{t('Basis')}</th><th>{t('Effective from')}</th><th>{t('Source / status')}</th><th className="n">{t('Proposed price')}</th>{can('pricebatch.propose') && <th />}</tr></thead><tbody>
            {rows.map(({ m, p, prop }) => { const old = p && ageDays(p.validFrom) > stale; return (
              <tr key={m.id}><td><strong>{m.nameEn}</strong><div className="muted small ltr">{m.code}</div></td><td>{m.purchaseUnit}</td>
                <td className="n">{p ? <><span className="chip active-tag">{t('Active')}</span> {money(p.price)} <span className="muted small">JOD/{m.purchaseUnit}</span></> : <span className="badge err">{t('Missing')}</span>}</td>
                <td>{p ? (p.basis === 'ex_source' ? `${t('Ex-source')} + ${money(p.freight)} ${t('freight')}` : t('Delivered to plant')) : '—'}</td>
                <td>{p ? dateFmt(p.validFrom) : '—'} {old && <span className="badge warn">{t('Stale')} ({ageDays(p.validFrom)}d)</span>}</td><td className="small">{p?.source || '—'}</td>
                <td className="n">{prop ? <><span className="chip proposed-tag">{t('Proposed')}</span> {money(prop.proposedPrice)} <Link to={`/price-book/updates/${prop.batchId}`} className="small">{prop.batchName}</Link> <StatusBadge status={prop.batchStatus} /></> : '—'}</td>
                {can('pricebatch.propose') && <td><button className="btn-sm" onClick={() => setPropose({ m, p })}>{t('Propose change')}</button></td>}</tr>); })}</tbody></table></div>
        </>
      )}
      {!loading && !err && view === 'matrix' && (
        <div className="table-wrap"><table className="t"><thead><tr><th>{t('Material')}</th>{(plants.data ?? []).map((p) => <th key={p.id} className="n">{p.code} <span className="muted">JOD</span></th>)}</tr></thead><tbody>
          {(mats.data ?? []).map((m) => <tr key={m.id}><td><strong>{m.nameEn}</strong> <span className="muted small">/{m.purchaseUnit}</span></td>{(plants.data ?? []).map((p) => { const x = (book.data?.prices ?? []).find((y: any) => y.materialId === m.id && y.plantId === p.id); return <td key={p.id} className="n">{x ? money(x.price) : <span className="badge err">{t('Missing')}</span>}</td>; })}</tr>)}</tbody></table></div>
      )}
      {propose && <ProposeDialog {...propose} plantId={pid} onClose={() => setPropose(null)} onDone={(id: string) => nav(`/price-book/updates/${id}`)} />}
    </div>
  );
}

function ProposeDialog({ m, p, plantId, onClose, onDone }: any) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ price: p ? String(Number(p.price)) : '', basis: p?.basis ?? 'delivered_plant', freight: p?.freight ? String(Number(p.freight)) : '', eff: today }); const [err, setErr] = useState<any>(null);
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const code = plants.data?.find((x) => x.id === plantId)?.code;
  const go = async () => {
    try {
      const b = await post('/price-batches', { name: `${m.nameEn} @ ${code} — ${f.eff}`, plantId, effectiveFrom: f.eff });
      await put(`/price-batches/${b.id}/items`, { items: [{ plantCode: code, materialCode: m.code, price: f.price, basis: f.basis, freight: f.basis === 'ex_source' ? f.freight : undefined, effectiveFrom: f.eff }] });
      onDone(b.id);
    } catch (e: any) { setErr(e); }
  };
  return (
    <Dialog title={t('Propose price change — {m}', { m: m.nameEn })} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go} disabled={!f.price}>{t('Create price proposal')}</button></>}>
      <div className="stack"><Alert tone="info">{t('This creates a draft price proposal. Nothing changes in live prices until it is reviewed and published.')}</Alert>
        {err && <Alert tone="err">{err.body?.rowErrors?.map((r: any) => r.message).join(' ') ?? err.message}</Alert>}
        <NumField label={t('Proposed price')} unit={`JOD/${m.purchaseUnit}`} value={f.price} onChange={(v) => setF({ ...f, price: v })} />
        <SelectField label={t('Price basis')} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })}><option value="delivered_plant">{t('Delivered to plant')}</option><option value="ex_source">{t('Ex-source (add procurement freight)')}</option></SelectField>
        {f.basis === 'ex_source' && <NumField label={t('Procurement freight')} unit={`JOD/${m.purchaseUnit}`} value={f.freight} onChange={(v) => setF({ ...f, freight: v })} hint={t('Enter 0 if there is none.')} />}
        <TextField label={t('Effective from')} type="date" value={f.eff} onChange={(e) => setF({ ...f, eff: e.target.value })} /></div>
    </Dialog>
  );
}
