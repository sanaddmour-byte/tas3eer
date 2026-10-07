import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import { get, post, ApiError } from '../lib/api';

/**
 * Per-tenant, per-user local storage. Contains authorized, customer-facing reference data and the
 * draft outbox only (never cost data — the sales reference endpoint does not return it).
 * Cleared on logout. Limitation: a revoked user keeps cached data on a device that stays offline until it next connects.
 */
let db: IDBPDatabase | null = null;
let dbName = '';
export async function openStore(tenantId: string, userId: string) {
  const name = `rm-${tenantId}-${userId}`;
  if (db && dbName === name) return db;
  db?.close();
  dbName = name;
  db = await openDB(name, 1, { upgrade(d) { d.createObjectStore('kv'); d.createObjectStore('outbox', { keyPath: 'id' }); d.createObjectStore('drafts', { keyPath: 'id' }); } });
  return db;
}
export async function clearStore() {
  const n = dbName; db?.close(); db = null; dbName = '';
  if (n) await deleteDB(n);
}
const need = () => { if (!db) throw new Error('store not open'); return db; };

export interface RefSnapshot { data: any; fetchedAt: string }
export async function getReference(): Promise<RefSnapshot | null> { return (await need().get('kv', 'reference')) ?? null; }
export async function refreshReference(): Promise<RefSnapshot | null> {
  try {
    const data = await get('/reference/sales');
    const snap = { data, fetchedAt: new Date().toISOString() };
    await need().put('kv', snap, 'reference');
    await need().put('kv', snap.fetchedAt, 'lastSync');
    emit();
    return snap;
  } catch (e) { if (e instanceof ApiError && e.status === 0) return getReference(); throw e; }
}

export interface Draft { id: string; number: string | null; revNo: number; version: number; status: string; doc: any; updatedAt: string; client?: string | null; project?: string | null }
export const cacheDraft = (d: Draft) => need().put('drafts', d);
export const getDraft = (id: string): Promise<Draft | undefined> => need().get('drafts', id);
export const listDrafts = (): Promise<Draft[]> => need().getAll('drafts');
export const removeDraft = (id: string) => need().delete('drafts', id);

export interface OutboxOp {
  id: string; key: string; doc: any; baseVersion: number; revNo: number; create: boolean; createdAt: string;
  status: 'pending' | 'conflict' | 'error'; error?: string; serverDoc?: any; serverVersion?: number;
}
export const listOutbox = (): Promise<OutboxOp[]> => need().getAll('outbox');
export const getOp = (id: string): Promise<OutboxOp | undefined> => need().get('outbox', id);
export const putOp = (op: OutboxOp) => need().put('outbox', op);
export const delOp = (id: string) => need().delete('outbox', id);

// ---- tiny event bus for UI status ----
const listeners = new Set<() => void>();
export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const emit = () => listeners.forEach((f) => f());
const savedListeners = new Set<(id: string, res: any) => void>();
export const onSaved = (f: (id: string, res: any) => void) => { savedListeners.add(f); return () => { savedListeners.delete(f); }; };

let flushing = false;
let lastKeySent: Record<string, string> = {};
/** Queue (and coalesce) a draft save. The local write is durable BEFORE any network attempt. */
export async function queueSave(p: { id: string; doc: any; baseVersion: number; revNo: number; create: boolean }) {
  const prev = await getOp(p.id);
  await putOp({ id: p.id, key: crypto.randomUUID(), doc: p.doc, baseVersion: prev && prev.status !== 'conflict' ? prev.baseVersion : p.baseVersion, revNo: p.revNo, create: prev ? prev.create && p.create : p.create, createdAt: new Date().toISOString(), status: 'pending' });
  emit();
  void flush();
}
export async function flush() {
  if (flushing || !db) return;
  flushing = true;
  try {
    for (const op of (await listOutbox()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (op.status === 'conflict' || op.status === 'error') continue;
      lastKeySent[op.id] = op.key;
      try {
        const res = await post('/sync/operations', { idempotencyKey: op.key, type: 'quotation.save', quotationId: op.id, revNo: op.revNo, baseVersion: op.baseVersion, create: op.create, doc: op.doc });
        const cur = await getOp(op.id);
        if (cur && cur.key === op.key) await delOp(op.id);
        else if (cur) await putOp({ ...cur, baseVersion: res.version, revNo: res.revNo, create: false });
        await db!.put('kv', new Date().toISOString(), 'lastSync');
        savedListeners.forEach((f) => f(op.id, res));
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // offline: keep queue, retry later
        const cur = (await getOp(op.id)) ?? op;
        if (e instanceof ApiError && e.status === 409 && e.body?.serverDoc) await putOp({ ...cur, status: 'conflict', serverDoc: e.body.serverDoc, serverVersion: e.body.serverVersion, error: e.message });
        else if (e instanceof ApiError && e.status === 409) await putOp({ ...cur, status: 'error', error: e.message });
        else await putOp({ ...cur, status: 'error', error: (e as Error).message });
        savedListeners.forEach((f) => f(op.id, { error: e }));
      }
    }
  } finally { flushing = false; emit(); }
}
export async function resolveConflict(id: string, choice: 'mine' | 'server') {
  const op = await getOp(id);
  if (!op) return;
  if (choice === 'mine') await putOp({ ...op, baseVersion: op.serverVersion ?? op.baseVersion, key: crypto.randomUUID(), status: 'pending', serverDoc: undefined, error: undefined });
  else await delOp(id);
  emit();
  if (choice === 'mine') void flush();
}
export async function retryOp(id: string) { const op = await getOp(id); if (op) { await putOp({ ...op, key: crypto.randomUUID(), status: 'pending', error: undefined }); emit(); void flush(); } }
export async function discardOp(id: string) { await delOp(id); await removeDraft(id); emit(); }
export async function lastSync(): Promise<string | null> { return (await need().get('kv', 'lastSync')) ?? null; }
