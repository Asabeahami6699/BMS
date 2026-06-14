import type { ReactNode } from "react";
import { hasAnyPermission, resolveInvestmentsRoutePermissions, type Permission } from "@bms/shared";

type Props = {
  permissions: Permission[] | undefined;
  route: string;
  denied: ReactNode;
  children: ReactNode;
};

export function InvestmentsPermissionGate({ permissions, route, denied, children }: Props) {
  if (!hasAnyPermission(permissions, resolveInvestmentsRoutePermissions(route))) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
