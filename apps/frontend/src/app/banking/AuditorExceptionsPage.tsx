import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useAuditorDeskStore } from "../stores/auditorDeskStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function AuditorExceptionsPage({ displayName }: Props) {
  const config = getRoleDeskConfig("auditor");
  const [search, setSearch] = useState("");
  const {
    auditRows,
    pendingAccountant,
    pendingBank,
    loading,
    error,
    lastFetchedAt,
    hydrateExceptions,
    refreshExceptions,
    startLiveSync,
    stopLiveSync
  } = useAuditorDeskStore(
    useShallow((s) => ({
      auditRows: s.auditLogs,
      pendingAccountant: s.pendingAccountant,
      pendingBank: s.pendingBank,
      loading: s.exceptionsLoading,
      error: s.exceptionsError,
      lastFetchedAt: s.lastExceptionsAt,
      hydrateExceptions: s.hydrateExceptions,
      refreshExceptions: s.refreshExceptions,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateExceptions({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateExceptions, startLiveSync, stopLiveSync]);

  const exceptions = useMemo(
    () => auditRows.filter((row) => row.statusCode >= 400 || row.action.toLowerCase().includes("denied")),
    [auditRows]
  );

  const filtered = filterRowsBySearch(exceptions, search, [
    "action",
    "actorRole",
    "actorUserId",
    "path",
    "method"
  ]);

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={{ ...config, title: "Exception review", subtitle: "Failed API actions and open agency queues." }}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && auditRows.length === 0}
      onRefresh={() => void refreshExceptions()}
      refreshing={loading}
      kpis={[
        { label: "Failed / denied events", value: exceptions.length, tone: "warning" },
        { label: "Awaiting accountant", value: pendingAccountant, tone: "primary" },
        { label: "Pending at bank", value: pendingBank, tone: "success" }
      ]}
    >
      <section className="card role-workspace__panel">
        <h3>Queue exceptions</h3>
        <p className="muted">
          Large deposits over cap: {pendingAccountant}. Back office execution pending: {pendingBank}.
        </p>
      </section>

      <AdminDataTable
        variant="desk"
        title="Failed & denied actions"
        subtitle="API exceptions and policy denials from the audit trail."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search failed actions…"
        columns={[
          { key: "createdAt", label: "When" },
          { key: "action", label: "Action" },
          { key: "actorRole", label: "Role" },
          { key: "statusCode", label: "Status" },
          { key: "path", label: "Path" }
        ]}
        rows={filtered.map((row) => ({
          id: row.id,
          createdAt: new Date(row.createdAt).toLocaleString(),
          action: row.action,
          actorRole: row.actorRole ?? "—",
          statusCode: String(row.statusCode),
          path: row.path
        }))}
        rowKey={(row) => row.id}
        emptyMessage={loading ? "Loading…" : "No failed or denied audit events in the recent window."}
      />
    </RoleDeskShell>
  );
}
