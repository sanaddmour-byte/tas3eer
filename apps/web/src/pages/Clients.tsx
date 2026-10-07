import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get, post, put } from '../lib/api';
import { useT } from '../lib/i18n';
import { Alert, Dialog, EmptyState, ErrorState, Loading, SearchBox, SelectField, TextField, Toolbar } from '../components/ui';
import { PageHead } from '../components/Shell';

export function ClientsProjects() {
  const t = useT(); const { can } = useAuth(); const qc = useQueryClient();
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string | null>(null); const [clientDlg, setClientDlg] = useState<any>(null); const [projDlg, setProjDlg] = useState<any>(null);
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get<any[]>('/clients') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => get<any[]>('/projects') });
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants') });
  const rows = useMemo(() => (clients.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), [clients.data, q]);
  const done = () => { void qc.invalidateQueries({ queryKey: ['clients'] }); void qc.invalidateQueries({ queryKey: ['projects'] }); setClientDlg(null); setProjDlg(null); };
  if (clients.isLoading) return <div className="page"><Loading /></div>;
  if (clients.error) return <div className="page"><ErrorState error={clients.error} retry={() => clients.refetch()} /></div>;
  return (
    <div className="page">
      <PageHead title={t('Clients & Projects')}>{can('client.manage') && <button className="btn-primary" onClick={() => setClientDlg({})}>{t('Add client')}</button>}</PageHead>
      <Toolbar><SearchBox value={q} onChange={setQ} placeholder={t('Search clients')} /></Toolbar>
      {!rows.length && <EmptyState title={t('No clients found')} />}
      <div className="stack">{rows.map((c) => { const ps = (projects.data ?? []).filter((p) => p.clientId === c.id); const open = sel === c.id; return (
        <section key={c.id} className="card"><div className="card-head"><h2>{c.name}</h2>{c.taxNumber && <span className="chip">{t('Tax no.')} <span className="ltr">{c.taxNumber}</span></span>}<span className="grow" />
          <button className="btn-sm" aria-expanded={open} onClick={() => setSel(open ? null : c.id)}>{t('{n} project(s)', { n: ps.length })}</button>{can('client.manage') && <button className="btn-sm" onClick={() => setClientDlg(c)}>{t('Edit')}</button>}</div>
          <div className="small muted">{(c.contacts ?? []).map((x: any) => `${x.name} ${x.phone}`).join(' · ')}</div>
          {open && <div className="stack-sm" style={{ marginTop: 12 }}>{ps.map((p) => <div key={p.id} className="qitem"><div><div className="t1">{p.name}</div><div className="muted small">{p.siteAddress}</div></div>{can('client.manage') && <button className="btn-sm" onClick={() => setProjDlg(p)}>{t('Edit')}</button>}</div>)}
            {can('client.manage') && <button className="btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setProjDlg({ clientId: c.id })}>{t('Add project')}</button>}</div>}</section>); })}</div>
      {clientDlg && <ClientForm c={clientDlg} onClose={() => setClientDlg(null)} onDone={done} />}
      {projDlg && <ProjectForm p={projDlg} plants={plants.data ?? []} onClose={() => setProjDlg(null)} onDone={done} />}
    </div>
  );
}
function ClientForm({ c, onClose, onDone }: any) {
  const t = useT(); const [f, setF] = useState({ name: c.name ?? '', taxNumber: c.taxNumber ?? '', notes: c.notes ?? '', cn: c.contacts?.[0]?.name ?? '', cp: c.contacts?.[0]?.phone ?? '', ce: c.contacts?.[0]?.email ?? '' }); const [err, setErr] = useState('');
  const go = async () => { const body = { name: f.name, taxNumber: f.taxNumber, notes: f.notes, contacts: f.cn ? [{ name: f.cn, phone: f.cp, email: f.ce }] : [] }; try { c.id ? await put(`/clients/${c.id}`, body) : await post('/clients', body); onDone(); } catch (e) { setErr((e as Error).message); } };
  return <Dialog title={c.id ? t('Edit client') : t('Add client')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" disabled={!f.name.trim()} onClick={go}>{t('Save client')}</button></>}>
    <div className="stack">{err && <Alert tone="err">{err}</Alert>}<TextField label={t('Client name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><TextField label={t('Tax number')} dir="ltr" value={f.taxNumber} onChange={(e) => setF({ ...f, taxNumber: e.target.value })} />
      <div className="row"><TextField label={t('Contact person')} value={f.cn} onChange={(e) => setF({ ...f, cn: e.target.value })} /><TextField label={t('Phone')} dir="ltr" value={f.cp} onChange={(e) => setF({ ...f, cp: e.target.value })} /></div><TextField label={t('Email')} dir="ltr" value={f.ce} onChange={(e) => setF({ ...f, ce: e.target.value })} /></div></Dialog>;
}
function ProjectForm({ p, plants, onClose, onDone }: any) {
  const t = useT(); const [f, setF] = useState({ name: p.name ?? '', siteAddress: p.siteAddress ?? '', sn: p.siteContact?.name ?? '', sp: p.siteContact?.phone ?? '', plant: p.defaultPlantId ?? '' }); const [err, setErr] = useState('');
  const go = async () => { const body = { clientId: p.clientId, name: f.name, siteAddress: f.siteAddress, siteContact: { name: f.sn, phone: f.sp }, defaultPlantId: f.plant || null }; try { p.id ? await put(`/projects/${p.id}`, body) : await post('/projects', body); onDone(); } catch (e) { setErr((e as Error).message); } };
  return <Dialog title={p.id ? t('Edit project') : t('Add project')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" disabled={!f.name.trim()} onClick={go}>{t('Save project')}</button></>}>
    <div className="stack">{err && <Alert tone="err">{err}</Alert>}<TextField label={t('Project name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><TextField label={t('Site address')} value={f.siteAddress} onChange={(e) => setF({ ...f, siteAddress: e.target.value })} />
      <div className="row"><TextField label={t('Site contact')} value={f.sn} onChange={(e) => setF({ ...f, sn: e.target.value })} /><TextField label={t('Phone')} dir="ltr" value={f.sp} onChange={(e) => setF({ ...f, sp: e.target.value })} /></div>
      <SelectField label={t('Default supplying plant')} value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })}><option value="">{t('None')}</option>{plants.map((x: any) => <option key={x.id} value={x.id}>{x.nameEn}</option>)}</SelectField></div></Dialog>;
}
