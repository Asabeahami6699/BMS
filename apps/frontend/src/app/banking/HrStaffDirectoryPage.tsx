import { UserManagementCard } from "../UserManagementCard";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import type { AppRole } from "../api";

type Props = { displayName?: string; role: AppRole };

export function HrStaffDirectoryPage({ displayName, role }: Props) {
  const config = getRoleDeskConfig("hrm");
  return (
    <RoleDeskShell
      config={{ ...config, title: "Employee profiles", subtitle: "Staff accounts, roles, teller slots, and contact details." }}
      displayName={displayName}
    >
      <UserManagementCard role={role} />
    </RoleDeskShell>
  );
}
