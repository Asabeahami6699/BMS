import type { ReactNode } from "react";
import { hasAnyPermission, type Permission } from "@bms/shared";

type Props = {
  permissions: Permission[] | undefined;
  anyOf: Permission[];
  denied: ReactNode;
  children: ReactNode;
};

export function PermissionGate({ permissions, anyOf, denied, children }: Props) {
  if (!hasAnyPermission(permissions, anyOf)) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
