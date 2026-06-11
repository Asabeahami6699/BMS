import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { UserRecord } from "../../api";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useBranchesLiveSync } from "../../hooks/useBranchesLiveSync";
import { useBranchesStore } from "../../stores/branchesStore";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string };

function employmentDate(user: UserRecord): string {
  if (user.createdAt) {
    return user.createdAt.slice(0, 10);
  }
  return "—";
}

export function HrAppointmentPage({ displayName }: Props) {
  const [search, setSearch] = useState("");
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);

  const {
    users,
    loading,
    error,
    lastFetchedAt,
    hydrateRoster,
    refreshRoster,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      users: s.users,
      loading: s.rosterLoading,
      error: s.rosterError,
      lastFetchedAt: s.lastRosterAt,
      hydrateRoster: s.hydrateRoster,
      refreshRoster: s.refreshRoster,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateRoster();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateRoster, startLiveSync, stopLiveSync]);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  const filtered = filterRowsBySearch(
    users.map((u) => ({
      ...u,
      branchLabel: u.branchId
        ? `${branchById.get(u.branchId)?.name ?? u.branchId} (${branchById.get(u.branchId)?.code ?? ""})`
        : "Head office"
    })),
    search,
    ["fullName", "email", "role", "branchLabel"] as (keyof UserRecord)[]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <HrSectionShell
      title="Appointment letters"
      subtitle="Employment start dates and role assignments for official records."
      displayName={displayName}
      loading={loading && users.length === 0}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshRoster()}
      refreshing={loading}
    >
      <AdminDataTable
        variant="desk"
        title="Appointment letters"
        subtitle="Employment start dates and official role assignments."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee, role, branch…"
        columns={[
          { key: "fullName", label: "Employee", render: (r) => r.fullName ?? r.email },
          { key: "role", label: "Job title" },
          { key: "branchLabel", label: "Branch" },
          { key: "employmentDate", label: "Employment date" },
          { key: "status", label: "Status" }
        ]}
        rows={filtered.map((u) => ({
          id: u.userId,
          fullName: u.fullName,
          email: u.email,
          role: u.role.replace(/_/g, " "),
          branchLabel: u.branchId
            ? `${branchById.get(u.branchId)?.name ?? u.branchId}`
            : "Head office",
          employmentDate: employmentDate(u),
          status: u.status
        }))}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No employees found."}
      />
    </HrSectionShell>
  );
}
