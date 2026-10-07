import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get, post, put } from '../lib/api';
import { money, pct, qty, dateTime } from '../lib/format';
import { mixName, useLang, useT } from '../lib/i18n';
import { Alert, AuditTimeline, Dialog, EmptyState, ErrorState, Loading, NumField, SearchBox, SelectField, StatusBadge, Tabs, TextField, Toolbar, AreaField } from '../components/ui';
import { PageHead } from '../components/Shell';
import { Waterfall } from '../components/Totals';
import { issueText } from '../lib/issues';

export function MixLibrary() {
  const t = useT(); const { lang } = useLang(); const { can } = useAuth(); const nav = useNavigate();
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [plant, setPlant] = useState(''); const [create, setCreate] = useState(false);
  const mixes = useQuery({ queryKey: ['mixes'], queryFn: () => get<any[]>('/mixes') });
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const rows = useMemo(() => (mixes.data ?? []).filter((m) => {
    const n = q.toLowerCase();
    if (n && ![m.code, m.nameEn, m.nameAr, m.grade].some((v) => v?.toLowerCase().includes(n))) return false;
    if (plant && !m.plantIds.includes(plant)) return false;
    if (status === 'approved' && !m.approvedRevision) return false;
    if (status === 'draft' && !m.revisions.some((r: any) => ['draft', 'pending_technical'].includes(r.status))) return false;
    return true;
  }), [mixes.data, q, status, plant]);
  return (
    <div className="page">
      <PageHead title={t('Mix Library')}>{can('mix.create') && <button className="btn-primary" onClick={() => setCreate(true)}>{t('New mix')}</button>}</PageHead>
      <Toolbar><SearchBox value={q} onChange={setQ} placeholder={t('Search code, name or grade')} />
        <SelectField label={t('Status')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('Approved and draft')}</option><option value="approved">{t('Approved')}</option><option value="draft">{t('Drafts in progress')}</option></SelectField>
        <SelectField label={t('Plant')} value={plant} onChange={(e) => setPlant(e.target.value)}><option value="">{t('All plants')}</option>{(plants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nameEn}</option>)}</SelectField></Toolbar>
      {mixes.isLoading && <Loading />}{mixes.error && <ErrorState error={mixes.error} retry={() => mixes.refetch()} />}
      {mixes.data && rows.length === 0 && <EmptyState title={t('No mixes found')} />}
      {rows.length > 0 && (<>
        <div className="table-wrap collapse"><table className="t"><thead><tr><th>{t('Code')}</th><th>{t('Name')}</th><th>{t('Grade')}</th><th>{t('Specification')}</th><th>{t('Plants')}</th><th>{t('Revisions')}</th></tr></thead><tbody>
          {rows.map((m) => (<tr key={m.id}><td><Link className="rowlink" to={`/mixes/${m.id}`}><span className="ltr">{m.code}</span></Link></td><td>{mixName(m, lang)}</td><td>{m.grade}</td>
            <td className="small">{m.approvedRevision ? `${m.approvedRevision.spec.strengthMpa || '—'} MPa · ${t('slump')} ${m.approvedRevision.spec.slumpMm || '—'} mm` : '—'}</td>
            <td>{m.plantIds.map((p: string) => (plants.data ?? []).find((x) => x.id === p)?.code).filter(Boolean).join(', ')}</td>
            <td className="hstack">{m.revisions.slice(0, 3).map((r: any) => <span key={r.id} className="hstack"><span className="chip">r{r.revNo}</span><StatusBadge status={r.status} />{r.missingInfo.length > 0 && ['draft', 'pending_technical'].includes(r.status) && <span className="badge warn">{t('Incomplete')}</span>}</span>)}</td></tr>))}</tbody></table></div>
        <div className="cards">{rows.map((m) => <Link key={m.id} to={`/mixes/${m.id}`} className="qcard"><strong className="ltr">{m.code}</strong><div>{mixName(m, lang)}</div><div className="muted small">{m.grade}</div><div className="hstack">{m.revisions.slice(0, 2).map((r: any) => <StatusBadge key={r.id} status={r.status} />)}</div></Link>)}</div></>)}
      {create && <MixForm plants={plants.data ?? []} onClose={() => setCreate(false)} onDone={(id) => nav(`/mixes/${id}`)} />}
    </div>
  );
}

function MixForm({ plants, onClose, onDone }: { plants: any[]; onClose: () => void; onDone: (mixId: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ code: '', nameEn: '', nameAr: '', grade: '', plantIds: [] as string[] }); const [err, setErr] = useState('');
  const go = async () => { try { const r = await post('/mixes', { ...f, spec: {}, ingredients: [] }); onDone(r.mixId); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog title={t('New mix')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go} disabled={!f.code || !f.nameEn || !f.grade || !f.plantIds.length}>{t('Create draft mix')}</button></>}>
      <div className="stack">{err && <Alert tone="err">{err}</Alert>}
        <div className="row"><TextField label={t('Code')} dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /><TextField label={t('Grade')} value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} /></div>
        <TextField label={t('Name (English)')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /><TextField label={t('Name (Arabic)')} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <fieldset style={{ border: 0, padding: 0 }}><legend style={{ fontWeight: 550, fontSize: 14 }}>{t('Produced at')}</legend>{plants.map((p) => <label key={p.id} className="hstack" style={{ minHeight: 36 }}><input type="checkbox" checked={f.plantIds.includes(p.id)} onChange={(e) => setF({ ...f, plantIds: e.target.checked ? [...f.plantIds, p.id] : f.plantIds.filter((x) => x !== p.id) })} />{p.nameEn}</label>)}</fieldset></div>
    </Dialog>
  );
}

export function MixDetail() {
  const t = useT(); const { lang } = useLang(); const { id } = useParams(); const { can } = useAuth(); const qc = useQueryClient();
  const [tab, setTab] = useState('spec'); const [revId, setRevId] = useState<string | null>(null); const [edit, setEdit] = useState(false); const [err, setErr] = useState('');
  const m = useQuery({ queryKey: ['mix', id], queryFn: () => get<any>(`/mixes/${id}`) });
  const mats = useQuery({ queryKey: ['materials'], queryFn: () => get<any[]>('/materials'), enabled: can('mix.create') });
  const rev = m.data ? m.data.revisions.find((r: any) => r.id === revId) ?? m.data.approvedRevision ?? m.data.revisions[0] : null;
  const detailRev = m.data?.revisions.find((r: any) => r.id === rev?.id);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['mix', id] }); void qc.invalidateQueries({ queryKey: ['mixes'] }); };
  const act = async (path: string) => { setErr(''); try { await post(path); reload(); } catch (e) { setErr((e as Error).message); } };
  if (m.isLoading) return <div className="page"><Loading /></div>;
  if (m.error) return <div className="page"><ErrorState error={m.error} retry={() => m.refetch()} /></div>;
  const d = m.data;
  return (
    <div className="page">
      <PageHead title={<><span className="ltr">{d.code}</span> — {mixName(d, lang)}</>} sub={<span className="hstack"><span>{d.grade}</span>{detailRev && <><StatusBadge status={detailRev.status} /><span>{t('Revision')} {detailRev.revNo}</span></>}</span>}>
        <SelectField label={<span className="sr-only">{t('Revision')}</span>} value={rev?.id ?? ''} onChange={(e) => setRevId(e.target.value)}>{d.revisions.map((r: any) => <option key={r.id} value={r.id}>{t('Revision')} {r.revNo} — {t(r.status.replace('_', ' '))}</option>)}</SelectField>
        {can('mix.create') && detailRev?.status === 'draft' && <button onClick={() => setEdit(true)}>{t('Edit draft')}</button>}
        {can('mix.create') && detailRev?.status === 'draft' && <button className="btn-primary" onClick={() => act(`/mix-revisions/${detailRev.id}/submit`)}>{t('Submit for technical approval')}</button>}
        {can('mix.approve') && detailRev?.status === 'pending_technical' && <><button className="btn-primary" onClick={() => act(`/mix-revisions/${detailRev.id}/approve`)}>{t('Approve revision')}</button><button className="btn-danger" onClick={() => act(`/mix-revisions/${detailRev.id}/reject`)}>{t('Reject')}</button></>}
        {can('mix.create') && !d.revisions.some((r: any) => ['draft', 'pending_technical'].includes(r.status)) && <button onClick={async () => { await post(`/mixes/${id}/revisions`, { spec: detailRev?.spec ?? {}, ingredients: (detailRev?.ingredients ?? []).map((i: any) => ({ materialId: i.materialId, dosage: i.dosage })), notes: '' }); reload(); }}>{t('New revision')}</button>}
      </PageHead>
      {err && <Alert tone="err">{err}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'spec', label: t('Specification') }, ...(d.recipeVisible ? [{ id: 'ing', label: t('Ingredients') }] : []), { id: 'price', label: t('Pricing') }, { id: 'hist', label: t('Revision history') }]} />
      {tab === 'spec' && detailRev && <div className="card"><dl className="grid2" style={{ margin: 0 }}>
        {([['Grade', d.grade], ['Characteristic strength', detailRev.spec.strengthMpa && `${detailRev.spec.strengthMpa} MPa`], ['Slump', detailRev.spec.slumpMm && `${detailRev.spec.slumpMm} mm`], ['Max aggregate size', detailRev.spec.maxAggregateMm && `${detailRev.spec.maxAggregateMm} mm`], ['Cement type', detailRev.spec.cementType], ['Exposure class', detailRev.spec.exposure]] as const).map(([k, v]) => <div key={k}><dt className="muted small">{t(k)}</dt><dd style={{ margin: 0 }}>{v || <span className="badge warn">{t('Missing')}</span>}</dd></div>)}</dl>
        {detailRev.spec.notes && <p>{detailRev.spec.notes}</p>}</div>}
      {tab === 'ing' && detailRev && <div className="card"><div className="table-wrap"><table className="t"><thead><tr><th>{t('Material')}</th><th className="n">{t('Dosage per m³')}</th></tr></thead><tbody>{detailRev.ingredients.map((i: any) => <tr key={i.materialId}><td>{i.material}</td><td className="n">{qty(i.dosage)} {i.dosageUnit}/m³</td></tr>)}{!detailRev.ingredients.length && <tr><td colSpan={2}><span className="badge warn">{t('No ingredients yet')}</span></td></tr>}</tbody></table></div></div>}
      {tab === 'price' && detailRev && <MixPricing revId={detailRev.id} status={detailRev.status} plantIds={d.plantIds} />}
      {tab === 'hist' && <div className="stack"><div className="card"><h3>{t('Revisions')}</h3><ul>{d.revisions.map((r: any) => <li key={r.id}>{t('Revision')} {r.revNo} — <StatusBadge status={r.status} /> {r.approvedAt ? `· ${t('approved')} ${dateTime(r.approvedAt)}` : ''}</li>)}</ul></div><div className="card"><AuditTimeline events={d.history} /></div></div>}
      {edit && detailRev && mats.data && <RevisionForm rev={detailRev} mats={mats.data} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </div>
  );
}

function MixPricing({ revId, status, plantIds }: { revId: string; status: string; plantIds: string[] }) {
  const t = useT(); const { can, me } = useAuth(); const { lang } = useLang();
  const [plant, setPlant] = useState(''); const [compare, setCompare] = useState(false);
  const p = useQuery({ queryKey: ['mixprice', revId], queryFn: () => get<any>(`/mix-revisions/${revId}/pricing`) });
  if (p.isLoading) return <Loading />;
  if (p.error) return <ErrorState error={p.error} />;
  const rows: any[] = p.data.pricing;
  if (!rows.length) return <EmptyState title={t('No plants in your scope produce this mix')} />;
  const sel = rows.find((r) => r.plantId === plant) ?? rows[0];
  const i = sel.internal;
  return (
    <div className="stack">
      {status !== 'approved' && <Alert tone="info">{t('This revision is not approved yet; this is a preview and cannot be quoted.')}</Alert>}
      <div className="hstack"><SelectField label={t('Plant')} value={sel.plantId} onChange={(e) => setPlant(e.target.value)}>{rows.map((r) => <option key={r.plantId} value={r.plantId}>{r.plantName}</option>)}</SelectField><span className="muted small">{t('Prices as of {d}', { d: sel.asOf })}</span>{rows.length > 1 && <button onClick={() => setCompare(!compare)}>{compare ? t('Hide plant comparison') : t('Compare plants')}</button>}</div>
      {sel.issues.length > 0 && <Alert tone="err" title={t('Pricing is incomplete for {p}', { p: sel.plantName })}><ul>{sel.issues.map((x: any) => <li key={x.code + x.path}>{issueText(x, t)}</li>)}</ul></Alert>}
      {sel.warnings.length > 0 && <Alert tone="warn"><ul>{sel.warnings.map((x: any) => <li key={x.message}>{issueText(x, t)}</li>)}</ul></Alert>}
      <div className="card"><div className="kpis"><div className="kpi"><div className="v">{sel.customerRatePerM3 ? `${money(sel.customerRatePerM3)} JOD/m³` : '—'}</div><div className="l">{t('Proposed selling price (pre-tax)')}</div></div>
        {i && <><div className="kpi"><div className="v">{i.pricingMode === 'markup' ? t('Markup') : t('Gross margin')} {i.pricingPct}%</div><div className="l">{t('Pricing mode')}</div></div><div className="kpi"><div className="v">{i.marginPct ? pct(i.marginPct, 2) : '—'}</div><div className="l">{t('Actual margin (pre-tax)')}</div></div></>}</div>
        {i?.materials && <>
          <h3>{t('Material costs')}</h3><div className="table-wrap"><table className="t"><thead><tr><th>{t('Material')}</th><th className="n">{t('Dosage')}</th><th className="n">{t('Price')}</th><th className="n">{t('Freight')}</th><th className="n">{t('Cost')} (JOD/m³)</th></tr></thead><tbody>
            {i.materials.lines.map((l: any) => <tr key={l.materialId}><td>{l.name}<div className="muted small ltr">{l.formula}</div></td><td className="n">{qty(l.dosage)} {l.dosageUnit}/m³</td><td className="n">{money(l.basePrice)}/{l.purchaseUnit}</td><td className="n">{money(l.freight)}/{l.purchaseUnit}</td><td className="n">{money(l.costPerM3, 4)}</td></tr>)}
            <tr><td colSpan={4}><strong>{t('Materials total')}</strong></td><td className="n"><strong>{money(i.materials.total, 4)}</strong></td></tr></tbody></table></div>
          <h3 style={{ marginTop: 16 }}>{t('Production costs')}</h3><div className="table-wrap"><table className="t"><tbody>
            <tr><td>{t('Variable production costs')}</td><td className="n">{money(i.production.variableTotal, 4)} JOD/m³</td></tr>
            <tr><td>{t('Allocated fixed costs')}<div className="muted small">{money(i.production.fixedMonthlyTotal, 0)} JOD/{t('month')} ÷ {qty(i.production.forecast.monthlyM3)} m³/{t('month')} ({i.production.forecast.source}; {t('from')} {i.production.forecast.validFrom})</div></td><td className="n">{money(i.production.fixedAllocatedPerM3, 4)} JOD/m³</td></tr>
            <tr><td>{t('Corporate overhead')}</td><td className="n">{money(i.production.corporateOverheadPerM3, 4)} JOD/m³</td></tr><tr><td>{t('Risk / finance provision')}</td><td className="n">{money(i.production.riskProvisionPerM3, 4)} JOD/m³</td></tr>
            <tr><td><strong>{t('Full configured cost')}</strong></td><td className="n"><strong>{money(i.fullCostPerM3, 4)} JOD/m³</strong></td></tr></tbody></table></div>
          <p className="small muted">{t('Delivery and pumping are quoted as separate service charges and are not part of this unit price.')}</p>
          <p className="small muted">{t('Contribution before fixed-cost allocation')}: {money(i.contributionBeforeFixedPerM3, 3)} JOD/m³</p></>}
        {!i && can('price.view') && !can('cost.view') && <p className="muted small">{t('Cost breakdown is restricted to roles with cost visibility.')}</p>}</div>
      {compare && <div className="table-wrap"><table className="t"><thead><tr><th>{t('Plant')}</th><th className="n">{t('Selling price')} (JOD/m³)</th>{can('cost.view') && <th className="n">{t('Full cost')} (JOD/m³)</th>}<th>{t('Status')}</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.plantId}><td>{r.plantName}</td><td className="n">{r.comparable ? money(r.customerRatePerM3) : '—'}</td>{can('cost.view') && <td className="n">{r.internal?.fullCostPerM3 ? money(r.internal.fullCostPerM3, 4) : '—'}</td>}<td>{r.comparable ? <span className="badge ok">{t('Comparable')}</span> : <span className="badge err" title={r.issues.map((x: any) => x.message).join('; ')}>{t('Unavailable — incomplete')}</span>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function RevisionForm({ rev, mats, onClose, onDone }: { rev: any; mats: any[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [spec, setSpec] = useState({ strengthMpa: '', slumpMm: '', maxAggregateMm: '', cementType: '', exposure: '', notes: '', ...rev.spec });
  const [ings, setIngs] = useState<{ materialId: string; dosage: string }[]>(rev.ingredients.map((i: any) => ({ materialId: i.materialId, dosage: String(Number(i.dosage)) })));
  const [err, setErr] = useState('');
  const go = async () => { try { await put(`/mix-revisions/${rev.id}`, { spec, ingredients: ings.filter((i) => i.materialId && i.dosage), notes: '' }); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog wide title={t('Edit draft revision {n}', { n: rev.revNo })} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go}>{t('Save draft')}</button></>}>
      <div className="stack">{err && <Alert tone="err">{err}</Alert>}
        <div className="grid2"><NumField label={t('Characteristic strength')} unit="MPa" value={spec.strengthMpa} onChange={(v) => setSpec({ ...spec, strengthMpa: v })} /><NumField label={t('Slump')} unit="mm" value={spec.slumpMm} onChange={(v) => setSpec({ ...spec, slumpMm: v })} /><NumField label={t('Max aggregate size')} unit="mm" value={spec.maxAggregateMm} onChange={(v) => setSpec({ ...spec, maxAggregateMm: v })} />
          <TextField label={t('Cement type')} value={spec.cementType} onChange={(e) => setSpec({ ...spec, cementType: e.target.value })} /><TextField label={t('Exposure class')} value={spec.exposure} onChange={(e) => setSpec({ ...spec, exposure: e.target.value })} /></div>
        <AreaField label={t('Notes')} value={spec.notes} onChange={(e) => setSpec({ ...spec, notes: e.target.value })} />
        <h3>{t('Ingredients')}</h3>
        {ings.map((ing, i) => { const m = mats.find((x) => x.id === ing.materialId); return (
          <div className="row" key={i}><SelectField label={t('Material')} value={ing.materialId} onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))}><option value="">{t('Select…')}</option>{mats.map((x) => <option key={x.id} value={x.id}>{x.nameEn}</option>)}</SelectField>
            <NumField label={t('Dosage per m³')} unit={`${m?.dosageUnit ?? '?'}/m³`} value={ing.dosage} onChange={(v) => setIngs(ings.map((x, j) => (j === i ? { ...x, dosage: v } : x)))} /><button className="fixed btn-danger" onClick={() => setIngs(ings.filter((_, j) => j !== i))}>{t('Remove')}</button></div>); })}
        <button onClick={() => setIngs([...ings, { materialId: '', dosage: '' }])}>{t('Add ingredient')}</button></div>
    </Dialog>
  );
}
