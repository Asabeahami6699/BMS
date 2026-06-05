import { useMemo, useState } from "react";
import type { AppRole, Customer } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useGroupSavingsLiveSync } from "./hooks/useGroupSavingsLiveSync";
import { useGroupSavingsStore } from "./stores/groupSavingsStore";

type Props = { role: AppRole };

const STATUS_LABELS: Record<Customer["status"], string> = {
  pending_activation: "Pending",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  closed: "Closed"
};

const STATUS_PILL: Record<Customer["status"], string> = {
  pending_activation: "pending",
  active: "active",
  rejected: "inactive",
  suspended: "inactive",
  closed: "inactive"
};

function branchLabel(branchId: string, branches: { id: string; name: string; code: string }[]): string {
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}

export function GroupSavingsPage({ role: _role }: Props) {
  useGroupSavingsLiveSync();

  const members = useGroupSavingsStore((s) => s.members);
  const branches = useGroupSavingsStore((s) => s.branches);
  const totals = useGroupSavingsStore((s) => s.totals);
  const loading = useGroupSavingsStore((s) => s.loading);
  const error = useGroupSavingsStore((s) => s.error);
  const lastFetchedAt = useGroupSavingsStore((s) => s.lastFetchedAt);
  const branchFilter = useGroupSavingsStore((s) => s.branchFilter);
  const setBranchFilter = useGroupSavingsStore((s) => s.setBranchFilter);
  const refresh = useGroupSavingsStore((s) => s.refresh);

  const [search, setSearch] = useState("");
  const initialLoad = loading && lastFetchedAt == null;

  const filtered = useMemo(
    () =>
      filterRowsBySearch(members, search, [
        "fullName",
        "phone",
        "accountNumber",
        "assignedFieldAgentName"
      ] as (keyof Customer)[]),
    [members, search]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : "Loading…";

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Group savings</h2>
          <p className="muted">
            Group account members, daily plans, and status. {updatedLabel}
            {error ? ` · ${error}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "…" : "↻"}
        </button>
      </header>

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-value">{totals.totalMembers}</p>
          <span className="kpi-label">Group members</span>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-value">{totals.activeMembers}</p>
          <span className="kpi-label">Active</span>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-value">{totals.pendingMembers}</p>
          <span className="kpi-label">Pending approval</span>
        </article>
        <article className="kpi-card">
          <p className="kpi-value">GHS {totals.totalDailyPlan.toFixed(2)}</p>
          <span className="kpi-label">Combined daily plan</span>
        </article>
      </div>

      {branches.length > 0 ? (
        <label className="field agents-page__branch-filter">
          <span>Filter by branch</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="card agents-page__table-card">
        <AdminDataTable
          columns={[
            {
              key: "name",
              label: "Member",
              render: (row) => (
                <div>
                  <strong>{row.fullName}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    {row.phone}
                  </small>
                </div>
              )
            },
            {
              key: "account",
              label: "Account",
              render: (row) => row.accountNumber ?? <span className="muted">Pending</span>
            },
            { key: "branch", label: "Branch", render: (row) => branchLabel(row.homeBranchId, branches) },
            {
              key: "plan",
              label: "Daily plan",
              render: (row) =>
                row.dailyContributionAmount > 0
                  ? `GHS ${row.dailyContributionAmount.toFixed(2)}`
                  : "—"
            },
            {
              key: "balance",
              label: "Balance",
              render: (row) =>
                row.accountBalance != null ? (
                  `GHS ${Number(row.accountBalance).toFixed(2)}`
                ) : (
                  <span className="muted">—</span>
                )
            },
            {
              key: "agent",
              label: "Agent",
              render: (row) => row.assignedFieldAgentName ?? <span className="muted">—</span>
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${STATUS_PILL[row.status]}`}>
                  {STATUS_LABELS[row.status]}
                </span>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search name, phone, account, agent…"
          emptyMessage={
            initialLoad ? "Loading group members…" : "No group savings accounts yet."
          }
        />
      </section>
    </div>
  );
}
