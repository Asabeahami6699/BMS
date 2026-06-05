import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, BalanceDisclosure } from "./api";
import { approveBalanceDisclosure, rejectBalanceDisclosure } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { DeclineRequestModal } from "./DeclineRequestModal";
import { useWithdrawalsLiveSync } from "./hooks/useWithdrawalsLiveSync";
import { selectWithdrawalKpis, useWithdrawalsStore } from "./stores/withdrawalsStore";
import { WithdrawalMomoApproveModal } from "./WithdrawalMomoApproveModal";

type Props = { role: AppRole };

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") {
    return "MoMo";
  }
  if (mode === "agent_next_day") {
    return "Agent cash";
  }
  return "Cash next day";
}

function statusPillClass(status: BalanceDisclosure["status"]): string {
  if (status === "approved") {
    return "active";
  }
  if (status === "rejected") {
    return "inactive";
  }
  return "pending";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export function WithdrawalsPage({ role }: Props) {
  useWithdrawalsLiveSync();
  const { showToast } = useToast();
  const canApprove = role === "admin" || role === "coordinator";

  const withdrawals = useWithdrawalsStore((s) => s.withdrawals);
  const branches = useWithdrawalsStore((s) => s.branches);
  const loading = useWithdrawalsStore((s) => s.loading);
  const error = useWithdrawalsStore((s) => s.error);
  const lastFetchedAt = useWithdrawalsStore((s) => s.lastFetchedAt);
  const branchFilter = useWithdrawalsStore((s) => s.branchFilter);
  const setBranchFilter = useWithdrawalsStore((s) => s.setBranchFilter);
  const refresh = useWithdrawalsStore((s) => s.refresh);
  const refreshSilent = useWithdrawalsStore((s) => s.refreshSilent);
  const patchWithdrawal = useWithdrawalsStore((s) => s.patchWithdrawal);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BalanceDisclosure["status"]>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [momoRequest, setMomoRequest] = useState<BalanceDisclosure | null>(null);
  const [declineTarget, setDeclineTarget] = useState<BalanceDisclosure | null>(null);

  const initialLoad = loading && lastFetchedAt == null;
  const kpis = useMemo(() => selectWithdrawalKpis(withdrawals), [withdrawals]);

  const filtered = useMemo(() => {
    let list = withdrawals;
    if (statusFilter) {
      list = list.filter((r) => r.status === statusFilter);
    }
    return filterRowsBySearch(list, search, [
      "customerName",
      "fieldAgentName",
      "requestReason",
      "momoNumber",
      "momoAccountName"
    ] as (keyof BalanceDisclosure)[]);
  }, [withdrawals, search, statusFilter]);

  async function handleApproveCash(row: BalanceDisclosure) {
    setBusyId(row.id);
    try {
      const approved = await approveBalanceDisclosure(row.id);
      patchWithdrawal(approved);
      showToast(
        `Withdrawal approved — ${approved.customerName ?? "Customer"}: GHS ${approved.withdrawalAmount?.toFixed(2) ?? "—"}`,
        "success"
      );
      await refreshSilent();
    } catch (err) {
      showToast(toUserFacingError(err, "Approve failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleApprove(row: BalanceDisclosure) {
    if (row.fulfillmentMode === "momo") {
      setMomoRequest(row);
      return;
    }
    void handleApproveCash(row);
  }

  async function handleDeclineConfirm(reason: string | undefined) {
    if (!declineTarget) {
      return;
    }
    setBusyId(declineTarget.id);
    try {
      const rejected = await rejectBalanceDisclosure(declineTarget.id, reason);
      patchWithdrawal(rejected);
      showToast("Withdrawal declined", "success");
      setDeclineTarget(null);
      await refreshSilent();
    } catch (err) {
      showToast(toUserFacingError(err, "Decline failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : "Loading…";

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Withdrawals</h2>
          <p className="muted">
            Agent requests → coordinator approval → payout. {updatedLabel}
            {error ? ` · ${error}` : ""}
          </p>
        </div>
        <div className="agents-page__header-actions">
          {canApprove ? (
            <Link to="/app/susu/pending-approvals" className="button secondary">
              Pending approvals
            </Link>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      </header>

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-value">{kpis.pending}</p>
          <span className="kpi-label">Pending</span>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-value">{kpis.approved}</p>
          <span className="kpi-label">Approved</span>
        </article>
        <article className="kpi-card">
          <p className="kpi-value">{kpis.rejected}</p>
          <span className="kpi-label">Rejected</span>
        </article>
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-value">GHS {kpis.pendingAmount.toFixed(2)}</p>
          <span className="kpi-label">Pending amount</span>
        </article>
      </div>

      <div className="agents-page__filters">
        {branches.length > 0 ? (
          <label className="field agents-page__branch-filter">
            <span>Branch</span>
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
        <label className="field agents-page__branch-filter">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      <section className="card agents-page__table-card">
        <AdminDataTable
          columns={[
            {
              key: "customer",
              label: "Customer",
              render: (row) => (
                <div>
                  <strong>{row.customerName ?? "—"}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    {formatDate(row.requestedAt)}
                  </small>
                </div>
              )
            },
            {
              key: "agent",
              label: "Agent",
              render: (row) => row.fieldAgentName ?? <span className="muted">—</span>
            },
            {
              key: "amount",
              label: "Amount",
              render: (row) => (
                <strong>GHS {(row.withdrawalAmount ?? 0).toFixed(2)}</strong>
              )
            },
            {
              key: "fulfillment",
              label: "Fulfillment",
              render: (row) => fulfillmentLabel(row.fulfillmentMode)
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${statusPillClass(row.status)}`}>
                  {row.status}
                </span>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search customer, agent, MoMo…"
          emptyMessage={
            initialLoad ? "Loading withdrawals…" : "No withdrawal requests match your filters."
          }
          actions={(row) =>
            canApprove && row.status === "pending" ? (
              <div className="platform-actions-buttons">
                <button
                  type="button"
                  className="button"
                  disabled={busyId === row.id}
                  onClick={() => handleApprove(row)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busyId === row.id}
                  onClick={() => setDeclineTarget(row)}
                >
                  Decline
                </button>
              </div>
            ) : null
          }
        />
      </section>

      <WithdrawalMomoApproveModal
        open={momoRequest !== null}
        request={momoRequest}
        onClose={() => setMomoRequest(null)}
        onApproved={() => {
          void refreshSilent();
          setMomoRequest(null);
        }}
      />

      <DeclineRequestModal
        open={declineTarget !== null}
        customerName={declineTarget?.customerName}
        submitting={busyId === declineTarget?.id}
        onClose={() => setDeclineTarget(null)}
        onConfirm={handleDeclineConfirm}
      />
    </div>
  );
}
