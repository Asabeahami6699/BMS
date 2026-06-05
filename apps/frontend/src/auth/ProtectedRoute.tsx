import { Navigate } from "react-router-dom";
import type { AppRole } from "../app/api";
import { getAuthSession } from "../app/api";
import { getHomePathForRole } from "./roleRedirect";
import { useAuth } from "./AuthContext";

type Props = {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  forbiddenRoles?: AppRole[];
};

export function ProtectedRoute({ children, allowedRoles, forbiddenRoles }: Props) {
  const { user, loading } = useAuth();
  const session = getAuthSession();

  if (loading) {
    return (
      <main className="login-page">
        <p>Loading session...</p>
      </main>
    );
  }

  const effectiveUser = user ?? session?.user ?? null;

  if (!session?.accessToken || !effectiveUser) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(effectiveUser.role)) {
    return <Navigate to={getHomePathForRole(effectiveUser.role)} replace />;
  }

  if (forbiddenRoles?.includes(effectiveUser.role)) {
    return <Navigate to={getHomePathForRole(effectiveUser.role)} replace />;
  }

  return <>{children}</>;
}
