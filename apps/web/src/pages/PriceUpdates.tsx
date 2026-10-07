import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { ApiError, download, get, post, put } from '../lib/api';
import { dateTime, money, pct } from '../lib/format';
import { useT } from '../lib/i18n';
import { Alert, AreaField, Dialog, EmptyState, ErrorState, Loading, NumField, SelectField, StatusBadge, Tabs, TextField } from '../components/ui';
import { PageHead } from '../components/Shell';

export function PriceUpdates() {
  const t = useT(); const { can } = useAuth(); const nav = useNavigate();
  const [create, setCreate] = useState(false);
  const b = useQuery({ queryKey: ['batches'], queryFn: () => get<any[]>('/price-batches') });
  return (
    <div className="page">
      <PageHead title={t('Price Updates')} sub={t('Upload or edit → validate → review impact → submit → approve & publish')}>
        <button onClick={() => download('/price-batches/template', 'price-update-template.xlsx')}>{t('Download Excel template')}</button>
        {can('pricebatch.propose') && <button className="btn-primary" onClick={() => setCreate(true)}>{t('New price update')}</button>}</PageHead>
      <Tabs value="updates" onChange={(x) => x === 'prices' && nav('/price-book')} tabs={[{ id: 'prices', label: t('Prices') }, { id: 'updates', label: t('Price updates') }]} />
      {b.isLoading && <Loading />}{b.error && <ErrorState error={b.error} retry={() => b.refetch()} />}
      {b.data && !b.data.length && <EmptyState title={t('No price updates yet')} />}
      {b.data && b.data.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>{t('Name')}</th><th>{t('Status')}</th><th>{t('Source')}</th><th className="n">{t('Changes')}</th><th>{t('Effective from')}</th><th>{t('Created')}</th></tr></thead><tbody>
        {b.data.map((x) => <tr key={x.id}><td><Link className="rowlink" to={`/price-book/updates/${x.id}`}>{x.name}</Link></td><td><StatusBadge status={x.status} /></td><td>{x.source === 'excel' ? `Excel ${x.fileName ?? ''}` : t('Manual')}</td><td className="n">{x.itemCount}</td><td>{x.effectiveFrom}</td><td>{dateTime(x.createdAt)}</td></tr>)}</tbody></table></div>}
      {create && <NewBatch onClose={() => setCreate(false)} onDone={(id) => nav(`/price-book/updates/${id}`)} />}
    </div>
  );
}
function NewBatch({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const t = useT(); const [name, setName] = useState(''); const [eff, setEff] = useState(new Date().toISOString().slice(0, 10)); const [err, setErr] = useState('');
  const go = async () => { try { const b = await post('/price-batches', { name, effectiveFrom: eff }); onDone(b.id); } catch (e) { setErr((e as Error).message); } };
  return <Dialog title={t('New price update')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go} disabled={name.trim().length < 2}>{t('Create draft')}</button></>}>
    <div className="stack">{err && <Alert tone="err">{err}</Alert>}<TextField label={t('Name')} value={name} onChange={(e) => setName(e.target.value)} /><TextField label={t('Default effective date')} type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></div></Dialog>;
}

export function PriceBatchDetail() {
  const t = useT(); const { id } = useParams(); const { can, me } = useAuth(); const qc = useQueryClient();
  const [rowErrors, setRowErrors] = useState<any[]>([]); const [err, setErr] = useState(''); const [stale, setStale] = useState<any[]>([]);
  const [dlg, setDlg] = useState<null | 'approve' | 'return' | 'reject'>(null); const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<any[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => get<any>(`/price-batches/${id}`) });
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const mats = useQuery({ queryKey: ['materials'], queryFn: () => get<any[]>('/materials') });
  const reload = () => { void qc.invalidateQueries({ queryKey: ['batch', id] }); void qc.invalidateQueries({ queryKey: ['batches'] }); void qc.invalidateQueries({ queryKey: ['pricebook'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const act = async (fn: () => Promise<any>) => { setErr(''); setRowErrors([]); setStale([]); try { await fn(); setDlg(null); setComment(''); reload(); } catch (e) { const x = e as ApiError; if (x.body?.rowErrors) setRowErrors(x.body.rowErrors); if (x.body?.stale) setStale(x.body.stale); setErr(x.message); } };
  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const { batch: b, items, impact, stale: staleIds } = q.data;
  const draft = b.status === 'draft';
  const mine = b.createdBy === me!.user.id;
  const selfBlock = (b.submittedBy === me!.user.id || mine) && b.status === 'submitted';
  const impactBy = (pid: string) => impact.filter((x: any) => x.plantId === pid);
  const upload = async (f: File) => { const fd = new FormData(); fd.append('file', f); await act(() => post(`/price-batches/${id}/upload`, fd)); };
  return (
    <div className="page">
      <PageHead title={b.name} sub={<span className="hstack"><StatusBadge status={b.status} /><span>{t('Revision')} {b.currentRevision}</span><span>{t('Effective')} {b.effectiveFrom}</span></span>}>
        {draft && can('pricebatch.propose') && <><input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><button onClick={() => file.current?.click()}>{t('Upload Excel')}</button><button onClick={() => download('/price-batches/template', 'price-update-template.xlsx')}>{t('Template')}</button>
          <button onClick={() => setEditing(items.map((i: any) => ({ plantCode: i.plantCode, materialCode: i.materialCode, price: String(Number(i.proposedPrice)), basis: i.proposedBasis, freight: i.proposedFreight != null ? String(Number(i.proposedFreight)) : '', effectiveFrom: i.effectiveFrom })))}>{t('Edit rows')}</button>
          <button className="btn-primary" disabled={!items.length} onClick={() => act(() => post(`/price-batches/${id}/submit`))}>{t('Submit for approval')}</button></>}
        {b.status === 'submitted' && can('pricebatch.approve') && <><button className="btn-primary" disabled={selfBlock} onClick={() => setDlg('approve')}>{t('Approve & publish')}</button><button onClick={() => setDlg('return')}>{t('Return for changes')}</button><button className="btn-danger" onClick={() => setDlg('reject')}>{t('Reject')}</button></>}
        {['returned', 'rejected', 'submitted'].includes(b.status) && can('pricebatch.propose') && <button onClick={() => act(() => post(`/price-batches/${id}/revise`))}>{t('Revise as new draft')}</button>}
      </PageHead>
      {selfBlock && <Alert tone="info">{t('A different user must approve a batch you proposed.')}</Alert>}
      {err && <div style={{ margin: '12px 0' }}><Alert tone="err" title={err}>{rowErrors.length > 0 && <div className="table-wrap" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>{t('Row')}</th><th>{t('Field')}</th><th>{t('Problem')}</th></tr></thead><tbody>{rowErrors.map((r, i) => <tr key={i}><td className="n">{r.rowNo}</td><td>{r.field}</td><td>{r.message}</td></tr>)}</tbody></table></div>}</Alert></div>}
      {stale.length > 0 && <Alert tone="warn">{t('Live prices changed after this proposal was prepared. Revise it against the current prices.')}</Alert>}
      {staleIds.length > 0 && b.status !== 'published' && <div style={{ margin: '12px 0' }}><Alert tone="warn" title={t('{n} price(s) are now stale', { n: staleIds.length })}>{t('The active price changed since this proposal was created; it cannot be published as is.')}</Alert></div>}
      <div className="card"><h2>{t('Current vs proposed')}</h2>
        {!items.length ? <EmptyState title={t('No price changes yet')}>{t('Upload the Excel template or use “Edit rows”. Invalid files are rejected as a whole.')}</EmptyState> :
          <div className="table-wrap"><table className="t"><thead><tr><th>{t('Plant')}</th><th>{t('Material')}</th><th className="n">{t('Current')} (JOD)</th><th className="n">{t('Proposed')} (JOD)</th><th className="n">{t('Change')}</th><th className="n">%</th><th>{t('Effective')}</th></tr></thead><tbody>
            {items.map((i: any) => <tr key={i.id}><td>{i.plantCode}</td><td>{i.materialName} <span className="muted small">/{i.purchaseUnit}</span></td><td className="n">{i.basePrice != null ? <><span className="chip active-tag">{t('Active')}</span> {money(i.basePrice)}</> : '—'}</td>
              <td className="n"><span className="chip proposed-tag">{t('Proposed')}</span> {money(i.proposedPrice)}{i.proposedBasis === 'ex_source' ? ` + ${money(i.proposedFreight)}` : ''}</td><td className="n">{i.change != null ? `${Number(i.change) > 0 ? '+' : ''}${money(i.change, 4)}` : '—'}</td><td className="n">{i.changePct != null ? `${Number(i.changePct) > 0 ? '+' : ''}${pct(i.changePct)}` : '—'}</td><td>{i.effectiveFrom} {i.stale && <span className="badge warn">{t('Stale')}</span>}</td></tr>)}</tbody></table></div>}</div>
      {impact.length > 0 && <div className="card"><h2>{t('Estimated impact on approved mixes')}</h2><p className="small muted">{t('Material cost per m³ before and after, at the affected plant. Excludes production costs and margin.')}</p>
        <div className="table-wrap"><table className="t"><thead><tr><th>{t('Plant')}</th><th>{t('Mix')}</th><th className="n">{t('Before')} JOD/m³</th><th className="n">{t('After')} JOD/m³</th><th className="n">{t('Change')}</th></tr></thead><tbody>
          {impact.map((x: any) => <tr key={x.plantId + x.mixRevisionId}><td>{plants.data?.find((p) => p.id === x.plantId)?.code}</td><td><span className="ltr">{x.code}</span></td><td className="n">{x.before ? money(x.before, 4) : '—'}</td><td className="n">{x.after ? money(x.after, 4) : '—'}</td><td className="n">{x.delta ? `${Number(x.delta) > 0 ? '+' : ''}${money(x.delta, 4)} (${x.pct}%)` : t('Incomplete')}</td></tr>)}</tbody></table></div></div>}
      <div className="card"><h2>{t('Approval history')}</h2><ol className="timeline">{b.history.map((h: any, i: number) => <li key={i}><strong>{t(h.action.replaceAll('_', ' '))}</strong> <span className="muted small">— {h.by}</span><div className="muted small ltr">{dateTime(h.at)}</div>{h.comment && <div className="small">“{h.comment}”</div>}</li>)}</ol></div>
      {dlg && <Dialog title={dlg === 'approve' ? t('Approve & publish') : dlg === 'return' ? t('Return for changes') : t('Reject')} onClose={() => setDlg(null)} footer={<><button onClick={() => setDlg(null)}>{t('Cancel')}</button><button className={dlg === 'reject' ? 'btn-danger' : 'btn-primary'} onClick={() => act(() => post(`/price-batches/${id}/${dlg}`, { comment }))} disabled={dlg !== 'approve' && comment.trim().length < 3}>{dlg === 'approve' ? t('Approve & publish') : dlg === 'return' ? t('Return for changes') : t('Reject')}</button></>}>
        <div className="stack">{dlg === 'approve' && <p>{t('Publishing closes the current prices at the effective date and creates new immutable versions, in one transaction.')}</p>}<AreaField label={dlg === 'approve' ? t('Comment (optional)') : t('Reason')} value={comment} onChange={(e) => setComment(e.target.value)} /></div></Dialog>}
      {editing && <EditRows rows={editing} plants={plants.data ?? []} mats={mats.data ?? []} onClose={() => setEditing(null)} onSave={async (r: any[]) => { await act(() => put(`/price-batches/${id}/items`, { items: r })); if (!rowErrors.length) setEditing(null); }} errors={rowErrors} defaultDate={b.effectiveFrom} />}
    </div>
  );
}
function EditRows({ rows, plants, mats, onClose, onSave, errors, defaultDate }: any) {
  const t = useT(); const [r, setR] = useState<any[]>(rows.length ? rows : [{ plantCode: plants[0]?.code ?? '', materialCode: '', price: '', basis: 'delivered_plant', freight: '', effectiveFrom: defaultDate }]);
  const upd = (i: number, p: any) => setR(r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog wide title={t('Edit price rows')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={() => onSave(r.map((x) => ({ ...x, freight: x.basis === 'ex_source' ? x.freight : undefined })))}>{t('Validate & save')}</button></>}>
      <div className="stack">{errors.length > 0 && <Alert tone="err"><ul>{errors.map((e: any, i: number) => <li key={i}>{t('Row')} {e.rowNo}: {e.message}</li>)}</ul></Alert>}
        {r.map((x, i) => <div className="row" key={i}><SelectField label={t('Plant')} value={x.plantCode} onChange={(e) => upd(i, { plantCode: e.target.value })}>{plants.map((p: any) => <option key={p.id} value={p.code}>{p.code}</option>)}</SelectField>
          <SelectField label={t('Material')} value={x.materialCode} onChange={(e) => upd(i, { materialCode: e.target.value })}><option value="">{t('Select…')}</option>{mats.map((m: any) => <option key={m.id} value={m.code}>{m.nameEn}</option>)}</SelectField>
          <NumField label={t('Price')} unit="JOD" value={x.price} onChange={(v) => upd(i, { price: v })} /><SelectField label={t('Basis')} value={x.basis} onChange={(e) => upd(i, { basis: e.target.value })}><option value="delivered_plant">{t('Delivered to plant')}</option><option value="ex_source">{t('Ex-source')}</option></SelectField>
          {x.basis === 'ex_source' && <NumField label={t('Freight')} unit="JOD" value={x.freight} onChange={(v) => upd(i, { freight: v })} />}<TextField label={t('Effective from')} type="date" value={x.effectiveFrom} onChange={(e) => upd(i, { effectiveFrom: e.target.value })} />
          <button className="fixed btn-danger" onClick={() => setR(r.filter((_, j) => j !== i))}>{t('Remove')}</button></div>)}
        <button onClick={() => setR([...r, { plantCode: plants[0]?.code ?? '', materialCode: '', price: '', basis: 'delivered_plant', freight: '', effectiveFrom: defaultDate }])}>{t('Add row')}</button></div></Dialog>
  );
}
