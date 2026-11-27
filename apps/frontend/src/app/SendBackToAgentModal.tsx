import { useEffect, useState } from "react";
import type { Customer } from "./api";
import { returnRejectedCustomerToAgent } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  customer: Customer | null;
  agentLabel?: string;
  onClose: () => void;
  onSent: (updated: Customer) => void;
};

export function SendBackToAgentModal({
  open,
  customer,
  agentLabel,
  onClose,
  onSent
}: Props) {
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && customer) {
      setReason(customer.rejectionReason ?? "");
      setSubmitting(false);
    } else if (!open) {
      setReason("");
      setSubmitting(false);
    }
  }, [open, customer]);

  async function handleConfirm() {
    if (!customer) {
      return;
    }
    setSubmitting(true);
    try {
      const updated = await returnRejectedCustomerToAgent(
        customer.id,
        reason.trim() || undefined
      );
      showToast(
        `Sent ${customer.fullName} back to ${agentLabel && agentLabel !== "—" ? agentLabel : "the mobilizer"} to fix and resubmit`,
        "success"
      );
      onSent(updated);
      onClose();
    } catch (error) {
      showToast(
        toUserFacingError(error, "Could not send registration back to mobilizer"),
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open && customer !== null}
      title={customer ? `Send back to mobilizer — ${customer.fullName}` : "Send back to mobilizer"}
      subtitle={
        customer
          ? `Assigned mobilizer: ${agentLabel && agentLabel !== "—" ? agentLabel : "Field agent"}. They will receive an alert and can edit and resubmit this registration for approval.`
          : undefined
      }
      onClose={() => {
        if (!submitting) {
          onClose();
        }
      }}
      footer={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Sending…" : "Send back to mobilizer"}
          </button>
        </>
      }
    >
      <div className="stack-md">
        <label className="field">
          <span>What should the mobilizer fix?</span>
          <textarea
            rows={3}
            value={reason}
            maxLength={400}
            placeholder="e.g. Upload a clearer Ghana Card photo, correct date of birth, or confirm phone number."
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
          />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: "0.84rem" }}>
          The mobilizer will see this instruction on their Customers / Registrations screen with a{" "}
          <strong>Fix &amp; resubmit</strong> button. Once resubmitted, the account returns to{" "}
          <strong>Pending approvals</strong> with the same record (no duplicate).
        </p>
      </div>
    </Modal>
  );
}
