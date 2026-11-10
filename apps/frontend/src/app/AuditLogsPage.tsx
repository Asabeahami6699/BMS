import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLogRecord } from "./api";
import { listAuditLogs, getTenantId } from "./api";
import { subscribeToTenantRealtime } from "./realtime";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { usePageLoading } from "./hooks/usePageLoading";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { formatBranchLabel } from "./branchDisplay";

type AuditRow = AuditLogRecord & { branchLabel: string };

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusMeaning(code: number): string {
  if (code === 200) return "Success";
  if (code === 201) return "Created";
  if (code === 202) return "Accepted";
  if (code === 204) return "No content";
  if (code === 400) return "Bad request";
  if (code === 401) return "Unauthorized";
  if (code === 403) return "Forbidden";
  if (code === 404) return "Not found";
  if (code === 409) return "Conflict";
  if (code === 422) return "Unprocessable";
  if (code === 429) return "Too many requests";
  if (code >= 500) return "Server error";
  if (code >= 400) return "Client error";
  if (code >= 300) return "Redirect";
  if (code >= 200) return "Success";
  return "Unknown";
}

function formatStatus(code: number): string {
  return `${code} (${statusMeaning(code)})`;
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
  const [selected, setSelected] = useState<AuditRow | null>(null);
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);

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

  const labeled = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        branchLabel: formatBranchLabel(row.branchId, branches)
      })),
    [rows, branches]
  );

  const filtered = filterRowsBySearch(labeled, search, [
    "action",
    "actorRole",
    "actorUserId",
    "branchLabel",
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
            notifications read are not logged. Click a row for full details.
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
              render: (row) => <strong>{row.action}</strong>
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={statusClass(row.statusCode)}>{formatStatus(row.statusCode)}</span>
              )
            },
            {
              key: "branch",
              label: "Branch",
              render: (row) => row.branchLabel
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search activity, actor, branch…"
          emptyMessage={loading ? "Loading audit logs…" : "No audit entries yet."}
          onRowClick={(row) => setSelected(row)}
        />
      </section>

      <Modal
        open={selected !== null}
        title="Audit log details"
        subtitle={selected ? formatWhen(selected.createdAt) : undefined}
        onClose={() => setSelected(null)}
        panelClassName="modal-panel--audit-detail"
        footer={
          <button type="button" className="button secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected ? (
          <dl className="audit-log-detail">
            <div>
              <dt>Activity</dt>
              <dd>{selected.action}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={statusClass(selected.statusCode)}>
                  {formatStatus(selected.statusCode)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Actor role</dt>
              <dd>{selected.actorRole ?? "—"}</dd>
            </div>
            <div>
              <dt>Actor user</dt>
              <dd className="audit-log-detail__mono">{selected.actorUserId ?? "—"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{selected.branchLabel}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{selected.method || "—"}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd className="audit-log-detail__mono audit-logs-page__path">{selected.path || "—"}</dd>
            </div>
            <div>
              <dt>IP address</dt>
              <dd className="audit-log-detail__mono">{selected.ipAddress ?? "—"}</dd>
            </div>
            <div>
              <dt>Log ID</dt>
              <dd className="audit-log-detail__mono">{selected.id}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{formatWhen(selected.createdAt)}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
