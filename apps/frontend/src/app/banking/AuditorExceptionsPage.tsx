import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLogRecord } from "../api";
import { getBackOfficeBootstrap, listAuditLogs } from "../api";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function AuditorExceptionsPage({ displayName }: Props) {
  const config = getRoleDeskConfig("auditor");
  const { showToast } = useToast();
  const [auditRows, setAuditRows] = useState<AuditLogRecord[]>([]);
  const [pendingAccountant, setPendingAccountant] = useState(0);
  const [pendingBank, setPendingBank] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [logs, bootstrap] = await Promise.all([
        listAuditLogs({ limit: 200 }),
        getBackOfficeBootstrap({ branchId: "all" })
      ]);
      setAuditRows(logs);
      setPendingAccountant(bootstrap.pendingAccountantCount ?? 0);
      setPendingBank(
        bootstrap.depositQueue?.filter((d) => d.executionStatus === "pending_bank").length ?? 0
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load exceptions", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

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
  ] as (keyof AuditLogRecord)[]);

  return (
    <RoleDeskShell
      config={{ ...config, title: "Exception review", subtitle: "Failed API actions and open agency queues." }}
      displayName={displayName}
      loading={loading}
      onRefresh={() => void load()}
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
