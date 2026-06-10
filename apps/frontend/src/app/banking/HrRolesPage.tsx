import { RoleManagementPage } from "../RoleManagementPage";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import type { AppRole } from "../api";

type Props = { displayName?: string; role: AppRole };

export function HrRolesPage({ displayName, role }: Props) {
  const config = getRoleDeskConfig("hrm");
  return (
    <RoleDeskShell
      config={{
        ...config,
        title: "Job titles & roles",
        subtitle: "Company job titles, extra duties, and permission templates."
      }}
      displayName={displayName}
    >
      <RoleManagementPage role={role} />
    </RoleDeskShell>
  );
}
