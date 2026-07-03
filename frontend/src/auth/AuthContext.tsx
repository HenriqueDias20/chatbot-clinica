import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, auth as tokenStore, onUnauthorized, type AuthUser } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Ao carregar: se há token salvo, valida com /me.
  useEffect(() => {
    let active = true;
    const token = tokenStore.getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => active && setUser(u))
      .catch(() => active && tokenStore.clear())
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Se qualquer request der 401, desloga.
  useEffect(() => {
    onUnauthorized.handler = () => setUser(null);
    return () => {
      onUnauthorized.handler = null;
    };
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const { token, user } = await api.login(email, password);
    tokenStore.setToken(token);
    setUser(user);
  }

  function logout(): void {
    tokenStore.clear();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
