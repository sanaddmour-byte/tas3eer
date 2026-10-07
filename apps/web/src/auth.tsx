import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, setCsrf, setOnUnauth } from './lib/api';
import { useLang } from './lib/i18n';
import { clearStore, openStore } from './offline/store';

export interface Me {
  user: { id: string; name: string; email: string; locale: string }; tenant: { id: string; name: string; demo: boolean; company: any };
  role: string; capabilities: string[]; allPlants: boolean; plantIds: string[]; csrfToken: string; settings: { staleAfterDays: number; defaultValidityDays: number };
}
interface AuthCtx { me: Me | null; loading: boolean; can: (...c: string[]) => boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; setMe: (m: Me) => void; storeReady: boolean }
const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

const ME_KEY = 'rm:lastMe';
const cacheMe = (m: Me) => { try { localStorage.setItem(ME_KEY, JSON.stringify({ ...m, csrfToken: '' })); } catch { /* storage unavailable */ } };
const readMe = (): Me | null => { try { const s = localStorage.getItem(ME_KEY); return s ? (JSON.parse(s) as Me) : null; } catch { return null; } };
async function adopt(m: Me) { setCsrf(m.csrfToken); await openStore(m.tenant.id, m.user.id); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [storeReady, setStoreReady] = useState(false);
  const qc = useQueryClient();
  const { setLang } = useLang();
  const setMe = useCallback((m: Me) => { setMeState(m); }, []);
  useEffect(() => {
    setOnUnauth(() => { setMeState(null); qc.clear(); });
    get<Me>('/auth/me').then(async (m) => { await adopt(m); cacheMe(m); setMeState(m); setStoreReady(true); if (m.user.locale) setLang(m.user.locale as any); }).catch(async (e) => {
      // Offline start: reuse the last known identity (tenant/user/capabilities only — no secrets) so cached drafts stay usable.
      // The server revalidates the session as soon as the device is back online (see the 'online' listener below).
      if (e instanceof ApiError && e.status === 0) { const m = readMe(); if (m) { await adopt(m); setMeState(m); setStoreReady(true); } }
    }).finally(() => setLoading(false));
    const revalidate = () => get<Me>('/auth/me').then((m) => { setCsrf(m.csrfToken); cacheMe(m); setMeState(m); }).catch(() => {});
    addEventListener('online', revalidate);
    return () => removeEventListener('online', revalidate);
  }, []);
  const login = async (email: string, password: string) => {
    const m = await post<Me>('/auth/login', { email, password });
    await adopt(m); setMeState(m); setStoreReady(true); if (m.user.locale) setLang(m.user.locale as any); qc.clear();
  };
  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    await clearStore(); // confidential cached data is removed from the device
    try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
    setCsrf(''); setMeState(null); setStoreReady(false); qc.clear();
  };
  const can = (...c: string[]) => !!me && c.some((x) => me.capabilities.includes(x));
  return <Ctx.Provider value={{ me, loading, can, login, logout, setMe, storeReady }}>{children}</Ctx.Provider>;
}
