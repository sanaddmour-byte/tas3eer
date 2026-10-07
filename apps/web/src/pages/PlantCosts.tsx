import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get, post } from '../lib/api';
import { dateFmt, money, qty } from '../lib/format';
import { useT } from '../lib/i18n';
import { usePref } from '../lib/hooks';
import { Alert, Dialog, EmptyState, ErrorState, Loading, NumField, SelectField, StatusBadge, Tabs, TextField } from '../components/ui';
import { PageHead } from '../components/Shell';

const NATURES = ['wages', 'depreciation', 'utilities', 'maintenance', 'consumables', 'other'];
const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + Number(x[k] || 0), 0);

export function PlantCosts() {
  const t = useT(); const { can } = useAuth(); const qc = useQueryClient();
  const [plantId, setPlantId] = usePref<string>('costPlant', '');
  const [tab, setTab] = useState('fixed'); const [edit, setEdit] = useState<any>(null); const [cmp, setCmp] = useState<any>(null); const [fc, setFc] = useState(false); const [err, setErr] = useState('');
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const pid = plantId || plants.data?.[0]?.id || '';
  const c = useQuery({ queryKey: ['plantcosts', pid], queryFn: () => get<any>(`/plant-costs?plantId=${pid}`), enabled: !!pid });
  const [vols, setVols] = useState('5000, 7500, 10000, 12500, 15000'); const [sens, setSens] = useState<any>(null);
  if (plants.isLoading || c.isLoading) return <div className="page"><Loading /></div>;
  const e = plants.error ?? c.error; if (e) return <div className="page"><ErrorState error={e} retry={() => c.refetch()} /></div>;
  const active = c.data.versions.find((v: any) => v.id === c.data.activeVersionId);
  const drafts = c.data.versions.filter((v: any) => v.status === 'draft');
  const forecast = c.data.forecasts.find((f: any) => f.id === c.data.activeForecastId);
  const fixedTotal = active ? sum(active.fixedCosts, 'monthlyJod') : 0;
  const alloc = forecast && Number(forecast.monthlyM3) > 0 ? fixedTotal / Number(forecast.monthlyM3) : null;
  const reload = () => { void qc.invalidateQueries({ queryKey: ['plantcosts', pid] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const publish = async (id: string) => { setErr(''); try { await post(`/plant-costs/${id}/publish`); reload(); } catch (x) { setErr((x as Error).message); } };
  const runSens = async () => { setErr(''); try { setSens(await post('/plant-costs/sensitivity', { plantId: pid, volumes: vols.split(/[\s,;]+/).filter(Boolean) })); } catch (x) { setErr((x as Error).message); } };
  const versionsPanel = (<div className="stack"><div className="table-wrap"><table className="t"><thead><tr><th>{t('Effective from')}</th><th>{t('Effective to')}</th><th>{t('Status')}</th><th className="n">{t('Fixed / month')}</th><th /></tr></thead><tbody>
          {c.data.versions.map((v: any) => <tr key={v.id}><td>{v.validFrom}</td><td>{v.validTo ?? '—'}</td><td><StatusBadge status={v.status === 'published' ? (v.id === c.data.activeVersionId ? 'active' : 'retired') : 'draft'} /></td><td className="n">{money(sum(v.fixedCosts, 'monthlyJod'), 0)}</td>
            <td className="hstack">{active && <button className="btn-sm" onClick={() => setCmp({ a: active, b: v })} disabled={v.id === active.id}>{t('Compare with active')}</button>}{v.status === 'draft' && can('plantcost.approve') && <button className="btn-sm btn-primary" onClick={() => publish(v.id)}>{t('Approve & publish')}</button>}</td></tr>)}</tbody></table></div>
          {c.data.forecasts.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>{t('Forecast from')}</th><th>{t('to')}</th><th className="n">m³/{t('month')}</th><th>{t('Source')}</th></tr></thead><tbody>{c.data.forecasts.map((f: any) => <tr key={f.id}><td>{f.validFrom}</td><td>{f.validTo ?? '—'}</td><td className="n">{qty(f.monthlyM3)}</td><td>{f.source}</td></tr>)}</tbody></table></div>}</div>);
  return (
    <div className="page">
      <PageHead title={t('Plant Costs')} sub={t('Operating costs per plant. Allocation uses the approved forecast volume; published versions are immutable.')}>
        {can('plantcost.manage') && active && <button className="btn-primary" onClick={() => setEdit({ base: active })}>{t('New draft revision')}</button>}
        {can('forecast.manage') && <button onClick={() => setFc(true)}>{t('New forecast volume')}</button>}</PageHead>
      <div className="toolbar"><SelectField label={t('Plant')} value={pid} onChange={(e) => setPlantId(e.target.value)}>{(plants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nameEn} ({p.code})</option>)}</SelectField></div>
      {err && <Alert tone="err">{err}</Alert>}
      {!active ? <><EmptyState title={t('No published cost version for this plant')} action={can('plantcost.manage') && drafts.length === 0 ? <button className="btn-primary" onClick={() => setEdit({ base: null })}>{t('Create first cost version')}</button> : undefined}>{t('Quotations cannot be priced until a cost version is published.')}</EmptyState>{c.data.versions.length > 0 && <div style={{ marginTop: 16 }}><h2>{t('Versions')}</h2>{versionsPanel}</div>}</> : (<>
        <div className="kpis">
          <div className="kpi"><div className="v">{money(fixedTotal, 0)} JOD/{t('month')}</div><div className="l">{t('Approved monthly fixed costs')}</div></div>
          <div className="kpi"><div className="v">{forecast ? `${qty(forecast.monthlyM3)} m³/${t('month')}` : '—'}</div><div className="l">{t('Forecast volume')} {forecast ? `(${forecast.source}; ${t('from')} ${dateFmt(forecast.validFrom)})` : ''}</div></div>
          <div className="kpi"><div className="v">{alloc != null ? `${money(alloc, 4)} JOD/m³` : '—'}</div><div className="l">{t('Allocated fixed cost per m³')}</div></div>
        </div>
        {!forecast && <Alert tone="warn">{t('Enter a monthly forecast volume to allocate fixed costs.')}</Alert>}
        <p className="small muted">{t('Active version effective from {d}.', { d: dateFmt(active.validFrom) })} {t('Contribution (before fixed costs) and margin after full configured cost are shown on quotations; neither is EBITDA.')}</p>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'fixed', label: t('Monthly fixed costs') }, { id: 'var', label: t('Variable production costs') }, { id: 'delivery', label: t('Delivery') }, { id: 'pumping', label: t('Pumping') }, { id: 'corp', label: t('Corporate / commercial') }, { id: 'sens', label: t('Volume sensitivity') }, { id: 'versions', label: t('Versions') }]} />
        {tab === 'fixed' && <div className="table-wrap"><table className="t"><thead><tr><th>{t('Cost')}</th><th>{t('Nature')}</th><th className="n">JOD/{t('month')}</th><th className="n">JOD/m³ ({t('at forecast')})</th></tr></thead><tbody>{active.fixedCosts.map((f: any) => <tr key={f.key}><td>{f.name}</td><td>{t(f.nature)}</td><td className="n">{money(f.monthlyJod, 2)}</td><td className="n">{forecast ? money(Number(f.monthlyJod) / Number(forecast.monthlyM3), 4) : '—'}</td></tr>)}<tr><td colSpan={2}><strong>{t('Total')}</strong></td><td className="n"><strong>{money(fixedTotal, 2)}</strong></td><td className="n"><strong>{alloc != null ? money(alloc, 4) : '—'}</strong></td></tr></tbody></table></div>}
        {tab === 'var' && <div className="table-wrap"><table className="t"><thead><tr><th>{t('Cost')}</th><th>{t('Nature')}</th><th className="n">JOD/m³</th></tr></thead><tbody>{active.variableCosts.map((f: any) => <tr key={f.key}><td>{f.name}</td><td>{t(f.nature)}</td><td className="n">{money(f.jodPerM3, 4)}</td></tr>)}<tr><td colSpan={2}><strong>{t('Total')}</strong></td><td className="n"><strong>{money(sum(active.variableCosts, 'jodPerM3'), 4)}</strong></td></tr></tbody></table></div>}
        {tab === 'delivery' && <div className="stack"><Alert tone="info">{t('Estimated operating costs (internal) are kept separate from customer-facing charges.')}</Alert><div className="table-wrap"><table className="t"><thead><tr><th>{t('Method')}</th><th className="n">{t('Customer charge')}</th><th className="n">{t('Estimated cost')}</th></tr></thead><tbody>
          {active.delivery.perM3 && <tr><td>{t('Per m³')}</td><td className="n">{money(active.delivery.perM3.chargePerM3)} JOD/m³</td><td className="n">{money(active.delivery.perM3.costPerM3)} JOD/m³</td></tr>}
          {active.delivery.zones.map((z: any) => <tr key={z.code}><td>{z.name} ({z.code})</td><td className="n">{money(z.chargePerM3)} JOD/m³</td><td className="n">{money(z.costPerM3)} JOD/m³</td></tr>)}
          {active.delivery.trip && <tr><td>{t('Per trip')} ({active.delivery.trip.truckCapacityM3} m³ {t('truck')})</td><td className="n">{money(active.delivery.trip.chargePerTrip)} JOD/{t('trip')}</td><td className="n">{money(active.delivery.trip.fixedCostPerTrip)} JOD/{t('trip')} + {money(active.delivery.trip.costPerKm)} JOD/km</td></tr>}</tbody></table></div></div>}
        {tab === 'pumping' && (active.pumping ? <div className="table-wrap"><table className="t"><tbody>
          <tr><td>{t('Volume rate')}</td><td className="n">{money(active.pumping.chargePerM3)} JOD/m³</td></tr><tr><td>{t('Minimum charge')}</td><td className="n">{money(active.pumping.minCharge)} JOD {t(active.pumping.minBasis.replace('_', ' '))}</td></tr>
          <tr><td>{t('Mobilization / setup fee')}</td><td className="n">{money(active.pumping.mobilizationFee)} JOD {t(active.pumping.minBasis.replace('_', ' '))}</td></tr><tr><td>{t('Additional hour rate')}</td><td className="n">{money(active.pumping.extraHourRate)} JOD/h</td></tr>
          <tr><td>{t('Estimated operating cost')}</td><td className="n">{money(active.pumping.costPerM3)} JOD/m³ + {money(active.pumping.costPerUnit)} JOD {t(active.pumping.minBasis.replace('_', ' '))}</td></tr></tbody></table></div> : <EmptyState title={t('No pumping assumptions configured')} />)}
        {tab === 'corp' && <div className="table-wrap"><table className="t"><tbody><tr><td>{t('Corporate overhead allocation')}</td><td className="n">{money(active.corporateOverheadPerM3, 4)} JOD/m³</td></tr><tr><td>{t('Explicit commercial risk / finance provision')}</td><td className="n">{money(active.riskProvisionPerM3, 4)} JOD/m³</td></tr></tbody></table></div>}
        {tab === 'sens' && can('cost.view') && <div className="card stack"><Alert tone="info">{t('Sensitivity view — illustrative only. It does not change any published price or cost.')}</Alert>
          <div className="row"><TextField label={t('Monthly volumes to test (m³/month)')} value={vols} onChange={(e) => setVols(e.target.value)} hint={t('Separate with commas')} /><button className="fixed" onClick={runSens}>{t('Calculate')}</button></div>
          {sens && <div className="table-wrap"><table className="t"><thead><tr><th className="n">{t('Monthly volume')} (m³)</th><th className="n">{t('Allocated fixed cost')} (JOD/m³)</th><th className="n">{t('vs published')}</th></tr></thead><tbody>{sens.rows.map((r: any) => <tr key={r.monthlyM3}><td className="n">{qty(r.monthlyM3)}</td><td className="n">{r.allocatedPerM3 ? money(r.allocatedPerM3, 4) : r.error}</td><td className="n">{r.allocatedPerM3 && alloc != null ? `${Number(r.allocatedPerM3) - alloc >= 0 ? '+' : ''}${money(Number(r.allocatedPerM3) - alloc, 4)}` : '—'}</td></tr>)}</tbody></table></div>}</div>}
        {tab === 'versions' && versionsPanel}
        {drafts.length > 0 && tab !== 'versions' && <div style={{ marginTop: 16 }}><Alert tone="warn" title={t('{n} draft revision(s) awaiting approval', { n: drafts.length })}><button className="btn-sm" onClick={() => setTab('versions')}>{t('Review drafts')}</button></Alert></div>}
      </>)}
      {edit && <CostEditor plantId={pid} base={edit.base} forecast={forecast} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); setTab('versions'); }} />}
      {cmp && <Dialog wide title={t('Before / after comparison')} onClose={() => setCmp(null)}><Compare a={cmp.a} b={cmp.b} forecast={forecast} /></Dialog>}
      {fc && <ForecastForm plantId={pid} onClose={() => setFc(false)} onDone={() => { setFc(false); reload(); }} />}
    </div>
  );
}
function Compare({ a, b, forecast }: any) {
  const t = useT();
  const fx = (v: any) => sum(v.fixedCosts, 'monthlyJod'), vr = (v: any) => sum(v.variableCosts, 'jodPerM3'); const vol = forecast ? Number(forecast.monthlyM3) : 0;
  const rows: [string, number | null, number | null, string][] = [[t('Monthly fixed costs'), fx(a), fx(b), 'JOD/' + t('month')], [t('Allocated fixed per m³'), vol ? fx(a) / vol : null, vol ? fx(b) / vol : null, 'JOD/m³'], [t('Variable production'), vr(a), vr(b), 'JOD/m³'], [t('Corporate overhead'), Number(a.corporateOverheadPerM3), Number(b.corporateOverheadPerM3), 'JOD/m³'], [t('Risk provision'), Number(a.riskProvisionPerM3), Number(b.riskProvisionPerM3), 'JOD/m³']];
  return <div className="table-wrap"><table className="t"><thead><tr><th>{t('Item')}</th><th className="n">{t('Active')}</th><th className="n">{t('Draft')} ({b.validFrom})</th><th className="n">{t('Change')}</th></tr></thead><tbody>{rows.map(([k, x, y, u]) => <tr key={k}><td>{k} <span className="muted small">{u}</span></td><td className="n">{x != null ? money(x, 4) : '—'}</td><td className="n">{y != null ? money(y, 4) : '—'}</td><td className="n">{x != null && y != null ? `${y - x >= 0 ? '+' : ''}${money(y - x, 4)}` : '—'}</td></tr>)}</tbody></table></div>;
}
function ForecastForm({ plantId, onClose, onDone }: any) {
  const t = useT(); const [f, setF] = useState({ monthlyM3: '', validFrom: new Date().toISOString().slice(0, 10), source: '' }); const [err, setErr] = useState('');
  const go = async () => { try { await post('/forecasts', { plantId, ...f }); onDone(); } catch (e) { setErr((e as Error).message); } };
  return <Dialog title={t('New forecast volume')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go} disabled={!(Number(f.monthlyM3) > 0) || f.source.length < 2}>{t('Publish forecast')}</button></>}>
    <div className="stack">{err && <Alert tone="err">{err}</Alert>}<NumField label={t('Monthly forecast volume')} unit="m³/month" value={f.monthlyM3} onChange={(v) => setF({ ...f, monthlyM3: v })} error={f.monthlyM3 !== '' && !(Number(f.monthlyM3) > 0) ? t('Forecast volume must be greater than zero.') : null} /><TextField label={t('Effective from')} type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /><TextField label={t('Source / approval reference')} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div></Dialog>;
}
function CostEditor({ plantId, base, forecast, onClose, onDone }: any) {
  const t = useT();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [s, setS] = useState<any>(() => ({ validFrom: tomorrow, fixedCosts: base?.fixedCosts ?? [], variableCosts: base?.variableCosts ?? [], corporateOverheadPerM3: base ? String(Number(base.corporateOverheadPerM3)) : '0', riskProvisionPerM3: base ? String(Number(base.riskProvisionPerM3)) : '0',
    delivery: base?.delivery ?? { perM3: null, zones: [], trip: null }, pumping: base?.pumping ?? null, note: '' }));
  const [err, setErr] = useState<any>(null);
  const fx = sum(s.fixedCosts, 'monthlyJod'); const vol = forecast ? Number(forecast.monthlyM3) : 0;
  const key = () => Math.random().toString(36).slice(2, 8);
  const go = async () => { try { await post('/plant-costs', { plantId, ...s }); onDone(); } catch (e) { setErr(e); } };
  const pump = s.pumping ?? { chargePerM3: '0', minCharge: '0', minBasis: 'per_visit', mobilizationFee: '0', extraHourRate: '0', costPerM3: '0', costPerUnit: '0' };
  const setP = (k: string, v: string) => setS({ ...s, pumping: { ...pump, [k]: v } });
  const dm = s.delivery.perM3 ?? { chargePerM3: '0', costPerM3: '0' };
  return (
    <Dialog wide title={t('Draft plant cost revision')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={go}>{t('Save draft revision')}</button></>}>
      <div className="stack">{err && <Alert tone="err">{err.message}{err.body?.issues?.length > 1 && <ul>{err.body.issues.map((i: any, n: number) => <li key={n}>{i.message}</li>)}</ul>}</Alert>}
        <Alert tone="info">{t('Saved as a draft with its own effective date. It affects prices only after another authorised user approves it.')}</Alert>
        <TextField label={t('Effective from')} type="date" value={s.validFrom} onChange={(e) => setS({ ...s, validFrom: e.target.value })} />
        <h3>{t('Monthly fixed costs')} — {money(fx, 2)} JOD/{t('month')} {vol ? `→ ${money(fx / vol, 4)} JOD/m³` : ''}</h3>
        {s.fixedCosts.map((f: any, i: number) => <div className="row" key={f.key}><TextField label={t('Cost')} value={f.name} onChange={(e) => setS({ ...s, fixedCosts: s.fixedCosts.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <SelectField label={t('Nature')} value={f.nature} onChange={(e) => setS({ ...s, fixedCosts: s.fixedCosts.map((x: any, j: number) => (j === i ? { ...x, nature: e.target.value } : x)) })}>{NATURES.map((n) => <option key={n} value={n}>{t(n)}</option>)}</SelectField>
          <NumField label={t('Amount')} unit="JOD/month" value={String(f.monthlyJod)} onChange={(v) => setS({ ...s, fixedCosts: s.fixedCosts.map((x: any, j: number) => (j === i ? { ...x, monthlyJod: v } : x)) })} /><button className="fixed btn-danger" onClick={() => setS({ ...s, fixedCosts: s.fixedCosts.filter((_: any, j: number) => j !== i) })}>{t('Remove')}</button></div>)}
        <button onClick={() => setS({ ...s, fixedCosts: [...s.fixedCosts, { key: key(), name: '', nature: 'other', monthlyJod: '0' }] })}>{t('Add fixed cost')}</button>
        <h3>{t('Variable production costs')}</h3>
        {s.variableCosts.map((f: any, i: number) => <div className="row" key={f.key}><TextField label={t('Cost')} value={f.name} onChange={(e) => setS({ ...s, variableCosts: s.variableCosts.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <SelectField label={t('Nature')} value={f.nature} onChange={(e) => setS({ ...s, variableCosts: s.variableCosts.map((x: any, j: number) => (j === i ? { ...x, nature: e.target.value } : x)) })}>{NATURES.map((n) => <option key={n} value={n}>{t(n)}</option>)}</SelectField>
          <NumField label={t('Amount')} unit="JOD/m³" value={String(f.jodPerM3)} onChange={(v) => setS({ ...s, variableCosts: s.variableCosts.map((x: any, j: number) => (j === i ? { ...x, jodPerM3: v } : x)) })} /><button className="fixed btn-danger" onClick={() => setS({ ...s, variableCosts: s.variableCosts.filter((_: any, j: number) => j !== i) })}>{t('Remove')}</button></div>)}
        <button onClick={() => setS({ ...s, variableCosts: [...s.variableCosts, { key: key(), name: '', nature: 'other', jodPerM3: '0' }] })}>{t('Add variable cost')}</button>
        <h3>{t('Corporate / commercial')}</h3>
        <div className="row"><NumField label={t('Corporate overhead')} unit="JOD/m³" value={s.corporateOverheadPerM3} onChange={(v) => setS({ ...s, corporateOverheadPerM3: v })} /><NumField label={t('Risk / finance provision')} unit="JOD/m³" value={s.riskProvisionPerM3} onChange={(v) => setS({ ...s, riskProvisionPerM3: v })} /></div>
        <h3>{t('Delivery')}</h3>
        <div className="row"><NumField label={t('Customer charge (per m³)')} unit="JOD/m³" value={String(dm.chargePerM3)} onChange={(v) => setS({ ...s, delivery: { ...s.delivery, perM3: { ...dm, chargePerM3: v } } })} /><NumField label={t('Estimated cost (per m³)')} unit="JOD/m³" value={String(dm.costPerM3)} onChange={(v) => setS({ ...s, delivery: { ...s.delivery, perM3: { ...dm, costPerM3: v } } })} /></div>
        {s.delivery.zones.map((z: any, i: number) => <div className="row" key={z.code + i}><TextField label={t('Zone code')} value={z.code} onChange={(e) => setS({ ...s, delivery: { ...s.delivery, zones: s.delivery.zones.map((x: any, j: number) => (j === i ? { ...x, code: e.target.value } : x)) } })} /><TextField label={t('Zone name')} value={z.name} onChange={(e) => setS({ ...s, delivery: { ...s.delivery, zones: s.delivery.zones.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
          <NumField label={t('Charge')} unit="JOD/m³" value={String(z.chargePerM3)} onChange={(v) => setS({ ...s, delivery: { ...s.delivery, zones: s.delivery.zones.map((x: any, j: number) => (j === i ? { ...x, chargePerM3: v } : x)) } })} /><NumField label={t('Cost')} unit="JOD/m³" value={String(z.costPerM3)} onChange={(v) => setS({ ...s, delivery: { ...s.delivery, zones: s.delivery.zones.map((x: any, j: number) => (j === i ? { ...x, costPerM3: v } : x)) } })} /></div>)}
        <button onClick={() => setS({ ...s, delivery: { ...s.delivery, zones: [...s.delivery.zones, { code: `Z${s.delivery.zones.length + 1}`, name: '', chargePerM3: '0', costPerM3: '0' }] } })}>{t('Add delivery zone')}</button>
        <h3>{t('Pumping')}</h3>
        <div className="grid2"><NumField label={t('Volume rate')} unit="JOD/m³" value={String(pump.chargePerM3)} onChange={(v) => setP('chargePerM3', v)} /><NumField label={t('Minimum charge')} unit="JOD" value={String(pump.minCharge)} onChange={(v) => setP('minCharge', v)} />
          <SelectField label={t('Minimum applies')} value={pump.minBasis} onChange={(e) => setP('minBasis', e.target.value)}><option value="per_visit">{t('per visit')}</option><option value="per_pour">{t('per pour')}</option><option value="per_pump">{t('per pump')}</option><option value="per_quotation">{t('per quotation')}</option></SelectField>
          <NumField label={t('Mobilization / setup fee')} unit="JOD" value={String(pump.mobilizationFee)} onChange={(v) => setP('mobilizationFee', v)} /><NumField label={t('Additional hour rate')} unit="JOD/h" value={String(pump.extraHourRate)} onChange={(v) => setP('extraHourRate', v)} /><NumField label={t('Estimated cost')} unit="JOD/m³" value={String(pump.costPerM3)} onChange={(v) => setP('costPerM3', v)} /><NumField label={t('Estimated cost per visit/pour/pump')} unit="JOD" value={String(pump.costPerUnit)} onChange={(v) => setP('costPerUnit', v)} /></div>
        {base?.delivery?.trip && <p className="small muted">{t('Trip-based assumptions are carried over unchanged.')}</p>}
      </div>
    </Dialog>
  );
}
