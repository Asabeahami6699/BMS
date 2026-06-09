import type { ReactNode } from "react";
import { canAccessSusuRoute, type Role, type SusuNavVisibilityRow } from "@bms/shared";
import type { Permission } from "@bms/shared";

type Props = {
  role: Role | undefined;
  permissions: Permission[] | undefined;
  route: string;
  susuNavVisibility?: SusuNavVisibilityRow[];
  denied: ReactNode;
  children: ReactNode;
};

export function SusuPermissionGate({
  role,
  permissions,
  route,
  susuNavVisibility,
  denied,
  children
}: Props) {
  if (!canAccessSusuRoute(role, permissions, route, susuNavVisibility)) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
