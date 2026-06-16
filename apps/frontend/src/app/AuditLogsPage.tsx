import { useCallback, useEffect, useState } from "react";
import type { AuditLogRecord } from "./api";
import { listAuditLogs, getTenantId } from "./api";
import { subscribeToTenantRealtime } from "./realtime";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { usePageLoading } from "./hooks/usePageLoading";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusClass(code: number): string {
  if (code >= 500) {
    return "status-pill status-pill--inactive";
  }
  if (code >= 400) {
    return "status-pill status-pill--warning";
  }
  return "status-pill status-pill--active";
}

export function AuditLogsPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  usePageLoading(loading, "audit-logs");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAuditLogs({ limit: 200 }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load audit logs", "error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
    const unsub = subscribeToTenantRealtime({
      tenantId: getTenantId(),
      tables: ["audit_logs"],
      onChange: () => void load()
    });
    return unsub;
  }, [load]);

  const filtered = filterRowsBySearch(rows, search, [
    "action",
    "actorRole",
    "actorUserId",
    "branchId",
    "method",
    "path"
  ]);

  return (
    <div className="audit-logs-page">
      <header className="audit-logs-page__header">
        <div>
          <h2>Audit logs</h2>
          <p className="muted">
            Business activities performed in your workspace — who did what and when. Routine actions like marking
            notifications read are not logged.
          </p>
        </div>
        <button type="button" className="button secondary" disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="card agents-page__table-card">
        <AdminDataTable
          columns={[
            {
              key: "when",
              label: "When",
              render: (row) => formatWhen(row.createdAt)
            },
            {
              key: "actor",
              label: "Actor",
              render: (row) => (
                <div>
                  <span>{row.actorRole ?? "—"}</span>
                  {row.actorUserId ? (
                    <small className="muted" style={{ display: "block" }}>
                      {row.actorUserId}
                    </small>
                  ) : null}
                </div>
              )
            },
            {
              key: "activity",
              label: "Activity",
              render: (row) => (
                <div>
                  <strong>{row.action}</strong>
                  {row.statusCode >= 400 ? (
                    <small className="muted" style={{ display: "block" }}>
                      HTTP {row.statusCode}
                    </small>
                  ) : null}
                </div>
              )
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={statusClass(row.statusCode)}>{row.statusCode}</span>
              )
            },
            {
              key: "branch",
              label: "Branch",
              render: (row) => row.branchId ?? "—"
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search activity, actor, branch…"
          emptyMessage={loading ? "Loading audit logs…" : "No audit entries yet."}
        />
      </section>
    </div>
  );
}
