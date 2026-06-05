import { useEffect, useState } from "react";
import type {
  CustomerRequestType,
  RequestCustomerApprovalInput,
  WithdrawalFulfillmentMode
} from "../../app/api";
import { Modal } from "../../components/Modal";

const FULFILLMENT_OPTIONS: {
  id: WithdrawalFulfillmentMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "next_day_cash",
    label: "Cash next day",
    hint: "Default in the field — you pay the customer the next working day"
  },
  {
    id: "agent_next_day",
    label: "Agent brings cash",
    hint: "You collect from the office and deliver to the customer next day"
  },
  {
    id: "momo",
    label: "Mobile Money (MoMo)",
    hint: "Coordinator sends instantly; receipt sent to your alerts"
  }
];

type Props = {
  open: boolean;
  customerName?: string;
  priorDeclineReason?: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: RequestCustomerApprovalInput) => void;
};

export function CustomerRequestModal({
  open,
  customerName,
  priorDeclineReason,
  submitting,
  onClose,
  onSubmit
}: Props) {
  const [requestType, setRequestType] = useState<CustomerRequestType>("balance");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<WithdrawalFulfillmentMode>("next_day_cash");
  const [momoNumber, setMomoNumber] = useState("");
  const [momoAccountName, setMomoAccountName] = useState("");

  useEffect(() => {
    if (open) {
      setRequestType("balance");
      setReason("");
      setAmount("");
      setFulfillmentMode("next_day_cash");
      setMomoNumber("");
      setMomoAccountName("");
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      return;
    }
    if (requestType === "withdrawal") {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return;
      }
      if (fulfillmentMode === "momo") {
        if (!momoNumber.trim() || !momoAccountName.trim()) {
          return;
        }
        onSubmit({
          type: "withdrawal",
          reason: trimmedReason,
          amount: parsed,
          fulfillmentMode: "momo",
          momoNumber: momoNumber.trim(),
          momoAccountName: momoAccountName.trim()
        });
        return;
      }
      onSubmit({
        type: "withdrawal",
        reason: trimmedReason,
        amount: parsed,
        fulfillmentMode
      });
      return;
    }
    onSubmit({ type: "balance", reason: trimmedReason });
  }

  const amountValid =
    requestType === "balance" || (Number(amount) > 0 && Number.isFinite(Number(amount)));
  const momoValid =
    fulfillmentMode !== "momo" || (momoNumber.trim().length > 0 && momoAccountName.trim().length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request from coordinator"
      subtitle={
        customerName
          ? `Choose what you need for ${customerName}. Your coordinator must approve first.`
          : "Balance view or withdrawal — coordinator approval required."
      }
    >
      <form className="agent-balance-request-form" onSubmit={handleSubmit}>
        {priorDeclineReason ? (
          <p className="agent-balance-request-declined muted">
            Previous request declined: {priorDeclineReason}
          </p>
        ) : null}

        <fieldset className="agent-request-type-fieldset">
          <legend className="agent-request-type-legend">Request type</legend>
          <label className="agent-request-type-option">
            <input
              type="radio"
              name="requestType"
              value="balance"
              checked={requestType === "balance"}
              onChange={() => setRequestType("balance")}
              disabled={submitting}
            />
            <span>
              <strong>View balance</strong>
              <small className="muted">Visible for 6 hours after approval</small>
            </span>
          </label>
          <label className="agent-request-type-option">
            <input
              type="radio"
              name="requestType"
              value="withdrawal"
              checked={requestType === "withdrawal"}
              onChange={() => setRequestType("withdrawal")}
              disabled={submitting}
            />
            <span>
              <strong>Request withdrawal</strong>
              <span className="muted">
                {" "}
                — opening savings deposit cannot be withdrawn
              </span>
              <small className="muted">Customer wants money from their account</small>
            </span>
          </label>
        </fieldset>

        {requestType === "withdrawal" ? (
          <>
            <label className="field">
              <span>Amount (GHS)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50.00"
                required
                disabled={submitting}
              />
            </label>

            <fieldset className="agent-request-type-fieldset">
              <legend className="agent-request-type-legend">How will customer receive it?</legend>
              {FULFILLMENT_OPTIONS.map((opt) => (
                <label className="agent-request-type-option" key={opt.id}>
                  <input
                    type="radio"
                    name="fulfillmentMode"
                    value={opt.id}
                    checked={fulfillmentMode === opt.id}
                    onChange={() => setFulfillmentMode(opt.id)}
                    disabled={submitting}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <small className="muted">{opt.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {fulfillmentMode === "momo" ? (
              <>
                <label className="field">
                  <span>Customer MoMo number</span>
                  <input
                    value={momoNumber}
                    onChange={(e) => setMomoNumber(e.target.value)}
                    placeholder="e.g. 0244123456"
                    required
                    disabled={submitting}
                  />
                </label>
                <label className="field">
                  <span>Name on MoMo account</span>
                  <input
                    value={momoAccountName}
                    onChange={(e) => setMomoAccountName(e.target.value)}
                    placeholder="As shown on customer's phone"
                    required
                    disabled={submitting}
                  />
                </label>
              </>
            ) : null}
          </>
        ) : null}

        <label className="field">
          <span>Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this needed?"
            required
            minLength={3}
            disabled={submitting}
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="button"
            disabled={submitting || reason.trim().length < 3 || !amountValid || !momoValid}
          >
            {submitting ? "Sending…" : "Send for approval"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
