import type { ReactNode } from "react";
import { canAccessSettingsRoute, type Permission, type Role } from "@bms/shared";

type Props = {
  role: Role | undefined;
  permissions: Permission[] | undefined;
  route: string;
  denied: ReactNode;
  children: ReactNode;
};

export function SettingsPermissionGate({ role, permissions, route, denied, children }: Props) {
  if (!canAccessSettingsRoute(role, permissions, route)) {
    return <>{denied}</>;
  }
  return <>{children}</>;
}
