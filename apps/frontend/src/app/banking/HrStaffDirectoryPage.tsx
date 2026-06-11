import { useShallow } from "zustand/react/shallow";
import { UserManagementCard } from "../UserManagementCard";
import { useHrDeskStore } from "../stores/hrDeskStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import type { AppRole } from "../api";

type Props = { displayName?: string; role: AppRole };

export function HrStaffDirectoryPage({ displayName, role }: Props) {
  const config = getRoleDeskConfig("hrm");
  const { lastFetchedAt, rosterLoading, refreshRoster } = useHrDeskStore(
    useShallow((s) => ({
      lastFetchedAt: s.lastRosterAt,
      rosterLoading: s.rosterLoading,
      refreshRoster: s.refreshRoster
    }))
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={{ ...config, title: "Employee profiles", subtitle: "Staff accounts, roles, teller slots, and contact details." }}
      displayName={displayName}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshRoster()}
      refreshing={rosterLoading}
    >
      <UserManagementCard role={role} />
    </RoleDeskShell>
  );
}
