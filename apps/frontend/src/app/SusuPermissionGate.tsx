import type { ReactNode } from "react";
import {
  canAccessSusuRoute,
  hasAnyPermission,
  type Role,
  type SusuNavVisibilityRow
} from "@bms/shared";
import type { Permission } from "@bms/shared";

type Props = {
  role: Role | undefined;
  permissions: Permission[] | undefined;
  route: string;
  susuNavVisibility?: SusuNavVisibilityRow[];
  denied: ReactNode;
  children: ReactNode;
};

function normalizeRoute(route: string): string {
  return route.replace(/^\/+/, "").replace(/^app\//, "").split("?")[0] ?? "";
}

/** Admin/coordinator always get OS even if tenant nav config is stale. */
function canAccessOsFallback(role: Role | undefined, permissions: Permission[] | undefined): boolean {
  if (role !== "admin" && role !== "coordinator") {
    return false;
  }
  return hasAnyPermission(permissions, [
    "transactions.read",
    "transactions.create.daily_susu",
    "customers.read"
  ]);
}

export function SusuPermissionGate({
  role,
  permissions,
  route,
  susuNavVisibility,
  denied,
  children
}: Props) {
  const allowed =
    canAccessSusuRoute(role, permissions, route, susuNavVisibility) ||
    (normalizeRoute(route) === "susu/overages-shortages" && canAccessOsFallback(role, permissions));
  if (!allowed) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
