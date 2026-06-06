import type { ReactNode } from "react";
import { hasAnyPermission, resolveLoansRoutePermissions, type Permission } from "@bms/shared";

type Props = {
  permissions: Permission[] | undefined;
  route: string;
  denied: ReactNode;
  children: ReactNode;
};

export function LoansPermissionGate({ permissions, route, denied, children }: Props) {
  if (!hasAnyPermission(permissions, resolveLoansRoutePermissions(route))) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
