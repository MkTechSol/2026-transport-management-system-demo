import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, get, qs } from './api';
import { useToast } from '../ui/Toast';

export interface Paged<T> { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }

/** Generic paged list query. Keeps previous data while paging for a flicker-free table. */
export function useList<T = any>(path: string, params: Record<string, unknown>, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery<Paged<T> & Record<string, any>, ApiError>({
    queryKey: [path, params],
    queryFn: () => get(`${path}${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
    enabled: opts.enabled,
  });
}

export function useDetail<T = any>(path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T, ApiError>({ queryKey: [path], queryFn: () => get(path!), enabled: !!path, refetchInterval: opts.refetchInterval });
}

/** Mutation with toast + invalidation of related query prefixes. */
export function useAction<TVars, TRes = any>(fn: (v: TVars) => Promise<TRes>, o: { invalidate?: string[]; success?: string | ((r: TRes) => string); onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient(); const { toast } = useToast();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const k of o.invalidate ?? []) qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(k) });
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && ((q.queryKey[0] as string).startsWith('/dashboard') || (q.queryKey[0] as string).startsWith('/notifications')) });
      if (o.success) toast('success', typeof o.success === 'function' ? o.success(r) : o.success);
      o.onSuccess?.(r);
    },
    onError: (e) => { if (!e.fields) toast('error', e.message); },
  });
}

/** List state kept in the URL (shareable, survives back/forward). */
export function useQueryState(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => {
    const o: Record<string, string> = { ...defaults };
    sp.forEach((v, k) => { o[k] = v; });
    return o;
  }, [sp, defaults]);
  const set = useCallback((patch: Record<string, string | number | undefined>, resetPage = true) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === 'ALL') n.delete(k); else n.set(k, String(v)); }
      if (resetPage && !('page' in patch)) n.delete('page');
      return n;
    }, { replace: true });
  }, [setSp]);
  const clear = useCallback((keep: string[] = []) => setSp((prev) => { const n = new URLSearchParams(); keep.forEach((k) => prev.get(k) && n.set(k, prev.get(k)!)); return n; }, { replace: true }), [setSp]);
  return { state, set, clear, page: Number(state.page ?? 1) || 1 };
}

export function useSort(state: Record<string, string>, set: (p: Record<string, string | undefined>) => void, defaultSort?: string) {
  const sort = state.sort ?? defaultSort; const dir = (state.dir as 'asc' | 'desc' | undefined) ?? 'desc';
  const onSort = (key: string) => set({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' });
  return { sort, dir, onSort };
}

/** Maps server field errors (zod) onto form fields. */
export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : {});
