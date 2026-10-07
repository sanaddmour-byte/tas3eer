import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';

export interface Opt { id: string; label: string; sub?: ReactNode; search: string }
/** Accessible searchable select (ARIA 1.2 combobox with listbox popup). */
export function Combobox({ label, options, value, onChange, placeholder, error, disabled, inputId, emptyText, footer, hint }: {
  label: ReactNode; options: Opt[]; value: string | null; onChange: (id: string) => void; placeholder?: string; error?: string | null; disabled?: boolean; inputId?: string; emptyText?: string; footer?: ReactNode; hint?: ReactNode;
}) {
  const t = useT();
  const gen = useId();
  const id = inputId ?? gen;
  const sel = options.find((o) => o.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => { const n = q.trim().toLowerCase(); return n ? options.filter((o) => o.search.toLowerCase().includes(n)) : options; }, [q, options]);
  useEffect(() => { setIdx(0); }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out);
  }, [open]);
  const pick = (o: Opt) => { onChange(o.id); setOpen(false); setQ(''); };
  return (
    <div className="field picker" ref={ref}>
      <label htmlFor={id} style={{ fontWeight: 550, fontSize: 14 }}>{label}</label>
      <input
        id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-lb`} aria-autocomplete="list" aria-invalid={!!error} aria-activedescendant={open && filtered[idx] ? `${id}-o${idx}` : undefined} disabled={disabled}
        value={open ? q : sel?.label ?? ''} placeholder={placeholder ?? t('Search…')} autoComplete="off"
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && filtered[idx]) { e.preventDefault(); pick(filtered[idx]!); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
      {open && (
        <ul id={`${id}-lb`} role="listbox" aria-label={typeof label === 'string' ? label : undefined}>
          {filtered.length === 0 && <li aria-disabled="true" className="muted">{emptyText ?? t('No matches')}</li>}
          {filtered.map((o, i) => (
            <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <div className="mixopt"><span>{o.label}</span>{o.sub && <span className="muted small">{o.sub}</span>}</div>
            </li>
          ))}
          {footer && <li aria-disabled="true" style={{ cursor: 'default' }}>{footer}</li>}
        </ul>
      )}
    </div>
  );
}
