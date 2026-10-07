export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: any = {}) { super(message); }
}
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
let onUnauth: () => void = () => {};
export const setOnUnauth = (f: () => void) => { onUnauth = f; };

/** After an offline start the cached identity has no CSRF token; fetch a fresh one (this also revalidates the session). */
async function refreshCsrf(): Promise<void> {
  const r = await fetch('/api/auth/me', { credentials: 'same-origin' }).catch(() => null);
  if (!r) throw new ApiError(0, 'network', 'Network unavailable');
  if (r.status === 401) { onUnauth(); throw new ApiError(401, 'unauthenticated', 'Authentication required'); }
  if (r.ok) csrf = (await r.json()).csrfToken ?? '';
}

export async function api<T = any>(method: string, url: string, body?: unknown, opts: { raw?: boolean; retried?: boolean } = {}): Promise<T> {
  if (method !== 'GET' && !csrf && !url.startsWith('/auth/') && !url.startsWith('/setup')) await refreshCsrf();
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Network unavailable');
  }
  if (opts.raw) { if (!res.ok) throw new ApiError(res.status, 'http', res.statusText); return res as any; }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login')) onUnauth();
    const e = data.error ?? {};
    if (res.status === 403 && e.code === 'csrf' && !opts.retried) { await refreshCsrf(); return api<T>(method, url, body, { ...opts, retried: true }); }
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText, e);
  }
  return data as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const put = <T = any>(u: string, b?: unknown) => api<T>('PUT', u, b ?? {});
export const patch = <T = any>(u: string, b?: unknown) => api<T>('PATCH', u, b ?? {});
export const del = <T = any>(u: string) => api<T>('DELETE', u);

export async function download(url: string, filename: string) {
  const res: Response = await api('GET', url, undefined, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
