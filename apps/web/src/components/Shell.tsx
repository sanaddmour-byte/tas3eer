import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { get, post } from '../lib/api';
import { useLang, useT } from '../lib/i18n';
import { useSyncStatus } from '../lib/hooks';
import { Dialog, Icon, Menu } from './ui';
import { ageDays } from '../lib/format';
import { clearStore, listOutbox } from '../offline/store';

interface NavItem { to: string; label: string; icon: string; caps?: string[]; end?: boolean }
const MAIN: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'home', end: true },
  { to: '/quotations', label: 'Quotations', icon: 'file', caps: ['quote.create', 'quote.view_all'] },
  { to: '/mixes', label: 'Mix Library', icon: 'cube' },
  { to: '/price-book', label: 'Price Book', icon: 'tag', caps: ['cost.view'] },
  { to: '/plant-costs', label: 'Plant Costs', icon: 'factory', caps: ['cost.view'] },
  { to: '/approvals', label: 'Approvals', icon: 'check', caps: ['quote.approve', 'pricebatch.approve', 'mix.approve'] },
  { to: '/clients', label: 'Clients & Projects', icon: 'briefcase', caps: ['client.manage', 'quote.create', 'quote.view_all'] },
];
const ADMIN: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: 'users', caps: ['user.manage'] },
  { to: '/admin/audit', label: 'Audit History', icon: 'clock', caps: ['audit.view'] },
  { to: '/admin/settings', label: 'Company Settings', icon: 'gear', caps: ['tenant.manage', 'tax.manage', 'policy.manage', 'terms.manage', 'material.manage'] },
];

function Brand() {
  const t = useT();
  return <div className="brand"><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1A2D47" /><path d="M8 21h16M10 21v-6l6-5 6 5v6" stroke="#F59E0B" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{t('Ready Mix Pricing')}</span></div>;
}

export function Shell() {
  const { me, can, logout } = useAuth();
  const t = useT();
  const { lang, setLang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => { setOpen(false); setMore(false); }, [loc.pathname]);
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => get<any[]>('/plants'), enabled: sync.online, staleTime: 60_000 });
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => get<any[]>('/approvals'), enabled: sync.online && can('quote.approve'), refetchInterval: 60_000 });
  const visible = (x: NavItem) => !x.caps || can(...x.caps);
  const items = MAIN.filter(visible), admin = ADMIN.filter(visible);
  const scope = me!.allPlants ? t('All plants') : (plants.data ?? []).map((p) => p.nameEn).join(', ') || t('Assigned plants');
  const refAge = sync.refFetchedAt ? ageDays(sync.refFetchedAt) : null;
  const doLogout = async () => {
    const unsynced = (await listOutbox()).length;
    if (unsynced && !confirmOut) { setConfirmOut(true); return; }
    await logout(); nav('/login');
  };
  const link = (x: NavItem) => (
    <NavLink key={x.to} to={x.to} end={x.end} aria-current={undefined}>
      <Icon n={x.icon} /><span>{t(x.label)}</span>
      {x.to === '/approvals' && (approvals.data?.length ?? 0) > 0 && <span className="badge-count" aria-label={t('{n} pending', { n: approvals.data!.length })}>{approvals.data!.length}</span>}
    </NavLink>
  );
  return (
    <div className="app">
      <a href="#main" className="skip">{t('Skip to content')}</a>
      <aside className={`sidebar dark ${open ? 'open' : ''}`} aria-label={t('Main navigation')}>
        <Brand />
        <nav className="nav">{items.map(link)}</nav>
        {admin.length > 0 && <><div className="nav-group">{t('Administration')}</div><nav className="nav">{admin.map(link)}</nav></>}
      </aside>
      <div className="main">
        {me!.tenant.demo && <div className="banner demo" role="note"><strong>{t('DEMO company')}</strong> {t('All data is illustrative. Figures are assumptions, not company-approved values.')}</div>}
        {!sync.online && (
          <div className="banner offline" role="status"><Icon n="cloud" /><strong>{t('Offline')}</strong>
            <span>{t('Quotation drafts are saved on this device. Prices, costs and recipes are read-only.')}</span>
            {sync.refFetchedAt && <span>{t('Price snapshot age: {n} day(s)', { n: refAge ?? 0 })} · {t('Last sync')} <span className="ltr">{sync.lastSync?.slice(0, 16).replace('T', ' ') ?? '—'}</span></span>}
          </div>
        )}
        {sync.online && (sync.pending > 0 || sync.conflicts > 0 || sync.errors > 0) && (
          <div className="banner offline" role="status"><Icon n="cloud" />
            {sync.pending > 0 && <span>{t('{n} draft change(s) waiting to sync', { n: sync.pending })}</span>}
            {sync.conflicts > 0 && <Link to="/quotations">{t('{n} sync conflict(s) need your decision', { n: sync.conflicts })}</Link>}
            {sync.errors > 0 && <Link to="/quotations">{t('{n} draft(s) failed to save', { n: sync.errors })}</Link>}
          </div>
        )}
        <header className="topbar">
          <button className="burger icon-btn btn-ghost" onClick={() => setOpen(!open)} aria-label={t('Open navigation')} aria-expanded={open}><Icon n="menu" /></button>
          <div className="ctx"><span className="ctx-text">{me!.tenant.name}</span> <span className="chip" title={t('Applicable plant scope')}><Icon n="factory" size={14} />&nbsp;{scope}</span></div>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/quotations?q=${encodeURIComponent(q)}`); }}>
            <label htmlFor="gsearch" className="sr-only">{t('Search quotations, clients and projects')}</label>
            <Icon n="search" size={18} /><input id="gsearch" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search quotation, client or project')} />
          </form>
          <button className="btn-ghost" onClick={() => { const n = lang === 'en' ? 'ar' : 'en'; setLang(n); post('/auth/locale', { locale: n }).catch(() => {}); }} aria-label={t('Switch language')} lang={lang === 'en' ? 'ar' : 'en'}><Icon n="globe" size={18} /><span className="lang-label">{lang === 'en' ? 'العربية' : 'English'}</span></button>
          <Menu label={t('User menu')} icon="users">{(close) => (<>
            <div style={{ padding: '8px 12px' }}><strong>{me!.user.name}</strong><div className="muted small ltr">{me!.user.email}</div><div className="small">{t(roleLabel(me!.role))}</div></div><hr />
            <button onClick={() => { close(); void doLogout(); }}>{t('Sign out')}</button></>)}
          </Menu>
        </header>
        <main id="main" tabIndex={-1}><Outlet /></main>
      </div>
      <nav className="bottomnav dark" aria-label={t('Primary')}>
        <NavLink to="/" end><Icon n="home" /><span>{t('Home')}</span></NavLink>
        {can('quote.create', 'quote.view_all') ? <NavLink to="/quotations"><Icon n="file" /><span>{t('Quotations')}</span></NavLink> : <NavLink to="/approvals"><Icon n="check" /><span>{t('Approvals')}</span></NavLink>}
        <NavLink to="/mixes"><Icon n="cube" /><span>{t('Mixes')}</span></NavLink>
        <button onClick={() => setMore(true)} aria-haspopup="dialog"><Icon n="more" /><span>{t('More')}</span></button>
      </nav>
      {more && (
        <Dialog title={t('More')} onClose={() => setMore(false)} drawer>
          <div className="stack-sm">{[...items, ...admin].filter((x) => !['/', '/quotations', '/mixes'].includes(x.to)).map((x) => <Link key={x.to} className="btn" to={x.to} style={{ justifyContent: 'flex-start' }}><Icon n={x.icon} />{t(x.label)}</Link>)}
            <button onClick={() => { const n = lang === 'en' ? 'ar' : 'en'; setLang(n); post('/auth/locale', { locale: n }).catch(() => {}); }}><Icon n="globe" />{lang === 'en' ? 'العربية' : 'English'}</button>
            <button onClick={() => { setMore(false); void doLogout(); }}>{t('Sign out')}</button></div>
        </Dialog>
      )}
      {confirmOut && (
        <Dialog title={t('Sign out with unsynced drafts?')} onClose={() => setConfirmOut(false)} footer={<><button onClick={() => setConfirmOut(false)}>{t('Stay signed in')}</button><button className="btn-danger" onClick={async () => { setConfirmOut(false); await clearStore(); await logout(); nav('/login'); }}>{t('Discard drafts and sign out')}</button></>}>
          <p>{t('Some drafts have not synced yet. Signing out removes confidential data from this device, so those unsynced changes would be lost. Reconnect and let them sync first.')}</p>
        </Dialog>
      )}
    </div>
  );
}
export const roleLabel = (r: string) => ({ admin: 'Administrator', pricing: 'Pricing / Finance', technical: 'Technical / QA', sales: 'Sales', viewer: 'Viewer' } as Record<string, string>)[r] ?? r;
export function PageHead({ title, children, sub }: { title: ReactNode; children?: ReactNode; sub?: ReactNode }) { return <div className="page-head"><div><h1>{title}</h1>{sub && <div className="muted">{sub}</div>}</div>{children && <div className="actions">{children}</div>}</div>; }
