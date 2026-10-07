import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { flush, getReference, lastSync, listOutbox, refreshReference, subscribe } from '../offline/store';
import { useOnline } from '../components/ui';

/** Per-user/tenant display preferences (filters, view modes). Namespaced so nothing leaks between users or tenants. */
export function usePref<T>(key: string, init: T): [T, (v: T) => void] {
  const { me } = useAuth();
  const k = `rm:pref:${me?.tenant.id}:${me?.user.id}:${key}`;
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : init; } catch { return init; } });
  const set = useCallback((n: T) => { setV(n); try { localStorage.setItem(k, JSON.stringify(n)); } catch { /* storage unavailable */ } }, [k]);
  return [v, set];
}

export interface SyncStatus { online: boolean; pending: number; conflicts: number; errors: number; lastSync: string | null; refFetchedAt: string | null }
export function useSyncStatus(): SyncStatus {
  const online = useOnline();
  const { storeReady } = useAuth();
  const [s, setS] = useState<SyncStatus>({ online, pending: 0, conflicts: 0, errors: 0, lastSync: null, refFetchedAt: null });
  const load = useCallback(async () => {
    if (!storeReady) return;
    const ops = await listOutbox();
    setS({ online, pending: ops.filter((o) => o.status === 'pending').length, conflicts: ops.filter((o) => o.status === 'conflict').length, errors: ops.filter((o) => o.status === 'error').length, lastSync: await lastSync(), refFetchedAt: (await getReference())?.fetchedAt ?? null });
  }, [online, storeReady]);
  useEffect(() => { void load(); return subscribe(() => void load()); }, [load]);
  useEffect(() => { if (online && storeReady) { void flush(); void refreshReference().catch(() => {}); } }, [online, storeReady]);
  useEffect(() => { if (!online || !storeReady) return; const h = setInterval(() => { void flush(); void refreshReference().catch(() => {}); }, 5 * 60_000); return () => clearInterval(h); }, [online, storeReady]);
  return s;
}
