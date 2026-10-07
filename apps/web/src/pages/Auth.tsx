import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { ApiError, get, post } from '../lib/api';
import { useLang, useT } from '../lib/i18n';
import { Alert, Icon, TextField } from '../components/ui';
import { openStore } from '../offline/store';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <div className="auth dark"><div className="card stack">
      <div className="hstack"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#101E32" /><path d="M8 21h16M10 21v-6l6-5 6 5v6" stroke="#F59E0B" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg><strong className="grow">{t('Ready Mix Pricing')}</strong>
        <button className="btn-ghost btn-sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}><Icon n="globe" size={16} />{lang === 'en' ? 'العربية' : 'English'}</button></div>
      <h1>{title}</h1>{children}</div></div>
  );
}

export function LoginPage() {
  const t = useT();
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => get('/setup/status'), retry: false });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email, password); nav(loc.state?.from ?? '/', { replace: true }); }
    catch (x) { setErr(x instanceof ApiError && x.status === 0 ? t('You are offline. Connect to sign in.') : x instanceof ApiError && x.status === 429 ? t('Too many attempts. Try again later.') : t('Invalid email or password.')); }
    finally { setBusy(false); }
  };
  return (
    <Frame title={t('Sign in')}>
      <form className="stack" onSubmit={submit} noValidate>
        {err && <Alert tone="err">{err}</Alert>}
        <TextField label={t('Email')} type="email" autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label={t('Password')} type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary" disabled={busy || !email || !password}>{busy ? t('Signing in…') : t('Sign in')}</button>
        {status.data?.needsSetup && <a href="/setup">{t('First-time setup')}</a>}
        {status.data?.demoMode && <p className="muted small">{t('Demo mode is enabled on this server.')}</p>}
      </form>
    </Frame>
  );
}

export function SetupPage() {
  const t = useT();
  const nav = useNavigate();
  const { setMe } = useAuth();
  const [f, setF] = useState({ token: '', companyName: '', slug: '', adminName: '', adminEmail: '', password: '' });
  const [err, setErr] = useState('');
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => get('/setup/status') });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { await post('/setup', f); const m = await get('/auth/me'); await openStore(m.tenant.id, m.user.id); setMe(m); location.href = '/'; }
    catch (x) { setErr((x as Error).message); }
  };
  if (status.data && !status.data.needsSetup) return <Frame title={t('Setup unavailable')}><Alert tone="info">{t('Setup is disabled or already completed. Ask your administrator for an invitation.')}</Alert></Frame>;
  return (
    <Frame title={t('First-time setup')}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">{t('Create the company and its first administrator. A deployment setup token is required.')}</p>
        {err && <Alert tone="err">{err}</Alert>}
        <TextField label={t('Setup token')} type="password" dir="ltr" value={f.token} onChange={set('token')} required />
        <TextField label={t('Company name')} value={f.companyName} onChange={set('companyName')} required />
        <TextField label={t('Company short code (URL-safe)')} dir="ltr" value={f.slug} onChange={set('slug')} pattern="[a-z0-9-]{2,40}" required />
        <TextField label={t('Administrator name')} value={f.adminName} onChange={set('adminName')} required />
        <TextField label={t('Administrator email')} type="email" dir="ltr" value={f.adminEmail} onChange={set('adminEmail')} required />
        <TextField label={t('Password')} type="password" dir="ltr" hint={t('At least 10 characters')} value={f.password} onChange={set('password')} minLength={10} required />
        <button className="btn-primary">{t('Create company')}</button>
      </form>
    </Frame>
  );
}

export function AcceptInvitePage() {
  const t = useT();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [info, setInfo] = useState<any>(null); const [err, setErr] = useState('');
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  useEffect(() => { get(`/auth/invitations/${token}`).then(setInfo).catch(() => setErr(t('This invitation is invalid or has expired.'))); }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { await post('/auth/invitations/accept', { token, name, password }); location.href = '/'; } catch (x) { setErr((x as Error).message); }
  };
  return (
    <Frame title={t('Accept invitation')}>
      {err && <Alert tone="err">{err}</Alert>}
      {info && (
        <form className="stack" onSubmit={submit}>
          <p>{t('You have been invited to {company}.', { company: info.company })} <span className="ltr">{info.email}</span></p>
          <TextField label={t('Your name')} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label={t('Choose a password')} type="password" dir="ltr" hint={t('At least 10 characters')} minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn-primary">{t('Activate account')}</button>
        </form>
      )}
    </Frame>
  );
}
