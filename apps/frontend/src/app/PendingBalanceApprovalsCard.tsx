import { useState } from "react";
import { DEFAULT_APPROVAL_WORKFLOW, formatAccountAmount, formatGhs, roleMayApprove } from "@bms/shared";
import { useAuth } from "../auth/AuthContext";
import type { BalanceDisclosure } from "./api";
import { approveBalanceDisclosure, rejectBalanceDisclosure } from "./api";
import { BalanceApproveModal } from "./BalanceApproveModal";
import { DeclineRequestModal } from "./DeclineRequestModal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import { useCoordinatorStore } from "./stores/coordinatorStore";

function requestTypeLabel(type: BalanceDisclosure["requestType"]): string {
  return type === "withdrawal" ? "Withdrawal" : "Balance";
}

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") {
    return "MoMo (instant)";
  }
  if (mode === "agent_next_day" || mode === "next_day_cash") {
    return "Cash · agent delivers next visit";
  }
  return "Cash";
}

export function PendingBalanceApprovalsCard() {
  const { user } = useAuth();
  const workflow = user?.approvalWorkflow ?? DEFAULT_APPROVAL_WORKFLOW;
  const canApproveWithdrawal = roleMayApprove(workflow, "withdrawal", user?.role ?? "");
  const canReviewBalance = user?.role === "admin" || user?.role === "coordinator";
  useCoordinatorLiveSync();
  const { showToast } = useToast();
  const pending = useCoordinatorStore((s) => s.pendingRequests);
  const loading = useCoordinatorStore((s) => s.loading);
  const refresh = useCoordinatorStore((s) => s.refresh);
  const refreshSilent = useCoordinatorStore((s) => s.refreshSilent);
  const removePendingRequest = useCoordinatorStore((s) => s.removePendingRequest);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [balanceApproveTarget, setBalanceApproveTarget] = useState<BalanceDisclosure | null>(null);
  const [declineTarget, setDeclineTarget] = useState<BalanceDisclosure | null>(null);
  const visible = pending.filter((row) => {
    if (row.requestType === "withdrawal") {
      if (!canApproveWithdrawal) {
        return false;
      }
      // Field-agent cash: coordinator/admin only — CS uses agency walk-in desk instead.
      if (
        row.fulfillmentMode !== "momo" &&
        row.isFieldAgentRequest &&
        user?.role === "customer_service"
      ) {
        return false;
      }
      return true;
    }
    return canReviewBalance;
  });
  if (!canApproveWithdrawal && !canReviewBalance) {
    return null;
  }

  async function handleApproveCash(row: BalanceDisclosure, visibleHours?: number) {
    setBusyId(row.id);
    try {
      const approved = await approveBalanceDisclosure(
        row.id,
        row.requestType === "balance" ? { visibleHours } : undefined
      );
      removePendingRequest(row.id);
      if (approved.requestType === "withdrawal") {
        showToast(
          `Approved — teller Pay now next. Call ${approved.customerPhone ?? "customer"} if not already verified. ${approved.customerName ?? "Customer"}: ${approved.withdrawalAmount != null ? formatGhs(approved.withdrawalAmount) : "—"}`,
          "success"
        );
      } else {
        showToast(
          `Balance approved — ${approved.customerName ?? "Customer"}: ${approved.balanceAmount != null ? formatGhs(approved.balanceAmount) : "—"}`,
          "success"
        );
      }
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Approve failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleApprove(row: BalanceDisclosure) {
    if (row.requestType === "balance") {
      setBalanceApproveTarget(row);
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
      await rejectBalanceDisclosure(declineTarget.id, reason);
      removePendingRequest(declineTarget.id);
      showToast("Request declined — agent will be notified", "success");
      setDeclineTarget(null);
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Decline failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <article className="card">
        <div className="platform-actions-buttons" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>Pending withdrawals &amp; balance requests</h2>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
            title="Refresh pending requests"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        <p className="muted">
          Field-agent withdrawals (cash &amp; MoMo): call the customer on their registration phone,
          then approve. That queues teller Pay now, which debits the customer account and till.
        </p>
        {loading && visible.length === 0 ? <p className="muted">Loading…</p> : null}
        <div className="lines">
          {visible.length === 0 && !loading ? (
            <p className="muted">
              {pending.length > 0 ? "No requests waiting for your role." : "No pending requests."}
            </p>
          ) : (
            visible.map((row) => (
              <div className="line tenant-line" key={row.id}>
                <div>
                  <strong>
                    {row.customerName ?? row.customerId}{" "}
                    <span
                      className={`status-pill status-pill--${row.requestType === "withdrawal" ? "pending" : "active"}`}
                    >
                      {requestTypeLabel(row.requestType)}
                    </span>
                  </strong>
                  <small>
                    Agent: {row.fieldAgentName ?? row.fieldAgentId} ·{" "}
                    {new Date(row.requestedAt).toLocaleString()}
                  </small>
                  {row.requestType === "withdrawal" ? (
                    <>
                      <small>
                        {row.withdrawalAmount != null
                          ? `GHS ${formatAccountAmount(row.withdrawalAmount)}`
                          : "—"}{" "}
                        · {fulfillmentLabel(row.fulfillmentMode)}
                      </small>
                      {row.customerPhone ? (
                        <small>
                          Call customer before approve:{" "}
                          <a href={`tel:${row.customerPhone}`}>{row.customerPhone}</a>
                          <span className="muted"> (registration phone)</span>
                        </small>
                      ) : (
                        <small className="muted">No registration phone on file — verify carefully.</small>
                      )}
                      {row.fulfillmentMode === "momo" ? (
                        <small>
                          MoMo: {row.momoAccountName} · {row.momoNumber}
                        </small>
                      ) : null}
                    </>
                  ) : null}
                  {row.requestReason ? <small>Reason: {row.requestReason}</small> : null}
                </div>
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
              </div>
            ))
          )}
        </div>
      </article>

      <DeclineRequestModal
        open={declineTarget !== null}
        customerName={declineTarget?.customerName}
        submitting={busyId === declineTarget?.id}
        onClose={() => setDeclineTarget(null)}
        onConfirm={(reason) => void handleDeclineConfirm(reason)}
      />

      <BalanceApproveModal
        open={balanceApproveTarget !== null}
        request={balanceApproveTarget}
        submitting={busyId === balanceApproveTarget?.id}
        onClose={() => setBalanceApproveTarget(null)}
        onConfirm={(visibleHours) => {
          if (balanceApproveTarget) {
            void handleApproveCash(balanceApproveTarget, visibleHours).then(() =>
              setBalanceApproveTarget(null)
            );
          }
        }}
      />
    </>
  );
}
