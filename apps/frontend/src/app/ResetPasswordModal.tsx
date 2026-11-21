import { FormEvent, useEffect, useState } from "react";
import type { UserRecord } from "./api";
import { resetUserPassword } from "./api";
import { CredentialsSharePanel } from "../components/CredentialsSharePanel";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useHrDeskStore } from "./stores/hrDeskStore";

type Props = {
  open: boolean;
  user: UserRecord | null;
  onClose: () => void;
};

function generateSuggestedPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "Aa1!";
  for (const b of bytes) {
    out += chars[b % chars.length];
  }
  return out;
}

export function ResetPasswordModal({ open, user, onClose }: Props) {
  const { showToast } = useToast();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedCurrent, setCopiedCurrent] = useState(false);
  const [resetDone, setResetDone] = useState<{
    fullName: string;
    email: string;
    password: string;
  } | null>(null);

  const userId = user?.userId ?? "";
  const passwordRef = useHrDeskStore((s) => (userId ? s.passwordRefByUser[userId] : undefined));
  const refLoading = useHrDeskStore((s) => (userId ? Boolean(s.passwordRefLoadingByUser[userId]) : false));
  const refError = useHrDeskStore((s) => (userId ? (s.passwordRefErrorByUser[userId] ?? null) : null));
  const fetchUserPasswordReference = useHrDeskStore((s) => s.fetchUserPasswordReference);
  const setUserPasswordReference = useHrDeskStore((s) => s.setUserPasswordReference);

  useEffect(() => {
    if (!open || !userId) {
      setResetDone(null);
      setCopiedCurrent(false);
      return;
    }
    setResetDone(null);
    setCopiedCurrent(false);
    setPassword("");
    void fetchUserPasswordReference(userId, { force: true });
  }, [open, userId, fetchUserPasswordReference]);

  function handleClose() {
    setResetDone(null);
    setPassword("");
    onClose();
  }

  async function handleCopyCurrent() {
    const current = passwordRef?.password;
    if (!current) {
      return;
    }
    try {
      await navigator.clipboard.writeText(current);
      setCopiedCurrent(true);
      showToast("Current password copied", "success");
      window.setTimeout(() => setCopiedCurrent(false), 2000);
    } catch {
      showToast("Could not copy — select and copy manually", "error");
    }
  }

  async function handleShareCurrent() {
    if (!user || !passwordRef?.password) {
      return;
    }
    const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
    const text = [
      `aabanker login details — ${user.fullName ?? user.email}`,
      "",
      `Full name: ${user.fullName ?? "—"}`,
      `Email (login): ${user.email}`,
      `Password: ${passwordRef.password}`,
      `Sign-in URL: ${loginUrl}`
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: `aabanker login details — ${user.fullName ?? user.email}`, text });
        showToast("Share dialog opened", "success");
        return;
      } catch {
        /* fallback to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("User login details copied to clipboard", "success");
    } catch {
      showToast("Could not share — copy manually", "error");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      return;
    }
    const nextPassword = password.trim();
    if (nextPassword.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setSubmitting(true);
    try {
      await resetUserPassword(user.userId, nextPassword);
      setUserPasswordReference(
        { userId: user.userId, email: user.email, fullName: user.fullName },
        nextPassword
      );
      setResetDone({
        fullName: user.fullName ?? user.email,
        email: user.email,
        password: nextPassword
      });
      showToast(`Password reset for ${user.email}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to reset password", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={resetDone ? "Password updated" : "Reset password"}
      subtitle={
        resetDone
          ? "Forward the updated login details directly to this user via Share or Copy."
          : user
            ? `View saved password reference or set a new password for ${user.fullName ?? user.email}.`
            : undefined
      }
      onClose={handleClose}
      footer={
        resetDone ? (
          <button type="button" className="button" onClick={handleClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="button secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="reset-password-form"
              className="button"
              disabled={submitting || !user || password.trim().length < 8}
            >
              {submitting ? "Saving…" : "Reset password"}
            </button>
          </>
        )
      }
    >
      {resetDone ? (
        <CredentialsSharePanel
          title={`Updated login details for ${resetDone.fullName}`}
          shareTitle={`aabanker updated login details — ${resetDone.fullName}`}
          shareButtonLabel="Share with user"
          defaultRevealed
          fields={[
            { label: "Full name", value: resetDone.fullName },
            { label: "Email (login)", value: resetDone.email },
            { label: "New password", value: resetDone.password, secret: true }
          ]}
        />
      ) : (
        <div className="stack-form">
          <div className="password-ref-box">
            <div className="password-ref-box__head">
              <span className="password-ref-box__label">Current password (reference)</span>
              {passwordRef?.updatedAt ? (
                <span className="password-ref-box__time muted">
                  Updated {new Date(passwordRef.updatedAt).toLocaleDateString()}
                </span>
              ) : null}
            </div>

            {refLoading && !passwordRef ? (
              <p className="muted password-ref-box__note">Loading saved password reference…</p>
            ) : refError ? (
              <p className="muted password-ref-box__note">{refError}</p>
            ) : passwordRef?.password ? (
              <div className="password-ref-box__row">
                <code className="password-ref-box__value">{passwordRef.password}</code>
                <div className="password-ref-box__actions">
                  <button
                    type="button"
                    className="button secondary credentials-copy-btn"
                    onClick={() => void handleCopyCurrent()}
                  >
                    {copiedCurrent ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="button secondary credentials-copy-btn"
                    onClick={() => void handleShareCurrent()}
                  >
                    Share
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted password-ref-box__note">
                No saved password reference yet for this user (account was created before password
                reference tracking). Resetting below will save the new password for future reference.
              </p>
            )}
          </div>

          <form id="reset-password-form" className="stack-form" onSubmit={handleSubmit}>
            <label className="field">
              <div className="password-field-label-row">
                <span>New password</span>
                <button
                  type="button"
                  className="password-generate-btn"
                  onClick={() => setPassword(generateSuggestedPassword())}
                >
                  Generate strong password
                </button>
              </div>
              <input
                type="text"
                autoComplete="new-password"
                placeholder="Enter at least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
          </form>
        </div>
      )}
    </Modal>
  );
}
