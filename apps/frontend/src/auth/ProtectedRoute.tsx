import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { isBuiltinRole, parseTenantSubdomain } from "@bms/shared";
import type { AppRole, AuthMe } from "../app/api";
import { getAuthSession, logout } from "../app/api";
import { getHomePathForRole } from "./roleRedirect";
import { useAuth } from "./AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  forbiddenRoles?: AppRole[];
};

function userOwnsHost(user: AuthMe, host: string): boolean {
  const subdomain = (user.tenantSubdomain || "").toLowerCase();
  const tenantId = (user.tenantId || "").toLowerCase();
  return host === subdomain || host === tenantId;
}

export function ProtectedRoute({ children, allowedRoles, forbiddenRoles }: Props) {
  const { user, loading } = useAuth();
  const session = getAuthSession();
  const effectiveUser = user ?? session?.user ?? null;
  const host = typeof window === "undefined" ? null : parseTenantSubdomain(window.location.hostname);
  const hostMismatch = Boolean(host && effectiveUser && !userOwnsHost(effectiveUser, host));

  useEffect(() => {
    if (hostMismatch) {
      void logout();
    }
  }, [hostMismatch]);

  if (loading) {
    return (
      <main className="login-page">
        <p>Loading dashboard...</p>
      </main>
    );
  }

  if (!session?.accessToken || !effectiveUser || hostMismatch) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && isBuiltinRole(effectiveUser.role) && !allowedRoles.includes(effectiveUser.role as AppRole)) {
    return <Navigate to={getHomePathForRole(effectiveUser.role, effectiveUser.subscribedModules)} replace />;
  }

  if (forbiddenRoles && isBuiltinRole(effectiveUser.role) && forbiddenRoles.includes(effectiveUser.role as AppRole)) {
    return <Navigate to={getHomePathForRole(effectiveUser.role, effectiveUser.subscribedModules)} replace />;
  }

  return <>{children}</>;
}
