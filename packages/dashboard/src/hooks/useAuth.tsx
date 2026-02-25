import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, setToken, clearToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  creditsRemaining: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.auth.me();
      setUser(user);
    } catch {
      setUser(null);
      clearToken();
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('ordinex_token');
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const { user, token } = await api.auth.login({ email, password });
    setToken(token);
    setUser(user);
  };

  const signup = async (email: string, password: string, name: string) => {
    const { user, token } = await api.auth.signup({ email, password, name });
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
