import type { ReactNode } from "react";
import type { Permission } from "@bms/shared";
import type { AppRole } from "../api";
import { AccessDenied } from "../tenantRouteGates";
import type { RoleWorkspaceKind } from "../stores/roleWorkspaceStore";
import { canAccessRoleDesk } from "./roleDeskConfig";

type Props = {
  kind: RoleWorkspaceKind;
  role: AppRole;
  permissions?: Permission[];
  children: ReactNode;
};

export function RoleDeskRoute({ kind, role, permissions, children }: Props) {
  if (!canAccessRoleDesk(kind, role, permissions)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}
