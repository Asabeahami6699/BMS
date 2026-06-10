import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppRole, AuthMe } from "../app/api";
import {
  authMeSignature,
  clearAuthSession,
  getAuthMe,
  getAuthSession,
  login as apiLogin,
  logout as apiLogout
} from "../app/api";
import { isOfflineOrNetworkError } from "../lib/useNetworkStatus";
import { getHomePathForRole } from "./roleRedirect";
import { SESSION_UNAUTHORIZED_EVENT } from "./sessionIdleConfig";

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
  const refreshInFlightRef = useRef<Promise<AuthMe | null> | null>(null);
  const didBootstrapRef = useRef(false);

  const applyUser = useCallback((next: AuthMe | null) => {
    setUser((prev) => {
      if (authMeSignature(prev) === authMeSignature(next)) {
        return prev;
      }
      return next;
    });
  }, []);

  const refreshMe = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const task = (async () => {
      if (!getAuthSession()?.accessToken) {
        applyUser(null);
        return null;
      }
      try {
        const me = await getAuthMe();
        applyUser(me);
        return me;
      } catch (error) {
        const cached = getAuthSession();
        if (cached?.user && isOfflineOrNetworkError(error)) {
          applyUser(cached.user);
          return cached.user;
        }
        clearAuthSession();
        applyUser(null);
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = task;
    return task;
  }, [applyUser]);

  useEffect(() => {
    function onUnauthorized() {
      applyUser(null);
    }
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [applyUser]);

  useEffect(() => {
    if (didBootstrapRef.current) {
      return;
    }
    didBootstrapRef.current = true;

    if (!getAuthSession()?.accessToken) {
      setLoading(false);
      return;
    }
    void refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await apiLogin(email, password);
      applyUser(session.user);
      return getHomePathForRole(session.user.role as AppRole);
    },
    [applyUser]
  );

  const logout = useCallback(async () => {
    await apiLogout();
    applyUser(null);
  }, [applyUser]);

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
