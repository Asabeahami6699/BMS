import { useState } from "react";
import type { UserRecord } from "./api";
import { requireUserTransactionPinReset } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Props = {
  open: boolean;
  user: UserRecord | null;
  onClose: () => void;
};

export function ResetTransactionPinModal({ open, user, onClose }: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!user) {
      return;
    }
    setSubmitting(true);
    try {
      await requireUserTransactionPinReset(user.userId);
      showToast(
        `Transaction PIN reset requested for ${user.fullName ?? user.email}. They must choose a new PIN before posting transactions.`,
        "success"
      );
      onClose();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to require transaction PIN reset",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Reset transaction PIN"
      subtitle={
        user
          ? `Require ${user.fullName ?? user.email} to choose a new 4-digit transaction PIN. You will not see or set the PIN — the teller enters it on their next login or transaction.`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" disabled={submitting || !user} onClick={() => void handleConfirm()}>
            {submitting ? "Requesting…" : "Require PIN reset"}
          </button>
        </>
      }
    >
      <p className="muted">
        New tellers and back officers are prompted to set a PIN on first login. Use this action to
        require a new PIN after a forgotten PIN, lockout, or security concern. This clears their
        current PIN and unlocks any lockout.
      </p>
    </Modal>
  );
}
