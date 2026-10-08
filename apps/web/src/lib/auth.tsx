import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission, Role } from '@gasman/shared';
import { api, post, refreshSession, setAccessToken, setAuthLostHandler } from './api';

export interface SessionUser { id: number; email: string; name: string; role: Role; driverId: number | null; permissions: Permission[] }
interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (...perms: Permission[]) => boolean;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const clear = useCallback(() => { setAccessToken(null); setUser(null); qc.clear(); try { localStorage.removeItem('gm_session'); } catch { /* private mode */ } }, [qc]);

  useEffect(() => {
    setAuthLostHandler(clear);
    (async () => {
      try {
        // Only probe for a session if this browser has signed in before (avoids a needless 401 on first visit).
        let hint = false; try { hint = localStorage.getItem('gm_session') === '1'; } catch { /* ignore */ }
        if (hint && await refreshSession()) { const me = await api<{ user: SessionUser }>('GET', '/auth/me'); setUser(me.user); }
      } catch { /* not signed in */ } finally { setLoading(false); }
    })();
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ accessToken: string; user: SessionUser }>('/auth/login', { email, password });
    setAccessToken(r.accessToken); qc.clear(); setUser(r.user); try { localStorage.setItem('gm_session', '1'); } catch { /* ignore */ }
    return r.user;
  }, [qc]);

  const logout = useCallback(async () => { try { await post('/auth/logout', {}); } catch { /* ignore */ } clear(); }, [clear]);
  const can = useCallback((...perms: Permission[]) => !!user && perms.some((p) => user.permissions.includes(p)), [user]);
  const value = useMemo(() => ({ user, loading, login, logout, can }), [user, loading, login, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
