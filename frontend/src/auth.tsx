import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { get, post, tokenStore } from './api';

export interface User {
  id: number; email: string; full_name: string; role: 'administrator' | 'analyst' | 'regulator' | 'management';
  role_label: string; permissions: string[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

/** The landing dashboard endpoint for each role (the backend enforces this too). */
export const DASH: Record<string, string> = {
  administrator: 'admin', analyst: 'analyst', regulator: 'regulator', management: 'management',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return;
    get<{ user: User }>('/auth/me').then((d) => setUser(d.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('fa:unauthorized', h);
    return () => window.removeEventListener('fa:unauthorized', h);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const d = await post<{ token: string; user: User }>('/auth/login', { email, password });
    tokenStore.set(d.token);
    setUser(d.user);
  }, []);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* token may already be invalid */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  const can = useCallback((...perms: string[]) => !!user && perms.some((p) => user.permissions.includes(p)), [user]);
  const value = useMemo(() => ({ user, loading, login, logout, can }), [user, loading, login, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
