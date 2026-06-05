import { useState } from "react";
import type { BalanceDisclosure, RequestCustomerApprovalInput } from "../../app/api";
import { useNetworkStatus } from "../../lib/useNetworkStatus";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import {
  balanceExpiresLabel,
  isBalanceVisible,
  isWithdrawalApproved,
  selectBalanceForCustomer,
  selectWithdrawalForCustomer,
  useAgentBalanceStore
} from "../stores/agentBalanceStore";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";
import { CustomerRequestModal } from "./CustomerRequestModal";
import { CustomerRequestUpdatesModal } from "./CustomerRequestUpdatesModal";

type Props = {
  customerId: string;
  customerName?: string;
  compact?: boolean;
};

function canRequestType(
  d: BalanceDisclosure | undefined,
  online: boolean,
  type: "balance" | "withdrawal"
): boolean {
  if (!online) {
    return false;
  }
  if (!d) {
    return true;
  }
  if (d.status === "pending") {
    return false;
  }
  if (d.status === "rejected") {
    return true;
  }
  if (type === "balance") {
    return !isBalanceVisible(d);
  }
  return !isWithdrawalApproved(d);
}

function formatMoney(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

export function CustomerRequestsRow({ customerId, customerName, compact }: Props) {
  const { online } = useNetworkStatus();
  const { showToast } = useToast();
  const balance = useAgentBalanceStore(selectBalanceForCustomer(customerId));
  const withdrawal = useAgentBalanceStore(selectWithdrawalForCustomer(customerId));
  const submitRequest = useAgentBalanceStore((s) => s.submitRequest);
  const refreshCustomers = useAgentCustomerStore((s) => s.refreshSilent);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);

  const balanceVisible = balance && isBalanceVisible(balance);
  const hasUpdates = Boolean(
    balance?.status === "pending" ||
      balance?.status === "rejected" ||
      balance?.status === "approved" ||
      withdrawal?.status === "pending" ||
      withdrawal?.status === "rejected" ||
      withdrawal?.status === "approved"
  );
  const pendingAny =
    balance?.status === "pending" || withdrawal?.status === "pending";

  const canOpenRequest =
    online &&
    !submitting &&
    (canRequestType(balance, online, "balance") || canRequestType(withdrawal, online, "withdrawal"));

  function openModal(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!canOpenRequest) {
      if (!online) {
        showToast("Go online to send a request", "info");
      }
      return;
    }
    setModalOpen(true);
  }

  async function handleSubmit(payload: RequestCustomerApprovalInput) {
    setSubmitting(true);
    try {
      await submitRequest(customerId, payload);
      void refreshCustomers();
      void useAgentBalanceStore.getState().refreshSilent();
      setModalOpen(false);
      showToast(
        payload.type === "withdrawal"
          ? "Withdrawal request sent to coordinator"
          : "Balance request sent to coordinator",
        "success"
      );
    } catch (error) {
      showToast(toUserFacingError(error, "Could not send request"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  const compactClass = compact ? " agent-customer-requests--compact" : "";

  return (
    <div className={`agent-customer-requests${compactClass}`} onClick={(e) => e.stopPropagation()}>
      {balanceVisible ? (
        <p className="agent-customer-balance agent-customer-balance--visible">
          <span className="agent-customer-balance-label">Approved balance</span>
          <strong>{formatMoney(balance.balanceAmount ?? 0)}</strong>
          {balance.expiresAt ? (
            <span className="muted"> · {balanceExpiresLabel(balance.expiresAt)}</span>
          ) : null}
        </p>
      ) : null}

      <div className="agent-customer-request-actions">
        {pendingAny ? (
          <span className="status-pill status-pill--pending">Request pending</span>
        ) : null}
        {canOpenRequest ? (
          <button
            type="button"
            className="button secondary agent-customer-balance-btn agent-customer-request-btn"
            disabled={submitting}
            onClick={(e) => openModal(e)}
          >
            Request
          </button>
        ) : null}
        {hasUpdates ? (
          <button
            type="button"
            className="button secondary agent-customer-updates-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setUpdatesOpen(true);
            }}
          >
            View updates
          </button>
        ) : null}
        {!online && !canOpenRequest && !hasUpdates ? (
          <span className="muted agent-customer-balance-hint">Offline</span>
        ) : null}
      </div>

      <CustomerRequestModal
        open={modalOpen}
        customerName={customerName}
        submitting={submitting}
        onClose={() => setModalOpen(false)}
        onSubmit={(payload) => void handleSubmit(payload)}
      />

      <CustomerRequestUpdatesModal
        open={updatesOpen}
        customerName={customerName}
        balance={balance}
        withdrawal={withdrawal}
        onClose={() => setUpdatesOpen(false)}
      />
    </div>
  );
}
