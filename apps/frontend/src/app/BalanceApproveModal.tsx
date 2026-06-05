import { FormEvent, useEffect, useState } from "react";
import type { BalanceDisclosure } from "./api";
import { Modal } from "../components/Modal";

type Props = {
  open: boolean;
  request: BalanceDisclosure | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (visibleHours: number) => void;
};

export function BalanceApproveModal({ open, request, submitting, onClose, onConfirm }: Props) {
  const [hours, setHours] = useState("6");

  useEffect(() => {
    if (open) {
      setHours("6");
    }
  }, [open, request?.id]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = Number(hours);
    if (!Number.isFinite(value) || value < 0.25 || value > 168) {
      return;
    }
    onConfirm(value);
  }

  if (!request) {
    return null;
  }

  return (
    <Modal
      open={open}
      title="Approve balance request"
      subtitle={`${request.customerName ?? "Customer"} — agent can view balance for the time you set.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="balance-approve-form" className="button" disabled={submitting}>
            {submitting ? "Approving…" : "Approve & grant access"}
          </button>
        </>
      }
    >
      <form id="balance-approve-form" className="stack-form" onSubmit={handleSubmit}>
        {request.requestReason ? (
          <p className="muted">
            <strong>Agent reason:</strong> {request.requestReason}
          </p>
        ) : null}
        <label className="field">
          <span>Visibility window (hours)</span>
          <input
            type="number"
            min={0.25}
            max={168}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            required
          />
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            After this period the balance hides from the agent until they request again. Minimum 15 minutes (0.25h),
            maximum 7 days (168h).
          </p>
        </label>
      </form>
    </Modal>
  );
}
