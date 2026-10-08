export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public violations?: { message: string; code: string; resource: string }[]) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const setAuthLostHandler = (fn: () => void) => { onAuthLost = fn; };

async function raw(method: string, path: string, body?: unknown, extra?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', ...extra });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await raw('POST', '/auth/refresh', {});
        if (!r.ok) return false;
        const j = await r.json();
        accessToken = j.accessToken;
        return true;
      } catch { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

async function toError(r: Response): Promise<ApiError> {
  let j: any = null;
  try { j = await r.json(); } catch { /* non-JSON error */ }
  const e = j?.error;
  return new ApiError(r.status, e?.code ?? 'ERROR', e?.message ?? (r.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'The request could not be completed.'), e?.details?.fields, e?.details?.violations);
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let r = await raw(method, path, body);
  if (r.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) r = await raw(method, path, body);
    else { onAuthLost?.(); }
  }
  if (!r.ok) throw await toError(r);
  if (r.status === 204) return undefined as T;
  return r.json();
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== 'ALL') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Download a CSV (needs the bearer header, so fetch + blob rather than a plain link). */
export async function download(path: string, filename: string) {
  let r = await raw('GET', path);
  if (r.status === 401 && (await refreshSession())) r = await raw('GET', path);
  if (!r.ok) throw await toError(r);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
