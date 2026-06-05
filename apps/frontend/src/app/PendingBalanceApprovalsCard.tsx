import { useState } from "react";
import type { BalanceDisclosure } from "./api";
import { approveBalanceDisclosure, rejectBalanceDisclosure } from "./api";
import { BalanceApproveModal } from "./BalanceApproveModal";
import { DeclineRequestModal } from "./DeclineRequestModal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { WithdrawalMomoApproveModal } from "./WithdrawalMomoApproveModal";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import { useCoordinatorStore } from "./stores/coordinatorStore";

function requestTypeLabel(type: BalanceDisclosure["requestType"]): string {
  return type === "withdrawal" ? "Withdrawal" : "Balance";
}

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") {
    return "MoMo (instant)";
  }
  if (mode === "agent_next_day") {
    return "Agent brings cash";
  }
  return "Cash next day";
}

export function PendingBalanceApprovalsCard() {
  useCoordinatorLiveSync();
  const { showToast } = useToast();
  const pending = useCoordinatorStore((s) => s.pendingRequests);
  const loading = useCoordinatorStore((s) => s.loading);
  const refreshSilent = useCoordinatorStore((s) => s.refreshSilent);
  const removePendingRequest = useCoordinatorStore((s) => s.removePendingRequest);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [momoRequest, setMomoRequest] = useState<BalanceDisclosure | null>(null);
  const [balanceApproveTarget, setBalanceApproveTarget] = useState<BalanceDisclosure | null>(null);
  const [declineTarget, setDeclineTarget] = useState<BalanceDisclosure | null>(null);

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
          `Withdrawal approved — ${approved.customerName ?? "Customer"}: GHS ${approved.withdrawalAmount?.toFixed(2) ?? "—"} (${fulfillmentLabel(approved.fulfillmentMode)})`,
          "success"
        );
      } else {
        showToast(
          `Balance approved — ${approved.customerName ?? "Customer"}: GHS ${approved.balanceAmount?.toFixed(2) ?? "—"}`,
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
        <h2>Agent requests (balance & withdrawal)</h2>
        <p className="muted">
          Approve balance requests (set how long the agent can view the balance) or withdrawals. For MoMo,
          upload the transaction
          screenshot — a receipt is sent to the agent&apos;s alerts.
        </p>
        {loading && pending.length === 0 ? <p className="muted">Loading…</p> : null}
        <div className="lines">
          {pending.length === 0 && !loading ? (
            <p className="muted">No pending requests.</p>
          ) : (
            pending.map((row) => (
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
                        GHS {row.withdrawalAmount?.toFixed(2) ?? "—"} ·{" "}
                        {fulfillmentLabel(row.fulfillmentMode)}
                      </small>
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
                    {row.fulfillmentMode === "momo" ? "Approve MoMo…" : "Approve"}
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

      <WithdrawalMomoApproveModal
        open={momoRequest !== null}
        request={momoRequest}
        onClose={() => setMomoRequest(null)}
        onApproved={() => {
          if (momoRequest) {
            removePendingRequest(momoRequest.id);
          }
          void refreshSilent();
        }}
      />
    </>
  );
}
