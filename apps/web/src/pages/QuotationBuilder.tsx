import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { previewCustomerTotals } from '@rm/engine';
import type { QuoteDocument } from '@rm/shared';
import { useAuth } from '../auth';
import { ApiError, get, post } from '../lib/api';
import { uid, money, qty } from '../lib/format';
import { mixName, useLang, useT } from '../lib/i18n';
import { usePref, useSyncStatus } from '../lib/hooks';
import { issueText } from '../lib/issues';
import { cacheDraft, flush, getDraft, getOp, getReference, onSaved, queueSave, refreshReference, resolveConflict, subscribe, listOutbox } from '../offline/store';
import { Combobox } from '../components/Combobox';
import { Alert, AreaField, Dialog, EmptyState, ErrorState, Icon, Loading, NumField, SelectField, StatusBadge, TextField } from '../components/ui';
import { PageHead } from '../components/Shell';
import { IssuesList, TotalsPanel, fieldId } from '../components/Totals';

/** Lines without a chosen mix are UI-only placeholders; they are not sent to the server or stored in the outbox. */
const persistable = (d: QuoteDocument): QuoteDocument => ({ ...d, lines: d.lines.filter((l) => l.mixRevisionId) });
const EMPTY: QuoteDocument = { clientId: null, projectId: null, plantId: null, scope: 'supply_only', taxPolicyId: null, termsVersionId: null, validityDays: 14, paymentTerms: '', supplySchedule: '', customerNotes: '', internalNotes: '', lines: [], services: [], pinnedReference: false };
type Save = 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';
const STEPS = ['Client & project', 'Concrete & services', 'Commercial terms', 'Review & issue'];
const CODE_FIELD: Record<string, [string, number]> = { client_missing: ['f-client', 0], project_missing: ['f-project', 0], plant_missing: ['f-plant', 0], terms_missing: ['f-terms', 2], payment_terms_missing: ['f-payment', 2] };

function useMedia(q: string) { const [m, setM] = useState(() => matchMedia(q).matches); useEffect(() => { const l = matchMedia(q); const f = () => setM(l.matches); l.addEventListener('change', f); return () => l.removeEventListener('change', f); }, [q]); return m; }

export function QuotationBuilder() {
  const t = useT();
  const { lang } = useLang();
  const { can, me } = useAuth();
  const nav = useNavigate();
  const { id: paramId } = useParams();
  const sync = useSyncStatus();
  const [qid] = useState(() => paramId ?? uid());
  const isNew = !paramId;
  const mobile = useMedia('(max-width: 767px)');
  const [doc, setDoc] = useState<QuoteDocument>({ ...EMPTY, validityDays: me!.settings.defaultValidityDays });
  const [meta, setMeta] = useState({ revNo: 1, version: 0, number: null as string | null, status: 'draft', create: isNew, fingerprint: '' });
  const [result, setResult] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);
  const [refAt, setRefAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [save, setSave] = useState<Save>('idle');
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [blockers, setBlockers] = useState<{ code?: string; message: string; path?: string }[]>([]);
  const [conflict, setConflict] = useState<any>(null);
  const [changed, setChanged] = useState<{ total: string; fingerprint: string } | null>(null);
  const [newClient, setNewClient] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [debouncing, setDebouncing] = useState(false);
  const metaRef = useRef(meta); metaRef.current = meta;
  const summaryRef = useRef<HTMLDivElement>(null);
  const [lastPlant] = usePref<string | null>('lastPlant', null);

  // ---------- load ----------
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const cachedRef = await getReference();
        if (cachedRef && !dead) { setRef(cachedRef.data); setRefAt(cachedRef.fetchedAt); }
        if (navigator.onLine) { const fresh = await refreshReference().catch(() => null); if (fresh && !dead) { setRef(fresh.data); setRefAt(fresh.fetchedAt); } }
        if (isNew) { const op = await getOp(qid); if (op && !dead) { setDoc(op.doc); setMeta((m) => ({ ...m, create: op.create, version: op.baseVersion, revNo: op.revNo })); } setState('ready'); return; }
        const op = await getOp(qid);
        let server: any = null;
        if (navigator.onLine) { try { server = await get(`/quotations/${qid}`); } catch (e) { if (!(e instanceof ApiError && e.status === 0)) throw e; } }
        const cached = await getDraft(qid);
        if (dead) return;
        if (server) {
          const r = server.revision;
          await cacheDraft({ id: qid, number: server.quotation.number, revNo: r.revNo, version: r.version, status: r.status, doc: r.doc, updatedAt: new Date().toISOString(), client: server.quotation.clientName, project: server.quotation.projectName });
          setMeta({ revNo: r.revNo, version: r.version, number: server.quotation.number, status: r.status, create: false, fingerprint: r.fingerprint ?? '' });
          setDoc(op && r.status === 'draft' ? op.doc : r.doc); setResult(r.result);
          if (op) setSave(op.status === 'conflict' ? 'conflict' : 'offline');
        } else if (cached) {
          setMeta({ revNo: cached.revNo, version: cached.version, number: cached.number, status: cached.status, create: false, fingerprint: '' });
          setDoc(op ? op.doc : cached.doc); setSave(op ? 'offline' : 'idle');
        } else { setState('missing'); return; }
        setState('ready');
      } catch (e) { if (!dead) { setLoadErr(e); setState('error'); } }
    })();
    return () => { dead = true; };
  }, [qid]);

  // ---------- reference helpers ----------
  const plants: any[] = ref?.plants ?? [];
  const plant = plants.find((p) => p.id === doc.plantId) ?? null;
  const readonly = meta.status !== 'draft';
  useEffect(() => { // default plant
    if (state !== 'ready' || doc.plantId || !plants.length || readonly) return;
    const p = plants.find((x) => x.id === lastPlant) ?? (plants.length === 1 ? plants[0] : null);
    if (p) update((d) => ({ ...d, plantId: p.id }));
  }, [state, plants.length]);

  const update = useCallback((fn: (d: QuoteDocument) => QuoteDocument) => { dirty.current = true; setDoc((d) => fn(d)); }, []);
  const set = (k: keyof QuoteDocument, v: any) => update((d) => ({ ...d, [k]: v }));

  // ---------- autosave (debounced; durable local write first, then server) ----------
  useEffect(() => {
    if (state !== 'ready' || readonly || !dirty.current) return;
    setDebouncing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setDebouncing(false); setSave(navigator.onLine ? 'saving' : 'offline');
      const m = metaRef.current;
      await queueSave({ id: qid, doc: persistable(doc), baseVersion: m.version, revNo: m.revNo, create: m.create });
      if (isNew) window.history.replaceState(null, '', `/quotations/${qid}/edit`); // reload (even offline) reopens this draft
    }, 800);
    return () => clearTimeout(timer.current);
  }, [doc, state]);
  useEffect(() => onSaved((id, res) => {
    if (id !== qid) return;
    if (res.error) {
      const e = res.error as ApiError;
      if (e.status === 409 && e.body?.serverDoc) { setSave('conflict'); setConflict({ serverDoc: e.body.serverDoc, serverVersion: e.body.serverVersion }); }
      else setSave('error');
      return;
    }
    setMeta((m) => ({ ...m, version: res.version, revNo: res.revNo, number: res.number ?? m.number, create: false, fingerprint: res.fingerprint ?? m.fingerprint }));
    setResult(res.result ?? null);
    if (res.createdNewRevision) setNotice(t('Editing a submitted revision created revision {n}; the earlier approval no longer applies.', { n: res.revNo }));
    setSave('saved');
    if (isNew) window.history.replaceState(null, '', `/quotations/${qid}/edit`);
    void cacheDraft({ id: qid, number: res.number ?? null, revNo: res.revNo, version: res.version, status: 'draft', doc: undefined as any, updatedAt: new Date().toISOString() }).catch(() => {});
  }), [qid]);
  useEffect(() => subscribe(async () => { const op = await getOp(qid); if (!op) return; if (op.status === 'pending') setSave(navigator.onLine ? 'saving' : 'offline'); if (op.status === 'error') setSave('error'); if (op.status === 'conflict') { setSave('conflict'); setConflict({ serverDoc: op.serverDoc, serverVersion: op.serverVersion }); } }), [qid]);
  useEffect(() => { if (!sync.online && save === 'saving') setSave('offline'); }, [sync.online]);
  // keep the cached draft body current whenever the doc changes (offline reload)
  useEffect(() => { if (state === 'ready' && dirty.current) void cacheDraft({ id: qid, number: meta.number, revNo: meta.revNo, version: meta.version, status: meta.status, doc: persistable(doc), updatedAt: new Date().toISOString() }); }, [doc]);

  // ---------- derived ----------
  const refPlant = plant;
  const rateOf = (mixRevId: string) => refPlant?.mixes.find((m: any) => m.mixRevisionId === mixRevId);
  const offline = !sync.online;
  const estimate = useMemo(() => {
    if (!refPlant?.rateCard || !ref?.taxPolicies) return null;
    try {
      const tax = ref.taxPolicies.find((x: any) => x.id === doc.taxPolicyId) ?? [...ref.taxPolicies].sort((a: any, b: any) => (a.status === 'verified' ? -1 : 1) - (b.status === 'verified' ? -1 : 1))[0] ?? null;
      const lines = doc.lines.map((l) => ({ id: l.id, mixRevisionId: l.mixRevisionId, quantityM3: l.quantityM3, ratePerM3: l.priceOverride?.perM3 || rateOf(l.mixRevisionId)?.ratePerM3 || '0' }));
      return previewCustomerTotals({ scope: doc.scope, lines, services: doc.services as any, rateCard: refPlant.rateCard, tax });
    } catch { return null; }
  }, [doc, refPlant, ref]);
  const useEstimate = offline || !result;
  const shown = useEstimate && estimate ? { customer: { totalVolumeM3: estimate.totalVolumeM3, concreteSubtotal: estimate.concreteSubtotal, deliveryTotal: estimate.deliveryTotal, pumpingTotal: estimate.pumpingTotal, otherTotal: estimate.otherTotal, subtotalExTax: estimate.subtotalExTax, tax: estimate.tax, taxAmount: estimate.tax?.tax ?? null, total: estimate.total }, approvals: [], issues: [], lines: [] } : result;
  const issues: any[] = result?.issues ?? [];
  const client = ref?.clients?.find((c: any) => c.id === doc.clientId);
  const projects = (ref?.projects ?? []).filter((p: any) => p.clientId === doc.clientId);
  const project = projects.find((p: any) => p.id === doc.projectId);
  const tax = ref?.taxPolicies?.find((x: any) => x.id === (doc.taxPolicyId ?? result?.customer?.tax?.policyId));
  const checklist = [
    { ok: !!doc.clientId && !!doc.projectId, label: t('Client and project selected') }, { ok: !!doc.plantId, label: t('Supplying plant selected') },
    { ok: doc.lines.length > 0 && doc.lines.every((l) => Number(l.quantityM3) > 0), label: t('Every line has a mix and quantity') },
    { ok: !!result && !issues.some((i) => i.severity === 'error' && i.code !== 'tax_unverified'), label: t('All prices and costs are available') },
    { ok: !!doc.paymentTerms.trim(), label: t('Payment terms entered') }, { ok: !!doc.termsVersionId, label: t('Terms version selected') },
    { ok: (result?.customer?.tax?.policyStatus ?? tax?.status) === 'verified', label: t('Tax policy verified (required before issue)'), soft: true },
  ];

  // ---------- actions ----------
  const goto = (s: number) => { setStep(s); document.getElementById(`sec-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const focusPath = (path?: string, code?: string) => {
    const cf = code && CODE_FIELD[code];
    if (cf) { setStep(cf[1]); setTimeout(() => document.getElementById(cf[0])?.focus(), 60); return; }
    if (!path) return;
    setStep(path.startsWith('services') || path.startsWith('lines') || path.startsWith('materials') ? 1 : 3);
    setTimeout(() => { const el = document.getElementById(fieldId(path)); (el?.querySelector<HTMLElement>('input,select') ?? el)?.focus(); el?.scrollIntoView({ block: 'center' }); }, 60);
  };
  const allProblems = () => {
    const out: { code?: string; message: string; path?: string }[] = [];
    if (!doc.clientId) out.push({ code: 'client_missing', message: 'Select a client.' });
    if (!doc.projectId) out.push({ code: 'project_missing', message: 'Select a project.' });
    if (!doc.plantId) out.push({ code: 'plant_missing', message: 'Select the supplying plant.' });
    if (!doc.paymentTerms.trim()) out.push({ code: 'payment_terms_missing', message: 'Enter the payment terms.' });
    if (!doc.termsVersionId) out.push({ code: 'terms_missing', message: 'Select an approved terms version.' });
    if (!doc.lines.length) out.push({ code: 'lines_empty', message: 'Add at least one concrete line.', path: 'lines' });
    for (const l of doc.lines) if (!(Number(l.quantityM3) > 0)) out.push({ code: 'quantity_invalid', message: `${rateOf(l.mixRevisionId)?.code ?? ''}: Enter a valid quantity in m³.`, path: `lines[${l.id}].quantity` });
    for (const i of issues) if (i.severity === 'error' && i.code !== 'tax_unverified' && !out.some((o) => o.path === i.path && o.code === i.code)) out.push(i);
    return out;
  };
  const submit = async (acknowledge = false) => {
    setAttempted(true);
    const problems = allProblems();
    if (problems.length) { setBlockers(problems); setStep(3); setTimeout(() => { summaryRef.current?.focus(); summaryRef.current?.scrollIntoView({ block: 'center' }); }, 60); return; }
    setBlockers([]); setSave('saving');
    clearTimeout(timer.current); setDebouncing(false);
    await queueSave({ id: qid, doc: persistable(doc), baseVersion: metaRef.current.version, revNo: metaRef.current.revNo, create: metaRef.current.create });
    await flush();
    const op = await getOp(qid);
    if (op) { setNotice(op.status === 'conflict' ? t('Resolve the sync conflict before submitting.') : t('The draft could not be saved yet, so it was not submitted. It stays on this device.')); return; }
    try {
      const m = metaRef.current;
      await post(`/quotations/${qid}/revisions/${m.revNo}/submit`, { expectedFingerprint: m.fingerprint || undefined, acknowledgeChanges: acknowledge });
      nav(`/quotations/${qid}`);
    } catch (e) {
      const x = e as ApiError;
      if (x.status === 409 && x.body?.code === 'reference_changed') setChanged({ total: x.body.total, fingerprint: x.body.fingerprint });
      else if (x.status === 422 && x.body?.blockers) { setBlockers(x.body.blockers); setStep(3); setTimeout(() => summaryRef.current?.focus(), 60); }
      else if (x.status === 0) setNotice(t('You are offline. Quotations can only be submitted while connected; your draft is saved on this device.'));
      else setNotice(x.message);
    }
  };

  // ---------- render ----------
  if (state === 'loading') return <div className="page"><Loading /></div>;
  if (state === 'error') return <div className="page"><ErrorState error={loadErr} retry={() => location.reload()} /></div>;
  if (state === 'missing') return <div className="page"><EmptyState title={t('This draft is not available offline')} action={<Link className="btn" to="/quotations">{t('Back to quotations')}</Link>}>{t('Open it once while connected to make it available offline.')}</EmptyState></div>;
  if (!can('quote.create')) return <div className="page"><ErrorState error={new ApiError(403, 'forbidden', '')} /></div>;

  const saveBadge = debouncing || save === 'saving' ? <span className="savestate busy" role="status"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />{t('Saving…')}</span>
    : save === 'saved' || (save === 'idle' && meta.version > 0) ? <span className="savestate ok" role="status"><Icon n="check" size={16} />{t('Saved')}</span>
    : save === 'offline' ? <span className="savestate warn" role="status"><Icon n="cloud" size={16} />{t('Offline draft — saved on this device')}</span>
    : save === 'conflict' ? <span className="savestate err" role="alert">{t('Sync conflict')}</span>
    : save === 'error' ? <span className="savestate err" role="alert"><Icon n="alert" size={16} />{t('Save failed — your entries are kept on this device')}{' '}<button className="btn-sm" onClick={async () => { setSave('saving'); const { retryOp } = await import('../offline/store'); await retryOp(qid); }}>{t('Retry')}</button></span>
    : <span className="savestate busy">{t('Not saved yet')}</span>;

  const sectionVisible = (i: number) => !mobile || step === i;
  const rateCard = refPlant?.rateCard;
  const scopeServices = (scope: QuoteDocument['scope'], services: QuoteDocument['services']) => {
    let s = services.filter((x) => x.type === 'other');
    const del = services.find((x) => x.type === 'delivery'), pump = services.find((x) => x.type === 'pumping');
    if (scope !== 'supply_only') s = [del ?? { id: uid().slice(0, 8), type: 'delivery', method: 'per_m3' } as any, ...s];
    if (scope === 'supply_delivery_pumping') s = [s[0]!, pump ?? { id: uid().slice(0, 8), type: 'pumping', units: 1 } as any, ...s.slice(1)];
    return s as QuoteDocument['services'];
  };
  const lineErr = (id: string) => (attempted || true ? issues.filter((i) => i.severity === 'error' && i.path?.startsWith(`lines[${id}]`)) : []);
  const mixOpts = (refPlant?.mixes ?? []).map((m: any) => ({
    id: m.mixRevisionId, label: `${m.code} — ${mixName(m, lang)}`, search: `${m.code} ${m.nameEn} ${m.nameAr} ${m.grade} ${refPlant.nameEn} ${refPlant.code}`,
    sub: <>{m.grade}{m.spec?.strengthMpa ? ` · ${m.spec.strengthMpa} MPa` : ''}{m.spec?.slumpMm ? ` · ${t('slump')} ${m.spec.slumpMm} mm` : ''}{m.spec?.maxAggregateMm ? ` · ${m.spec.maxAggregateMm} mm ${t('agg.')}` : ''} · {t('rev')} {m.revNo} · {m.ratePerM3 ? `${money(m.ratePerM3)} JOD/m³` : t('price unavailable')}</>,
  }));

  return (
    <div className="page">
      <PageHead title={meta.number ? <>{t('Quotation')} <span className="ltr">{meta.number}</span></> : t('New quotation')} sub={<span className="hstack"><StatusBadge status={meta.status} /><span>{t('Revision')} {meta.revNo}</span>{saveBadge}{doc.pinnedReference && <span className="chip">{t('Prices pinned to the earlier revision')}</span>}</span>}>
        <Link className="btn" to={isNew ? '/quotations' : `/quotations/${qid}`}>{t('Close')}</Link>
        <button onClick={async () => { clearTimeout(timer.current); setDebouncing(false); setSave('saving'); await queueSave({ id: qid, doc: persistable(doc), baseVersion: metaRef.current.version, revNo: metaRef.current.revNo, create: metaRef.current.create }); }} disabled={readonly}>{t('Save draft')}</button>
      </PageHead>

      {readonly && (
        <Alert tone="warn" title={t('This revision is {s} and cannot be edited.', { s: t(meta.status.replace('_', ' ')) })}>
          <div>{t('Editing creates a new draft revision; any pending approval for this revision no longer applies.')}</div>
          <button className="btn-sm" style={{ marginTop: 8 }} onClick={async () => { const r = await post(`/quotations/${qid}/revise`); location.assign(`/quotations/${qid}/edit?rev=${r.revNo}`); }}>{t('Create revision')}</button>
        </Alert>
      )}
      {notice && <div style={{ margin: '12px 0' }}><Alert tone="info">{notice} <button className="btn-sm btn-ghost" onClick={() => setNotice('')}>{t('Dismiss')}</button></Alert></div>}
      {save === 'conflict' && <div style={{ margin: '12px 0' }}><Alert tone="err" title={t('This draft changed on another device')}><div>{t('Choose which version to keep. Nothing is overwritten until you decide.')}</div><button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setConflict(conflict ?? {})}>{t('Review conflict')}</button></Alert></div>}

      <nav className="sectionnav" aria-label={t('Quotation sections')}>
        {STEPS.map((s, i) => <a key={s} href={`#sec-${i}`} aria-current={step === i} onClick={(e) => { e.preventDefault(); goto(i); }}><span className="n">{i + 1}</span>{t(s)}</a>)}
      </nav>

      <div className="builder">
        <div className="stack" style={{ minWidth: 0 }}>
          {/* 1 Client & project */}
          <section id="sec-0" className="card section" hidden={!sectionVisible(0)} aria-labelledby="h0">
            <h2 id="h0">1. {t('Client & project')}</h2>
            <div className="grid2">
              <Combobox label={t('Client')} inputId="f-client" disabled={readonly} options={(ref?.clients ?? []).map((c: any) => ({ id: c.id, label: c.name, search: c.name, sub: c.taxNumber ? `${t('Tax no.')} ${c.taxNumber}` : undefined }))} value={doc.clientId}
                onChange={(id) => update((d) => { const ps = (ref?.projects ?? []).filter((p: any) => p.clientId === id); const only = ps.length === 1 ? ps[0] : null; return { ...d, clientId: id, projectId: only?.id ?? null, plantId: d.plantId ?? only?.defaultPlantId ?? null }; })}
                error={attempted && !doc.clientId ? t('Select a client.') : null}
                footer={can('client.manage') ? <button className="btn-sm" disabled={offline} onMouseDown={(e) => { e.preventDefault(); setNewClient(true); }}><Icon n="plus" size={16} />{t('Add new client')}{offline ? ` (${t('needs connection')})` : ''}</button> : undefined} />
              <Combobox label={t('Project')} inputId="f-project" disabled={readonly || !doc.clientId} options={projects.map((p: any) => ({ id: p.id, label: p.name, search: `${p.name} ${p.siteAddress}`, sub: p.siteAddress }))} value={doc.projectId}
                onChange={(id) => update((d) => ({ ...d, projectId: id, plantId: d.plantId ?? projects.find((p: any) => p.id === id)?.defaultPlantId ?? null }))} error={attempted && !doc.projectId ? t('Select a project.') : null}
                emptyText={t('No projects for this client')} hint={!doc.clientId ? t('Select a client first.') : undefined} />
            </div>
            {(client || project) && <div className="small muted" style={{ margin: '12px 0' }}>{project?.siteAddress && <div>{t('Site')}: {project.siteAddress}</div>}{client?.contacts?.[0] && <div>{t('Contact')}: {client.contacts[0].name} <span className="ltr">{client.contacts[0].phone}</span> <span className="ltr">{client.contacts[0].email}</span></div>}</div>}
            <div className="grid2" style={{ marginTop: 12 }}>
              <SelectField label={t('Supplying plant')} id="f-plant" disabled={readonly} value={doc.plantId ?? ''} error={attempted && !doc.plantId ? t('Select the supplying plant.') : null}
                onChange={(e) => update((d) => ({ ...d, plantId: e.target.value || null, lines: [] }))} hint={doc.lines.length ? t('Changing the plant clears the concrete lines (prices differ by plant).') : undefined}>
                <option value="">{t('Select plant…')}</option>{plants.map((p) => <option key={p.id} value={p.id}>{lang === 'ar' && p.nameAr ? p.nameAr : p.nameEn} ({p.code})</option>)}
              </SelectField>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={readonly}><legend style={{ fontWeight: 550, fontSize: 14, marginBottom: 4 }}>{t('Supply scope')}</legend>
                <div className="stack-sm">{([['supply_only', 'Supply only'], ['supply_delivery', 'Delivered to site'], ['supply_delivery_pumping', 'Delivered with pumping']] as const).map(([v, l]) => (
                  <label key={v} className="hstack" style={{ minHeight: 36 }}><input type="radio" name="scope" checked={doc.scope === v} onChange={() => update((d) => ({ ...d, scope: v, services: scopeServices(v, d.services) }))} />{t(l)}</label>))}</div></fieldset>
            </div>
          </section>

          {/* 2 Concrete & services */}
          <section id="sec-1" className="card section" hidden={!sectionVisible(1)} aria-labelledby="h1">
            <div className="card-head"><h2 id="h1">2. {t('Concrete & services')}</h2><span className="grow" /><button onClick={() => update((d) => ({ ...d, lines: [...d.lines, { id: uid().slice(0, 8), mixRevisionId: '', quantityM3: '', priceOverride: null, costOverride: null }] }))} disabled={readonly || !doc.plantId}><Icon n="plus" size={16} />{t('Add mix line')}</button></div>
            {!doc.plantId && <Alert tone="info">{t('Select the supplying plant first; mixes and rates depend on the plant.')}</Alert>}
            {doc.plantId && doc.lines.length === 0 && <EmptyState title={t('No concrete lines yet')} action={<button className="btn-primary" onClick={() => update((d) => ({ ...d, lines: [{ id: uid().slice(0, 8), mixRevisionId: '', quantityM3: '', priceOverride: null, costOverride: null }] }))}>{t('Add first mix line')}</button>}>{t('Add an approved mix and enter the quantity in m³.')}</EmptyState>}
            <div className="lines">
              {doc.lines.map((l, i) => {
                const rl = result?.lines?.find((x: any) => x.id === l.id);
                const rate = l.priceOverride?.perM3 || rl?.customerRatePerM3 || rateOf(l.mixRevisionId)?.ratePerM3;
                const amt = rl?.amount ?? (rate && Number(l.quantityM3) > 0 ? String(Number(rate) * Number(l.quantityM3)) : null);
                const qErr = issues.find((x) => x.path === `lines[${l.id}].quantity`);
                const errs = lineErr(l.id).filter((x) => x !== qErr);
                return (
                  <div key={l.id} className="line" id={`line-${l.id}`}>
                    <div className="linehead"><strong>{t('Line')} {i + 1}</strong><span className="grow" />
                      <button className="btn-sm" disabled={readonly} onClick={() => update((d) => ({ ...d, lines: [...d.lines.slice(0, i + 1), { ...l, id: uid().slice(0, 8) }, ...d.lines.slice(i + 1)] }))} aria-label={t('Duplicate line {n}', { n: i + 1 })}><Icon n="copy" size={16} />{t('Duplicate')}</button>
                      <button className="btn-sm btn-danger" disabled={readonly} onClick={() => update((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))} aria-label={t('Remove line {n}', { n: i + 1 })}><Icon n="x" size={16} />{t('Remove')}</button></div>
                    <div className="mixcell"><Combobox label={t('Mix')} inputId={`line-${l.id}-mix`} disabled={readonly} options={mixOpts} value={l.mixRevisionId || null} onChange={(id) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, mixRevisionId: id } : x)) }))} placeholder={t('Search by code, name, grade or plant')} /></div>
                    <NumField label={t('Quantity')} unit="m³" id={`line-${l.id}-qty`} value={l.quantityM3} disabled={readonly} onChange={(v) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, quantityM3: v } : x)) }))}
                      error={qErr && (attempted || l.quantityM3 !== '') ? issueText(qErr, t) : attempted && !(Number(l.quantityM3) > 0) ? t('Enter a valid quantity in m³.') : null} />
                    <div className="field"><span style={{ fontWeight: 550, fontSize: 14 }}>{t('Customer rate')}</span><div className="inputgroup"><input readOnly aria-label={t('Customer rate')} value={rate ? money(rate) : '—'} dir="ltr" /><span className="unit">JOD/m³</span></div>{l.priceOverride && <span className="hint">{t('Overridden — approval required')}</span>}</div>
                    <div className="field"><span style={{ fontWeight: 550, fontSize: 14 }}>{t('Amount')}</span><div className="amount">{amt ? `${money(amt)} JOD` : '—'}</div></div>
                    {errs.length > 0 && <div style={{ gridColumn: '1/-1' }}><Alert tone="err"><IssuesList issues={errs} /></Alert></div>}
                    {(can('quote.override_price') || can('quote.override_cost')) && (
                      <details className="adv" style={{ gridColumn: '1/-1' }}><summary>{t('Advanced overrides')}{(l.priceOverride || l.costOverride) ? ` (${t('active')})` : ''}</summary>
                        <p className="small muted">{t('Overrides need a reason and trigger approval.')}</p>
                        {can('quote.override_price') && <div className="row">
                          <NumField label={t('Override customer rate')} unit="JOD/m³" value={l.priceOverride?.perM3 ?? ''} disabled={readonly} onChange={(v) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, priceOverride: v ? { perM3: v, reason: x.priceOverride?.reason ?? '' } : null } : x)) }))} />
                          <TextField label={t('Reason for price override')} value={l.priceOverride?.reason ?? ''} disabled={readonly || !l.priceOverride} onChange={(e) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id && x.priceOverride ? { ...x, priceOverride: { ...x.priceOverride, reason: e.target.value } } : x)) }))} error={l.priceOverride && !l.priceOverride.reason.trim() && attempted ? t('Enter a reason for the override.') : null} /></div>}
                        {can('quote.override_cost') && <div className="row" style={{ marginTop: 8 }}>
                          <NumField label={t('Override full cost')} unit="JOD/m³" value={l.costOverride?.perM3 ?? ''} disabled={readonly} onChange={(v) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? { ...x, costOverride: v ? { perM3: v, reason: x.costOverride?.reason ?? '' } : null } : x)) }))} />
                          <TextField label={t('Reason for cost override')} value={l.costOverride?.reason ?? ''} disabled={readonly || !l.costOverride} onChange={(e) => update((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id && x.costOverride ? { ...x, costOverride: { ...x.costOverride, reason: e.target.value } } : x)) }))} /></div>}
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            {doc.scope !== 'supply_only' && (
              <div style={{ marginTop: 24 }}><h3>{t('Delivery & pumping charges')}</h3>
                {!rateCard && <Alert tone="warn">{t('No delivery/pumping rates are configured for this plant yet.')}</Alert>}
                <div className="stack">
                  {doc.services.map((s: any, i) => (
                    <div key={s.id} id={`service-${s.id}`} className="line" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                      <div className="linehead"><strong>{s.type === 'delivery' ? t('Delivery') : s.type === 'pumping' ? t('Pumping') : s.label}</strong><span className="grow" />
                        {s.type === 'other' && <button className="btn-sm btn-danger" disabled={readonly} onClick={() => set('services', doc.services.filter((x) => x.id !== s.id))}>{t('Remove')}</button>}</div>
                      {s.type === 'delivery' && <>
                        <SelectField label={t('Delivery method')} value={s.method} disabled={readonly} onChange={(e) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, method: e.target.value as any } : x)))}>
                          <option value="per_m3">{t('Per m³ rate')}</option>{(rateCard?.delivery?.zones?.length ?? 0) > 0 && <option value="zone">{t('By zone')}</option>}{rateCard?.delivery?.trip && <option value="trip">{t('By trips')}</option>}</SelectField>
                        {s.method === 'zone' && <SelectField label={t('Delivery zone')} value={s.zoneCode ?? ''} disabled={readonly} onChange={(e) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, zoneCode: e.target.value } : x)))}><option value="">{t('Select zone…')}</option>{rateCard.delivery.zones.map((z: any) => <option key={z.code} value={z.code}>{z.name} — {money(z.chargePerM3)} JOD/m³</option>)}</SelectField>}
                        {s.method === 'trip' && <NumField label={t('Round-trip distance')} unit="km" value={s.roundTripKm ?? ''} disabled={readonly} onChange={(v) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, roundTripKm: v } : x)))} hint={t('Truck capacity {c} m³; {p} JOD per trip', { c: rateCard.delivery.trip.truckCapacityM3, p: rateCard.delivery.trip.chargePerTrip })} />}
                        {s.method === 'per_m3' && rateCard?.delivery?.perM3 && <div className="field"><span style={{ fontWeight: 550, fontSize: 14 }}>{t('Rate')}</span><div className="amount" style={{ textAlign: 'start' }}>{money(rateCard.delivery.perM3.chargePerM3)} JOD/m³</div></div>}
                      </>}
                      {s.type === 'pumping' && rateCard?.pumping && <>
                        <NumField label={t('Number of {u}', { u: t(rateCard.pumping.minBasis.replace('per_', '') + 's') })} unit="#" value={String(s.units ?? 1)} disabled={readonly || rateCard.pumping.minBasis === 'per_quotation'} onChange={(v) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, units: v ? Math.max(1, Math.floor(Number(v))) : 1 } : x)))} hint={t('Minimum {m} JOD applies {b}; rate {r} JOD/m³', { m: rateCard.pumping.minCharge, b: t(rateCard.pumping.minBasis.replace('_', ' ')), r: rateCard.pumping.chargePerM3 })} />
                        <NumField label={t('Additional hours')} unit="h" value={s.extraHours ?? ''} disabled={readonly} onChange={(v) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, extraHours: v } : x)))} hint={`${money(rateCard.pumping.extraHourRate)} JOD/h`} />
                        {Number(rateCard.pumping.mobilizationFee) > 0 && <div className="field"><span style={{ fontWeight: 550, fontSize: 14 }}>{t('Mobilization / setup')}</span><div className="amount" style={{ textAlign: 'start' }}>{money(rateCard.pumping.mobilizationFee)} JOD {t(rateCard.pumping.minBasis.replace('_', ' '))}</div></div>}
                      </>}
                      {s.type === 'other' && <><TextField label={t('Description')} value={s.label} disabled={readonly} onChange={(e) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))} /><NumField label={t('Quantity')} unit={s.unit} value={s.quantity} disabled={readonly} onChange={(v) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, quantity: v } : x)))} /><NumField label={t('Rate')} unit={`JOD/${s.unit}`} value={s.rate} disabled={readonly} onChange={(v) => set('services', doc.services.map((x) => (x.id === s.id ? { ...x, rate: v } : x)))} /></>}
                      {(() => { const r = result?.services?.find((x: any) => x.id === s.id); return r ? <div style={{ gridColumn: '1/-1' }} className="small"><table className="t" aria-label={t('Charge breakdown')}><tbody>{r.rows.map((row: any) => <tr key={row.key}><td>{row.label}</td><td className="n">{qty(row.quantity)} {row.unit}</td><td className="n">{money(row.rate)}</td><td className="n"><strong>{money(row.amount)} JOD</strong></td></tr>)}</tbody></table></div> : null; })()}
                    </div>
                  ))}
                </div>
                <button style={{ marginTop: 12 }} disabled={readonly} onClick={() => set('services', [...doc.services, { id: uid().slice(0, 8), type: 'other', label: '', quantity: '1', unit: 'lot', rate: '' }])}><Icon n="plus" size={16} />{t('Add other service')}</button>
              </div>
            )}
          </section>

          {/* 3 Commercial terms */}
          <section id="sec-2" className="card section" hidden={!sectionVisible(2)} aria-labelledby="h2">
            <h2 id="h2">3. {t('Commercial terms')}</h2>
            <div className="grid2">
              <NumField label={t('Validity')} unit={t('days')} value={String(doc.validityDays)} disabled={readonly} onChange={(v) => set('validityDays', Math.min(365, Math.max(1, Math.floor(Number(v) || 1))))} />
              <SelectField label={t('Terms template')} id="f-terms" value={doc.termsVersionId ?? ''} disabled={readonly} error={attempted && !doc.termsVersionId ? t('Select an approved terms version.') : null} onChange={(e) => set('termsVersionId', e.target.value || null)}>
                <option value="">{t('Select terms…')}</option>{(ref?.terms ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name} (v{x.version}) — {t(x.status === 'approved' ? 'Approved' : 'Not yet approved')}</option>)}</SelectField>
              <SelectField label={t('Tax policy')} value={doc.taxPolicyId ?? ''} disabled={readonly} onChange={(e) => set('taxPolicyId', e.target.value || null)} hint={tax ? `${tax.name}${tax.status !== 'verified' ? ' — ' + t('requires verification before issue') : ''}` : undefined}>
                <option value="">{t('Default for the quotation date')}</option>{(ref?.taxPolicies ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.status})</option>)}</SelectField>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <AreaField label={t('Payment terms')} id="f-payment" value={doc.paymentTerms} disabled={readonly} onChange={(e) => set('paymentTerms', e.target.value)} error={attempted && !doc.paymentTerms.trim() ? t('Enter the payment terms.') : null} hint={t('Printed on the customer quotation. Enter the wording approved by your company.')} />
              <AreaField label={t('Expected supply schedule (optional)')} value={doc.supplySchedule} disabled={readonly} onChange={(e) => set('supplySchedule', e.target.value)} />
              <AreaField label={t('Customer notes')} value={doc.customerNotes} disabled={readonly} onChange={(e) => set('customerNotes', e.target.value)} hint={t('Visible to the customer on the quotation.')} />
              <AreaField label={t('Internal notes')} value={doc.internalNotes} disabled={readonly} onChange={(e) => set('internalNotes', e.target.value)} hint={t('Internal only — never printed or shared with the customer.')} />
            </div>
          </section>

          {/* 4 Review & issue */}
          <section id="sec-3" className="card section" hidden={!sectionVisible(3)} aria-labelledby="h3">
            <h2 id="h3">4. {t('Review & issue')}</h2>
            {blockers.length > 0 && (
              <div className="errsummary" ref={summaryRef} tabIndex={-1}><Alert tone="err" title={t('{n} thing(s) need your attention before submitting', { n: blockers.length })}>
                <ul>{blockers.map((b, i) => <li key={i}><a href={`#${CODE_FIELD[b.code ?? '']?.[0] ?? fieldId(b.path ?? '')}`} onClick={(e) => { e.preventDefault(); focusPath(b.path, b.code); }}>{issueText(b as any, t)}</a></li>)}</ul></Alert></div>
            )}
            <h3>{t('Commercial checklist')}</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>{checklist.map((c) => <li key={c.label} className="hstack" style={{ minHeight: 32 }}><span className={`badge ${c.ok ? 'ok' : c.soft ? 'warn' : 'err'}`}>{c.ok ? t('Done') : c.soft ? t('Before issue') : t('Missing')}</span>{c.label}</li>)}</ul>
            {(result?.approvals?.length ?? 0) > 0 && <Alert tone="warn" title={t('This quotation will need approval')}><ul>{[...new Map(result.approvals.map((a: any) => [a.message, a])).values()].map((a: any) => <li key={a.message}>{a.message}{a.detail?.reason ? ` — “${a.detail.reason}”` : ''}</li>)}</ul></Alert>}
            {(result?.approvals?.length ?? 0) === 0 && result && <p className="muted small">{t('No approval reasons detected: the revision will be approved automatically when submitted.')}</p>}
            {issues.filter((i) => i.severity === 'warning').length > 0 && <div style={{ margin: '12px 0' }}><Alert tone="warn" title={t('Warnings')}><IssuesList issues={issues.filter((i) => i.severity === 'warning')} /></Alert></div>}
            {refAt && <p className="small muted">{t('Reference prices as of {d}.', { d: refAt.slice(0, 16).replace('T', ' ') })} {offline && t('You are offline — stale data possible; the server revalidates on submit.')}</p>}
            <h3 style={{ marginTop: 16 }}>{t('Customer preview')}</h3>
            <CustomerPreview doc={doc} result={shown} client={client} project={project} plant={refPlant} refPlant={refPlant} lang={lang} terms={ref?.terms?.find((x: any) => x.id === doc.termsVersionId)} />
            <div className="hstack" style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={() => submit()} disabled={readonly || offline} aria-describedby="submit-why">{t('Submit for approval')}</button>
              <button onClick={() => queueSave({ id: qid, doc: persistable(doc), baseVersion: metaRef.current.version, revNo: metaRef.current.revNo, create: metaRef.current.create })} disabled={readonly}>{t('Save draft')}</button>
              <span id="submit-why" className="small muted">{offline ? t('Submitting needs a connection: approval and issuing never happen offline.') : t('Issuing is available after approval, on the quotation page.')}</span>
            </div>
          </section>

          {mobile && (
            <div className="hstack" style={{ justifyContent: 'space-between' }}>
              <button onClick={() => goto(Math.max(0, step - 1))} disabled={step === 0}>{t('Back')}</button>
              {step < 3 ? <button className="btn-primary" onClick={() => goto(step + 1)}>{t('Next: {s}', { s: t(STEPS[step + 1]!) })}</button> : <span />}
            </div>
          )}
        </div>

        <aside className="summary desktop" aria-label={t('Offer summary')}><TotalsPanel result={shown} estimate={useEstimate && !!estimate} taxLabel={tax} />{!offline && result && <FreshnessNote result={result} />}</aside>
      </div>

      {/* mobile bottom summary */}
      <div className={`mobile-summary ${summaryOpen ? 'expanded' : ''}`}>
        <button className="btn-ghost" style={{ width: '100%', justifyContent: 'space-between' }} aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>
          <span>{t('Customer total')}</span><strong className="num">{shown?.customer?.total ? `${money(shown.customer.total)} JOD` : money(shown?.customer?.subtotalExTax) + ' JOD (' + t('pre-tax') + ')'}</strong><span className="small muted">{summaryOpen ? t('Hide') : t('Details')}</span>
        </button>
        {summaryOpen && <TotalsPanel result={shown} estimate={useEstimate && !!estimate} taxLabel={tax} />}
      </div>

      {newClient && <NewClientDialog onClose={() => setNewClient(false)} onCreated={async (c) => { setNewClient(false); const fresh = await refreshReference(); if (fresh) setRef(fresh.data); update((d) => ({ ...d, clientId: c.id, projectId: null })); }} />}
      {conflict && (
        <Dialog title={t('Resolve sync conflict')} onClose={() => setConflict(null)} footer={<>
          <button onClick={async () => { await resolveConflict(qid, 'server'); const s = await get(`/quotations/${qid}`); setDoc(s.revision.doc); setMeta((m) => ({ ...m, version: s.revision.version, revNo: s.revision.revNo })); setResult(s.revision.result); dirty.current = false; setSave('saved'); setConflict(null); }}>{t('Use the server version')}</button>
          <button className="btn-primary" onClick={async () => { await resolveConflict(qid, 'mine'); setConflict(null); setSave('saving'); }}>{t('Keep my changes')}</button></>}>
          <p>{t('This quotation was changed on another device or session while you were editing.')}</p>
          <table className="t"><thead><tr><th>{t('Field')}</th><th>{t('Your version')}</th><th>{t('Server version')}</th></tr></thead><tbody>
            {diffDoc(doc, conflict?.serverDoc).map((d) => <tr key={d.k}><td>{t(d.k)}</td><td>{d.a}</td><td>{d.b}</td></tr>)}</tbody></table>
        </Dialog>
      )}
      {changed && (
        <Dialog title={t('Prices or policies changed')} onClose={() => setChanged(null)} footer={<><button onClick={() => setChanged(null)}>{t('Review first')}</button><button className="btn-primary" onClick={() => { setChanged(null); void submit(true); }}>{t('Submit at the updated total')}</button></>}>
          <p>{t('Reference prices, costs or policies changed since you last viewed this quotation. The updated customer total is {v} JOD.', { v: money(changed.total) })}</p>
        </Dialog>
      )}
    </div>
  );
}

function diffDoc(a: any, b: any) {
  if (!b) return [];
  const keys: [string, string][] = [['paymentTerms', 'Payment terms'], ['customerNotes', 'Customer notes'], ['internalNotes', 'Internal notes'], ['validityDays', 'Validity'], ['supplySchedule', 'Expected supply schedule (optional)'], ['scope', 'Supply scope']];
  const rows = keys.filter(([k]) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(([k, l]) => ({ k: l, a: String(a[k] ?? ''), b: String(b[k] ?? '') }));
  if (a.lines?.length !== b.lines?.length || JSON.stringify(a.lines) !== JSON.stringify(b.lines)) rows.push({ k: 'Concrete & services', a: `${a.lines?.length ?? 0} line(s)`, b: `${b.lines?.length ?? 0} line(s)` });
  if (JSON.stringify(a.services) !== JSON.stringify(b.services)) rows.push({ k: 'Delivery & pumping charges', a: `${a.services?.length ?? 0}`, b: `${b.services?.length ?? 0}` });
  if (!rows.length) rows.push({ k: 'Other fields', a: '—', b: '—' });
  return rows;
}

function FreshnessNote({ result }: { result: any }) {
  const t = useT();
  const stale = (result.issues ?? []).filter((i: any) => i.code === 'price_stale');
  if (!stale.length) return null;
  return <Alert tone="warn" title={t('Stale reference data')}>{t('Some material prices are older than the freshness threshold. Ask pricing to confirm before issuing.')}</Alert>;
}

function NewClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: any) => void }) {
  const t = useT();
  const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [phone, setPhone] = useState(''); const [err, setErr] = useState('');
  const [pName, setPName] = useState(''); const [site, setSite] = useState('');
  const submit = async () => {
    try { const c = await post('/clients', { name, contacts: contact ? [{ name: contact, phone, email: '' }] : [] }); if (pName) await post('/projects', { clientId: c.id, name: pName, siteAddress: site }); onCreated(c); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title={t('Add new client')} onClose={onClose} footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={submit} disabled={!name.trim()}>{t('Save client')}</button></>}>
      <div className="stack">{err && <Alert tone="err">{err}</Alert>}
        <TextField label={t('Client name')} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <div className="row"><TextField label={t('Contact person')} value={contact} onChange={(e) => setContact(e.target.value)} /><TextField label={t('Phone')} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <TextField label={t('First project (optional)')} value={pName} onChange={(e) => setPName(e.target.value)} /><TextField label={t('Site address')} value={site} onChange={(e) => setSite(e.target.value)} /></div>
    </Dialog>
  );
}

/** Customer-facing preview: never shows costs, recipes, margins or internal notes. */
export function CustomerPreview({ doc, result, client, project, plant, lang, terms }: any) {
  const t = useT();
  const c = result?.customer;
  if (!c) return <p className="muted">{t('Preview appears once the quotation can be priced.')}</p>;
  const lines = result.lines?.length ? result.lines : doc.lines.map((l: any) => ({ id: l.id, mixRevisionId: l.mixRevisionId, quantityM3: l.quantityM3 }));
  return (
    <div className="preview" aria-label={t('Customer preview')}>
      <div className="hstack" style={{ justifyContent: 'space-between' }}><strong>{plant ? (lang === 'ar' && plant.nameAr ? plant.nameAr : plant.nameEn) : ''}</strong><span className="muted">{client?.name} — {project?.name}</span></div>
      <table style={{ marginTop: 8 }}><thead><tr><th>{t('Mix')}</th><th className="n">{t('Quantity')}</th><th className="n">{t('Rate')} (JOD/m³)</th><th className="n">{t('Amount')} (JOD)</th></tr></thead>
        <tbody>
          {lines.map((l: any) => { const m = plant?.mixes?.find((x: any) => x.mixRevisionId === l.mixRevisionId); const rate = l.customerRatePerM3 ?? l.ratePerM3 ?? m?.ratePerM3; return <tr key={l.id}><td><strong className="ltr">{m?.code ?? l.mixCode}</strong> {m ? mixName(m, lang) : ''}</td><td className="n">{qty(l.quantityM3)} m³</td><td className="n">{money(rate)}</td><td className="n">{l.amount ? money(l.amount) : '—'}</td></tr>; })}
          {(result.services ?? []).flatMap((s: any) => s.rows ? s.rows.map((r: any) => <tr key={s.id + r.key}><td>{r.label}</td><td className="n">{qty(r.quantity)} {r.unit}</td><td className="n">{money(r.rate)}</td><td className="n">{money(r.amount)}</td></tr>) : [])}
        </tbody>
        <tfoot><tr><td colSpan={3}>{t('Subtotal before tax')}</td><td className="n">{money(c.subtotalExTax)}</td></tr><tr><td colSpan={3}>{t('Tax')}{c.tax ? ` (${c.tax.ratePct}%)` : ''}</td><td className="n">{c.taxAmount != null ? money(c.taxAmount) : '—'}</td></tr><tr><td colSpan={3}><strong>{t('Total')}</strong></td><td className="n"><strong>{c.total != null ? money(c.total) : '—'}</strong></td></tr></tfoot></table>
      {doc.paymentTerms && <p><strong>{t('Payment terms')}:</strong> {doc.paymentTerms}</p>}
      {doc.customerNotes && <p><strong>{t('Notes')}:</strong> {doc.customerNotes}</p>}
      {terms && <p className="small muted">{t('Terms')}: {terms.name} v{terms.version}</p>}
    </div>
  );
}
