import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, BalanceDisclosure, FieldWithdrawalFulfillmentRow } from "./api";
import {
  approveBalanceDisclosure,
  listFieldWithdrawalFulfillment,
  rejectBalanceDisclosure
} from "./api";
import { bankProductDisplayLabel,
  bankProductsForSubscription,
  DEFAULT_APPROVAL_WORKFLOW,
  isManualPartnerWithdrawal,
  roleMayApprove,
  workflowFieldsForStage, formatAccountAmount } from "@bms/shared";
import { useAuth } from "../auth/AuthContext";
import { DynamicWorkflowForm } from "./banking/DynamicWorkflowForm";
import { prefillWithdrawalVerificationData } from "./banking/workflowPrefill";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { DeclineRequestModal } from "./DeclineRequestModal";
import { useWithdrawalsLiveSync } from "./hooks/useWithdrawalsLiveSync";
import { useBankProductsStore } from "./stores/bankProductsStore";
import { selectWithdrawalKpis, useWithdrawalsStore } from "./stores/withdrawalsStore";

type Props = {
  role: AppRole;
  permissions?: import("@bms/shared").Permission[];
  /** When embedded under agency banking, hide Susu-specific chrome. */
  variant?: "susu" | "agency";
};

function statusLabel(row: BalanceDisclosure): string {
  if (row.fulfillmentMode === "momo" && row.status === "completed") {
    return "Paid (MoMo)";
  }
  if (row.agentDeliveredAt) {
    return "Agent delivered";
  }
  if (row.status === "cs_approved") {
    return "Awaiting Pay now";
  }
  if (row.status === "bank_executed") {
    return "Bank debited";
  }
  if (row.status === "completed") {
    return "Paid out — await delivery";
  }
  return row.status.replace(/_/g, " ");
}

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") {
    return "MoMo";
  }
  if (mode === "agent_next_day" || mode === "next_day_cash") {
    return "Cash · agent next visit";
  }
  return "Cash";
}

function statusPillClass(row: BalanceDisclosure): string {
  if (row.agentDeliveredAt || row.status === "approved") {
    return "active";
  }
  if (row.status === "rejected") {
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

function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString("en-CA");
}

function todayLocalDateKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

function formatDateRangeLabel(from: string, to: string): string {
  if (!from && !to) {
    return "";
  }
  const start = from || to;
  const end = to || from;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  if (lo === hi) {
    return fmt(lo);
  }
  return `${fmt(lo)} – ${fmt(hi)}`;
}

function matchesDateRange(iso: string, from: string, to: string): boolean {
  if (!from && !to) {
    return true;
  }
  const key = toLocalDateKey(iso);
  if (!key) {
    return false;
  }
  const start = from || to;
  const end = to || from;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return key >= lo && key <= hi;
}

export function WithdrawalsPage({ role, variant = "susu" }: Props) {
  const isAgency = variant === "agency";
  useWithdrawalsLiveSync();
  const { showToast } = useToast();
  const { user } = useAuth();
  const canApprove = roleMayApprove(user?.approvalWorkflow ?? DEFAULT_APPROVAL_WORKFLOW, "withdrawal", role);

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
  const [declineTarget, setDeclineTarget] = useState<BalanceDisclosure | null>(null);
  const bankProducts = useBankProductsStore((s) => s.products);
  const hydrateBankProducts = useBankProductsStore((s) => s.hydrate);
  const withdrawalProducts = useMemo(
    () => bankProductsForSubscription(bankProducts, user?.subscribedModules, "withdrawal"),
    [bankProducts, user?.subscribedModules]
  );
  const [bankProductByRequest, setBankProductByRequest] = useState<Record<string, string>>({});
  const [workflowDataByRequest, setWorkflowDataByRequest] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [fulfillmentDate, setFulfillmentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fulfillmentRows, setFulfillmentRows] = useState<FieldWithdrawalFulfillmentRow[]>([]);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() =>
    variant === "agency" ? todayLocalDateKey() : ""
  );
  const [dateTo, setDateTo] = useState(() =>
    variant === "agency" ? todayLocalDateKey() : ""
  );

  useEffect(() => {
    hydrateBankProducts();
  }, [hydrateBankProducts]);

  useEffect(() => {
    if (isAgency) {
      return;
    }
    setFulfillmentLoading(true);
    void listFieldWithdrawalFulfillment({
      date: fulfillmentDate,
      branchId: branchFilter || undefined
    })
      .then(setFulfillmentRows)
      .catch(() => setFulfillmentRows([]))
      .finally(() => setFulfillmentLoading(false));
  }, [isAgency, fulfillmentDate, branchFilter, lastFetchedAt]);

  const initialLoad = loading && lastFetchedAt == null;

  const dateScopedWithdrawals = useMemo(() => {
    if (!isAgency) {
      return withdrawals;
    }
    return withdrawals.filter((row) => matchesDateRange(row.requestedAt, dateFrom, dateTo));
  }, [withdrawals, dateFrom, dateTo, isAgency]);

  const kpis = useMemo(() => selectWithdrawalKpis(dateScopedWithdrawals), [dateScopedWithdrawals]);

  const filtered = useMemo(() => {
    let list = dateScopedWithdrawals;
    // Susu/agency withdrawals desk: field-agent cash is coordinator → teller, not CS.
    if (isAgency || user?.role === "customer_service") {
      list = list.filter(
        (r) => !(r.isFieldAgentRequest && r.fulfillmentMode !== "momo" && r.status === "pending")
      );
    }
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
  }, [dateScopedWithdrawals, search, statusFilter, isAgency, user?.role]);

  function handleApprove(row: BalanceDisclosure) {
    void handleCashApprove(row);
  }

  async function handleCashApprove(row: BalanceDisclosure) {
    setBusyId(row.id);
    try {
      const isMomo = row.fulfillmentMode === "momo";
      const bankProductId = isMomo
        ? undefined
        : bankProductByRequest[row.id] ?? withdrawalProducts[0]?.id;
      const approved = await approveBalanceDisclosure(row.id, {
        ...(bankProductId ? { bankProductId } : {}),
        ...(isMomo ? {} : { workflowData: workflowDataByRequest[row.id] })
      });
      patchWithdrawal(approved);
      showToast(
        isMomo
          ? "MoMo withdrawal approved — teller may Pay now"
          : "Withdrawal verified — teller may pay cash",
        "success"
      );
      await refreshSilent();
    } catch (err) {
      showToast(toUserFacingError(err, "Approval failed"), "error");
    } finally {
      setBusyId(null);
    }
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
    <div className={`agents-page${isAgency ? " agents-page--agency-embedded" : ""}`}>
      {!isAgency ? (
        <header className="agents-page__header">
          <div>
            <h2>Withdrawals</h2>
            <p className="muted">
              Agent requests → coordinator/CS approves (call registration phone) → teller Pay now.
              Cash debits only when paid. {updatedLabel}
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
      ) : (
        <p className="muted agency-withdrawals-meta">
          {updatedLabel}
          {error ? ` · ${error}` : ""}
        </p>
      )}

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
          <p className="kpi-value">GHS {formatAccountAmount(kpis.pendingAmount)}</p>
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
        {isAgency ? (
          <label className="field agents-page__branch-filter">
            <span>From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
        ) : null}
        {isAgency ? (
          <label className="field agents-page__branch-filter">
            <span>To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        ) : null}
        {isAgency ? (
          <div className="agents-page__date-presets">
            <button
              type="button"
              className={`button secondary${
                dateFrom === todayLocalDateKey() && dateTo === todayLocalDateKey() ? " is-active" : ""
              }`}
              onClick={() => {
                const today = todayLocalDateKey();
                setDateFrom(today);
                setDateTo(today);
              }}
            >
              Today
            </button>
            <button
              type="button"
              className={`button secondary${!dateFrom && !dateTo ? " is-active" : ""}`}
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              All dates
            </button>
          </div>
        ) : null}
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
                  {row.customerPhone ? (
                    <small style={{ display: "block" }}>
                      <a href={`tel:${row.customerPhone}`}>{row.customerPhone}</a>
                    </small>
                  ) : null}
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
                <strong>GHS {formatAccountAmount((row.withdrawalAmount ?? 0))}</strong>
              )
            },
            {
              key: "fulfillment",
              label: "Fulfillment & details",
              render: (row) => (
                <div className="withdrawal-gate-details">
                  <strong>{fulfillmentLabel(row.fulfillmentMode)}</strong>
                  {row.fulfillmentMode === "momo" || row.momoNumber || row.momoAccountName ? (
                    <small className="withdrawal-gate-details__momo">
                      MoMo: {row.momoAccountName || "—"} · {row.momoNumber || "—"}
                    </small>
                  ) : null}
                  {row.requestReason ? (
                    <small className="muted withdrawal-gate-details__reason">
                      Reason: {row.requestReason}
                    </small>
                  ) : null}
                  {row.payoutReference ? (
                    <small className="muted withdrawal-gate-details__ref">
                      Ref: {row.payoutReference}
                    </small>
                  ) : null}
                </div>
              )
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${statusPillClass(row)}`}>
                  {statusLabel(row)}
                </span>
              )
            },
            {
              key: "delivery",
              label: "Delivery",
              render: (row) =>
                row.agentDeliveredAt ? (
                  <span className="muted">{formatDate(row.agentDeliveredAt)}</span>
                ) : row.status === "completed" && row.fulfillmentMode !== "momo" ? (
                  <span className="status-pill status-pill--pending">Awaiting agent</span>
                ) : (
                  <span className="muted">—</span>
                )
            },
            ...(withdrawalProducts.length > 0
              ? [
                  {
                    key: "bankProduct",
                    label: "Bank product",
                    render: (row: BalanceDisclosure) =>
                      row.status === "pending" && row.fulfillmentMode !== "momo" ? (
                        <select
                          value={bankProductByRequest[row.id] ?? withdrawalProducts[0]?.id ?? ""}
                          disabled={busyId === row.id}
                          onChange={(e) =>
                            setBankProductByRequest((prev) => ({
                              ...prev,
                              [row.id]: e.target.value
                            }))
                          }
                        >
                          {withdrawalProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {bankProductDisplayLabel(product)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">—</span>
                      )
                  }
                ]
              : [])
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search customer, agent, MoMo…"
          emptyMessage={
            initialLoad
              ? "Loading withdrawals…"
              : isAgency && (dateFrom || dateTo)
                ? `No withdrawal requests for ${formatDateRangeLabel(dateFrom, dateTo)}.`
                : "No withdrawal requests match your filters."
          }
          actions={(row) => {
            if (!canApprove || row.status !== "pending" || isManualPartnerWithdrawal(row)) {
              return null;
            }
            const productId = bankProductByRequest[row.id] ?? withdrawalProducts[0]?.id;
            const product = withdrawalProducts.find((p) => p.id === productId);
            const verificationFields = product
              ? workflowFieldsForStage(product, "verification")
              : [];
            const isOpen = expandedRequestId === row.id;

            const showVerificationToggle = row.fulfillmentMode !== "momo";

            return (
              <div className="withdrawal-verify-panel">
                {showVerificationToggle ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      if (isOpen) {
                        setExpandedRequestId(null);
                        return;
                      }
                      setExpandedRequestId(row.id);
                      setWorkflowDataByRequest((prev) => ({
                        ...prev,
                        [row.id]: prefillWithdrawalVerificationData(row, prev[row.id])
                      }));
                    }}
                  >
                    {isOpen ? "Hide details" : "Verification details"}
                  </button>
                ) : null}
                {showVerificationToggle && isOpen ? (
                  <div className="withdrawal-queue-card__details">
                    {row.requestReason ? (
                      <p className="muted">Reason: {row.requestReason}</p>
                    ) : null}
                    {verificationFields.length > 0 ? (
                      <DynamicWorkflowForm
                        fields={verificationFields}
                        values={workflowDataByRequest[row.id] ?? {}}
                        disabled={busyId === row.id}
                        onChange={(key, value) =>
                          setWorkflowDataByRequest((prev) => ({
                            ...prev,
                            [row.id]: { ...(prev[row.id] ?? {}), [key]: value }
                          }))
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
                <div className="platform-actions-buttons">
                  <button
                    type="button"
                    className="button"
                    disabled={busyId === row.id}
                    onClick={() => handleApprove(row)}
                  >
                    {row.fulfillmentMode === "momo" ? "Approve" : "Verify"}
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
              </div>
            );
          }}
        />
      </section>

      <DeclineRequestModal
        open={declineTarget !== null}
        customerName={declineTarget?.customerName}
        submitting={busyId === declineTarget?.id}
        onClose={() => setDeclineTarget(null)}
        onConfirm={handleDeclineConfirm}
      />

      {!isAgency ? (
        <section className="card agents-page__table-card withdrawal-fulfillment-card">
          <header className="withdrawal-fulfillment-card__head">
            <div>
              <h3>Field agent daily withdrawal fulfillment</h3>
              <p className="muted">
                Tracks requests, office payouts, and when the field agent confirms cash was delivered
                to the customer.
              </p>
            </div>
            <label className="field agents-page__branch-filter">
              <span>Date</span>
              <input
                type="date"
                value={fulfillmentDate}
                onChange={(e) => setFulfillmentDate(e.target.value)}
              />
            </label>
          </header>

          {fulfillmentLoading ? (
            <p className="muted">Loading fulfillment…</p>
          ) : fulfillmentRows.length === 0 ? (
            <p className="muted">No field agent withdrawal activity for this date.</p>
          ) : (
            <div className="withdrawal-fulfillment-table-wrap">
              <table className="admin-table withdrawal-fulfillment-table">
                <thead>
                  <tr>
                    <th>Field agent</th>
                    <th>Date</th>
                    <th>Requested</th>
                    <th>Approved</th>
                    <th>Fulfilled (debited)</th>
                    <th>Delivered</th>
                    <th>Customers</th>
                  </tr>
                </thead>
                <tbody>
                  {fulfillmentRows.map((row) => (
                    <tr key={`${row.fieldAgentId}-${row.businessDate}`}>
                      <td>
                        <strong>{row.fieldAgentName}</strong>
                      </td>
                      <td>{row.businessDate}</td>
                      <td>GHS {formatAccountAmount(row.totalRequested)}</td>
                      <td>GHS {formatAccountAmount(row.totalApproved)}</td>
                      <td>
                        <strong>GHS {formatAccountAmount(row.totalFulfilled)}</strong>
                      </td>
                      <td>GHS {formatAccountAmount(row.totalDelivered ?? 0)}</td>
                      <td>{row.customerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {fulfillmentRows.some((row) => row.lines.length > 0) ? (
                <details className="withdrawal-fulfillment-details">
                  <summary>Customer-level fulfillment lines</summary>
                  <table className="admin-table withdrawal-fulfillment-lines">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Fulfilled at</th>
                        <th>Delivered at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fulfillmentRows.flatMap((row) =>
                        row.lines.map((line) => (
                          <tr key={`${row.fieldAgentId}-${line.disclosureId ?? line.transactionId}`}>
                            <td>{row.fieldAgentName}</td>
                            <td>{line.customerName ?? line.customerId}</td>
                            <td>GHS {formatAccountAmount(line.amount)}</td>
                            <td>{line.status.replace(/_/g, " ")}</td>
                            <td>{formatDate(line.fulfilledAt)}</td>
                            <td>
                              {line.agentDeliveredAt ? formatDate(line.agentDeliveredAt) : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
