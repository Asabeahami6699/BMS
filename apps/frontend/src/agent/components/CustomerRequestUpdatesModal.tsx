import type { BalanceDisclosure } from "../../app/api";
import { Modal } from "../../components/Modal";
import { balanceExpiresLabel, fulfillmentLabel, isBalanceVisible } from "../stores/agentBalanceStore";

type Props = {
  open: boolean;
  customerName?: string;
  balance?: BalanceDisclosure;
  withdrawal?: BalanceDisclosure;
  onClose: () => void;
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

function RequestDetail({ label, disclosure }: { label: string; disclosure: BalanceDisclosure }) {
  if (disclosure.status === "pending") {
    return (
      <div className="agent-request-update-block">
        <strong>{label}</strong>
        <p className="muted">Awaiting coordinator approval</p>
        {disclosure.requestReason ? <p>Your reason: {disclosure.requestReason}</p> : null}
      </div>
    );
  }

  if (disclosure.status === "rejected") {
    return (
      <div className="agent-request-update-block agent-request-update-block--rejected">
        <strong>{label} — declined</strong>
        <p>{disclosure.rejectedReason ? disclosure.rejectedReason : "No reason provided."}</p>
      </div>
    );
  }

  if (disclosure.requestType === "balance" && isBalanceVisible(disclosure)) {
    return (
      <div className="agent-request-update-block agent-request-update-block--approved">
        <strong>{label} — approved</strong>
        <p>
          {formatMoney(disclosure.balanceAmount ?? 0)}
          {disclosure.expiresAt ? (
            <span className="muted"> · {balanceExpiresLabel(disclosure.expiresAt)}</span>
          ) : null}
        </p>
      </div>
    );
  }

  if (disclosure.requestType === "withdrawal" && disclosure.status === "approved") {
    return (
      <div className="agent-request-update-block agent-request-update-block--approved">
        <strong>{label} — approved</strong>
        <p>
          {formatMoney(disclosure.withdrawalAmount ?? 0)} · {fulfillmentLabel(disclosure.fulfillmentMode)}
        </p>
        {disclosure.fulfillmentMode === "momo" && disclosure.generatedReceiptImage ? (
          <div className="agent-receipt-thumb">
            <img src={disclosure.generatedReceiptImage} alt="MoMo receipt" />
          </div>
        ) : null}
      </div>
    );
  }

  if (disclosure.status === "approved" && disclosure.requestType === "balance") {
    return (
      <div className="agent-request-update-block">
        <strong>{label}</strong>
        <p className="muted">Visibility window ended. Request again to view balance.</p>
      </div>
    );
  }

  return null;
}

export function CustomerRequestUpdatesModal({
  open,
  customerName,
  balance,
  withdrawal,
  onClose
}: Props) {
  const hasAny = Boolean(balance || withdrawal);

  return (
    <Modal
      open={open}
      title="Request updates"
      subtitle={customerName ? `Coordinator responses for ${customerName}` : undefined}
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      {!hasAny ? (
        <p className="muted">No requests sent for this customer yet.</p>
      ) : (
        <div className="agent-request-updates-body">
          {balance ? <RequestDetail label="Balance" disclosure={balance} /> : null}
          {withdrawal ? <RequestDetail label="Withdrawal" disclosure={withdrawal} /> : null}
        </div>
      )}
    </Modal>
  );
}
