import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppRole, AuthMe } from "../app/api";
import { clearAuthSession, getAuthMe, getAuthSession, login as apiLogin, logout as apiLogout } from "../app/api";
import { isOfflineOrNetworkError } from "../lib/useNetworkStatus";
import { getHomePathForRole } from "./roleRedirect";

type AuthContextValue = {
  user: AuthMe | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<AuthMe | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthMe | null>(getAuthSession()?.user ?? null);
  const [loading, setLoading] = useState(Boolean(getAuthSession()?.accessToken));

  const refreshMe = useCallback(async () => {
    if (!getAuthSession()?.accessToken) {
      setUser(null);
      return null;
    }
    try {
      const me = await getAuthMe();
      setUser(me);
      return me;
    } catch (error) {
      const cached = getAuthSession();
      if (cached?.user && isOfflineOrNetworkError(error)) {
        setUser(cached.user);
        return cached.user;
      }
      clearAuthSession();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!getAuthSession()?.accessToken) {
      setLoading(false);
      return;
    }
    void refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiLogin(email, password);
    setUser(session.user);
    return getHomePathForRole(session.user.role as AppRole);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshMe
    }),
    [user, loading, login, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
