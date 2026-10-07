import { useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useT } from '../lib/i18n';

export function Icon({ n, size = 20 }: { n: string; size?: number }) {
  const p: Record<string, string> = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', file: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h8M9 17h8', cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z', check: 'M5 12l4 4 10-10', users: 'M16 11a4 4 0 100-8 4 4 0 000 8zM3 21c0-4 3-6 7-6s7 2 7 6M17 14c3 0 5 2 5 5', clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
    briefcase: 'M4 8h16v12H4zM9 8V5h6v3', upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', more: 'M5 12h.01M12 12h.01M19 12h.01', menu: 'M4 6h16M4 12h16M4 18h16', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
    chevron: 'M9 6l6 6-6 6', globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', alert: 'M12 4l9 16H3zM12 10v4M12 17h.01', cloud: 'M7 18a4 4 0 010-8 5 5 0 019.6 1.3A3.5 3.5 0 0116.5 18z', factory: 'M3 21V10l6 4v-4l6 4V6h6v15z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', download: 'M12 4v12M7 11l5 5 5-5M4 20h16', copy: 'M9 9h11v11H9zM5 15V4h11', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p[n] ?? p.file} /></svg>;
}

const TONE: Record<string, [string, string]> = {
  draft: ['', 'Draft'], pending_approval: ['warn', 'Pending approval'], approved: ['info', 'Approved'], issued: ['ok', 'Issued'], accepted: ['ok', 'Accepted'], declined: ['err', 'Declined'], expired: ['', 'Expired'],
  cancelled: ['', 'Cancelled'], returned: ['warn', 'Returned for changes'], superseded: ['', 'Superseded'], submitted: ['warn', 'Awaiting review'], published: ['ok', 'Published'], rejected: ['err', 'Rejected'],
  pending_technical: ['warn', 'Awaiting technical approval'], verified: ['ok', 'Verified'], demo: ['warn', 'Demo – unverified'], retired: ['', 'Retired'], active: ['ok', 'Active'], disabled: ['', 'Disabled'], pending: ['warn', 'Pending'], invalidated: ['', 'Invalidated'],
};
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const [tone, label] = TONE[status] ?? ['', status];
  return <span className={`badge ${tone}`}>{t(label)}</span>;
}

export function Field({ label, hint, error, children, id }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; id?: string }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="err" role="alert">{error}</span>}
    </label>
  );
}
type FProps = { label: ReactNode; hint?: ReactNode; error?: string | null };
export function TextField({ label, hint, error, ...p }: FProps & InputHTMLAttributes<HTMLInputElement>) {
  const gen = useId(); const id = p.id ?? gen;
  return <Field label={label} hint={hint} error={error} id={id}><input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...p} /></Field>;
}
export function AreaField({ label, hint, error, ...p }: FProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const gen = useId(); const id = p.id ?? gen;
  return <Field label={label} hint={hint} error={error} id={id}><textarea id={id} aria-invalid={!!error} {...p} /></Field>;
}
export function SelectField({ label, hint, error, children, ...p }: FProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const gen = useId(); const id = p.id ?? gen;
  return <Field label={label} hint={hint} error={error} id={id}><select id={id} aria-invalid={!!error} {...p}>{children}</select></Field>;
}
/** Decimal input with a visible unit. Keeps the raw string (never coerces missing values to zero). */
export function NumField({ label, unit, value, onChange, error, hint, name, disabled, dp: _dp, min: _min, ...rest }: { label: ReactNode; unit: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: ReactNode; name?: string; disabled?: boolean; dp?: number; min?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'min'>) {
  const gen = useId(); const id = rest.id ?? gen;
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <span className="inputgroup">
        <input name={name} inputMode="decimal" dir="ltr" autoComplete="off" value={value} disabled={disabled} aria-invalid={!!error} onChange={(e) => { const v = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.\-]/g, ''); onChange(v); }} {...rest} id={id} />
        <span className="unit" dir="ltr">{unit}</span>
      </span>
    </Field>
  );
}

export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'err' | 'ok'; children?: ReactNode; title?: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === 'err' ? 'alert' : 'status'}><Icon n={tone === 'ok' ? 'check' : 'alert'} /><div>{title && <strong>{title}</strong>}{children}</div></div>;
}

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="state" role="status" aria-live="polite"><span className="spinner" /><div>{label ?? t('Loading…')}</div></div>;
}
export function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="stack-sm" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 10}%` }} />)}</div>; }
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) { return <div className="state"><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useT();
  const e = error as ApiError;
  if (e?.status === 403) return <ForbiddenState />;
  if (e?.status === 0) return <div className="state"><h2>{t('You appear to be offline')}</h2><p>{t('This screen needs a connection. Cached quotation drafts remain available.')}</p>{retry && <button onClick={retry}>{t('Try again')}</button>}</div>;
  return <div className="state" role="alert"><h2>{t('Something went wrong')}</h2><p>{e?.status === 404 ? t('Not found') : e?.message ?? ''}</p>{retry && <button onClick={retry}>{t('Try again')}</button>}</div>;
}
export function ForbiddenState() { const t = useT(); return <div className="state" role="alert"><h2>{t('Access restricted')}</h2><p>{t('Your role does not include permission to view this area. Ask an administrator if you need access.')}</p><Link className="btn" to="/">{t('Back to overview')}</Link></div>; }

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog({ title, onClose, children, footer, wide, drawer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; drawer?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; // focus restoration on close
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('.body ' + FOCUSABLE.split(',').join(', .body ')) ?? el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const a = f[0]!, z = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);
  return (
    <div className={`overlay ${drawer ? 'drawer' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref}>
        <header><h2 id={tid}>{title}</h2><button className="icon-btn btn-ghost" onClick={onClose} aria-label={t('Close')}><Icon n="x" /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Menu({ label, children, icon = 'more' }: { label: string; children: (close: () => void) => ReactNode; icon?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu button, .menu a') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); e.preventDefault();
      }
    };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', key);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('.menu button, .menu a')?.focus(), 0);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="pos-rel" ref={ref}>
      <button ref={btn} className="icon-btn btn-ghost" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}><Icon n={icon} /></button>
      {open && <div className="menu" role="menu">{children(() => { setOpen(false); btn.current?.focus(); })}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((x) => <button key={x.id} role="tab" aria-selected={value === x.id} onClick={() => onChange(x.id)}>{x.label}</button>)}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) { return <div className="toolbar" role="search">{children}</div>; }
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = useId();
  return <div className="search"><label htmlFor={id} className="sr-only">{placeholder}</label><Icon n="search" size={18} /><input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

export function AuditTimeline({ events }: { events: { id: number; at: string; actorLabel: string | null; action: string; detail: any }[] }) {
  const t = useT();
  if (!events.length) return <EmptyState title={t('No history yet')} />;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id}><div><strong>{t(actionLabel(e.action))}</strong> <span className="muted small">— {e.actorLabel ?? t('System')}</span></div><div className="muted small ltr">{new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>{e.detail?.comment && <div className="small">“{e.detail.comment}”</div>}</li>
      ))}
    </ol>
  );
}
export const actionLabel = (a: string) => ({ created: 'Created', submitted_for_approval: 'Submitted for approval', submitted_auto_approved: 'Submitted (no approval required)', approved: 'Approved', returned_for_changes: 'Returned for changes', issued: 'Issued', cancelled: 'Cancelled', revision_created_edit: 'New revision created (edit)', revision_created_revise: 'New revision created', revision_created_reprice: 'New revision created (repriced)', outcome_accepted: 'Recorded: accepted', outcome_declined: 'Recorded: declined', outcome_expired: 'Recorded: expired', expired: 'Expired', pdf_downloaded: 'PDF downloaded', duplicated_from: 'Duplicated from another quotation', repriced_in_place: 'Repriced to current prices' } as Record<string, string>)[a] ?? a.replaceAll('_', ' ');

export function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]); return d; }
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}
