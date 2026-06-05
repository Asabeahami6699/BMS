import { useEffect, useState } from "react";
import type { Customer } from "./api";
import { approveCustomer, rejectCustomer } from "./api";
import { CustomerDetailsView } from "../components/CustomerDetailsView";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  customer: Customer | null;
  agentLabel?: string;
  branchLabel?: string;
  onClose: () => void;
  onDecided: () => void;
};

export function RegistrationReviewModal({
  open,
  customer,
  agentLabel,
  branchLabel,
  onClose,
  onDecided
}: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!open) {
      setRejectMode(false);
      setRejectReason("");
      setSubmitting(false);
    }
  }, [open, customer?.id]);

  async function handleApprove() {
    if (!customer) {
      return;
    }
    setSubmitting(true);
    try {
      const approved = await approveCustomer(customer.id);
      showToast(`Approved — account ${approved.accountNumber}`, "success");
      onDecided();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Approve failed"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectConfirm() {
    if (!customer) {
      return;
    }
    setSubmitting(true);
    try {
      await rejectCustomer(customer.id, rejectReason.trim() || undefined);
      showToast("Registration rejected", "success");
      onDecided();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Reject failed"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!customer) {
    return null;
  }

  return (
    <Modal
      open={open}
      title="Review registration"
      subtitle="Verify identity and account details before approval."
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer"
      footer={
        rejectMode ? (
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectMode(false)}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => void handleRejectConfirm()}
              disabled={submitting}
            >
              {submitting ? "Rejecting…" : "Confirm reject"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
              Close
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectMode(true)}
              disabled={submitting}
            >
              Reject
            </button>
            <button type="button" className="button" onClick={() => void handleApprove()} disabled={submitting}>
              {submitting ? "Approving…" : "Approve"}
            </button>
          </>
        )
      }
    >
      <CustomerDetailsView
        customer={customer}
        branchLabel={branchLabel}
        agentLabel={agentLabel}
        statusLabel="Pending approval"
        showFinancials={false}
      />
      {rejectMode ? (
        <label className="field cif-reject">
          <span>Rejection reason (optional)</span>
          <textarea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain why this registration is rejected"
          />
        </label>
      ) : null}
    </Modal>
  );
}
