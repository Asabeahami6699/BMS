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

/** Admin/coordinator always get Overages/Shortages even if tenant nav config is stale. */
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

/** Cycle fees page — separate from agent commissions; heal stale tenant nav matrices. */
function canAccessCycleFeesFallback(
  role: Role | undefined,
  permissions: Permission[] | undefined
): boolean {
  if (role !== "admin" && role !== "accountant" && role !== "coordinator") {
    return false;
  }
  return hasAnyPermission(permissions, [
    "commission_policy.read",
    "income.read",
    "income.read.daily"
  ]);
}

function canAccessSusuIncomeFallback(
  role: Role | undefined,
  permissions: Permission[] | undefined
): boolean {
  if (role !== "admin" && role !== "accountant" && role !== "coordinator") {
    return false;
  }
  return hasAnyPermission(permissions, ["income.read", "income.read.daily"]);
}

function canAccessTellerCalloverFallback(
  role: Role | undefined,
  permissions: Permission[] | undefined
): boolean {
  if (role !== "admin" && role !== "coordinator" && role !== "teller") {
    return false;
  }
  return hasAnyPermission(permissions, ["transactions.read"]);
}

export function SusuPermissionGate({
  role,
  permissions,
  route,
  susuNavVisibility,
  denied,
  children
}: Props) {
  const path = normalizeRoute(route);
  const allowed =
    canAccessSusuRoute(role, permissions, route, susuNavVisibility) ||
    (path === "susu/overages-shortages" && canAccessOsFallback(role, permissions)) ||
    (path === "susu/cycle-commission" && canAccessCycleFeesFallback(role, permissions)) ||
    (path === "susu/income" && canAccessSusuIncomeFallback(role, permissions)) ||
    (path === "susu/teller-callover" && canAccessTellerCalloverFallback(role, permissions));
  if (!allowed) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
