import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AuditLogRecord } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useBranchesLiveSync } from "./hooks/useBranchesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useAuditLogsStore } from "./stores/auditLogsStore";
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

type AuditCategory =
  | "all"
  | "withdrawals"
  | "reversals"
  | "till"
  | "profiles_roles"
  | "approvals";

const AUDIT_CATEGORY_CHIPS: Array<{ id: AuditCategory; label: string }> = [
  { id: "all", label: "All events" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "reversals", label: "Reversals" },
  { id: "till", label: "Till & Cash" },
  { id: "profiles_roles", label: "Profiles & Roles" },
  { id: "approvals", label: "Approvals" }
];

function matchesAuditCategory(row: AuditRow, cat: AuditCategory): boolean {
  if (cat === "all") return true;
  const hay = `${row.action} ${row.path}`.toLowerCase();
  if (cat === "withdrawals") return /withdraw|payout|momo/.test(hay);
  if (cat === "reversals") return /revers/.test(hay);
  if (cat === "till") return /float|till|closing|variance|overage|shortage|capital/.test(hay);
  if (cat === "profiles_roles") return /profile|role|permission|user|password|commission/.test(hay);
  if (cat === "approvals") return /approv|reject|callover|batch|registration/.test(hay);
  return true;
}

function escapeCsvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadAuditLogsCsv(rows: AuditRow[]): void {
  const header = ["Timestamp", "Action", "Method", "Path", "Status", "Actor Role", "Actor ID", "Branch"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.createdAt,
        r.action,
        r.method,
        r.path,
        formatStatus(r.statusCode),
        r.actorRole,
        r.actorUserId,
        r.branchLabel
      ]
        .map(escapeCsvCell)
        .join(",")
    )
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditLogsPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<AuditCategory>("all");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);

  const { rows, loading, error, lastFetchedAt, hydrate, startLiveSync, stopLiveSync } = useAuditLogsStore(
    useShallow((s) => ({
      rows: s.rows,
      loading: s.loading,
      error: s.error,
      lastFetchedAt: s.lastFetchedAt,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const labeled = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        branchLabel: formatBranchLabel(row.branchId, branches)
      })),
    [rows, branches]
  );

  const categoryFiltered = useMemo(
    () => labeled.filter((row) => matchesAuditCategory(row, category)),
    [labeled, category]
  );

  const filtered = filterRowsBySearch(categoryFiltered, search, [
    "action",
    "actorRole",
    "actorUserId",
    "branchLabel",
    "method",
    "path"
  ]);

  const showLoading = loading && lastFetchedAt == null;

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
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button secondary"
            disabled={filtered.length === 0}
            onClick={() => {
              downloadAuditLogsCsv(filtered);
              showToast(`Exported ${filtered.length} audit log row(s) to CSV`, "success");
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => useAuditLogsStore.getState().hydrate({ force: true })}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="audit-filter-chips" role="group" aria-label="Quick audit category filters">
        {AUDIT_CATEGORY_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`statements-filter-pill${
              category === chip.id ? " statements-filter-pill--active" : ""
            }`}
            onClick={() => setCategory(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

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
          emptyMessage={showLoading ? "Loading audit logs…" : "No audit entries yet."}
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
