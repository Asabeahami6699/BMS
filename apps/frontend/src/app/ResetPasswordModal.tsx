import { FormEvent, useState } from "react";
import type { UserRecord } from "./api";
import { resetUserPassword } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Props = {
  open: boolean;
  user: UserRecord | null;
  onClose: () => void;
};

export function ResetPasswordModal({ open, user, onClose }: Props) {
  const { showToast } = useToast();
  const [password, setPassword] = useState("ChangeMe123!");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      return;
    }
    setSubmitting(true);
    try {
      await resetUserPassword(user.userId, password);
      showToast(`Password reset for ${user.email}`, "success");
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to reset password", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Reset password"
      subtitle={user ? `Set a new password for ${user.fullName ?? user.email}.` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="reset-password-form" className="button" disabled={submitting || !user}>
            {submitting ? "Saving…" : "Reset password"}
          </button>
        </>
      }
    >
      <form id="reset-password-form" className="stack-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>New password</span>
          <input
            type="text"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
      </form>
    </Modal>
  );
}
