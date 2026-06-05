import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";

type Props = {
  open: boolean;
  customerName?: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => void;
};

export function DeclineRequestModal({ open, customerName, submitting, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title="Decline request"
      subtitle={
        customerName
          ? `Optional reason for ${customerName} (shown to the field agent).`
          : "Optional reason shown to the field agent."
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={submitting}
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {submitting ? "Declining…" : "Confirm decline"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Reason (optional)</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Insufficient documentation — try again next week"
        />
      </label>
    </Modal>
  );
}
