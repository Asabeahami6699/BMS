import type { CSSProperties } from "react";
import { formatCountdown } from "./sessionUtils";

type Props = {
  open: boolean;
  mode: "warning" | "expired";
  secondsLeft: number;
  totalSeconds: number;
  busy: boolean;
  onStaySignedIn: () => void;
  onSignOut: () => void;
};

export function SessionExpiryModal({
  open,
  mode,
  secondsLeft,
  totalSeconds,
  busy,
  onStaySignedIn,
  onSignOut
}: Props) {
  if (!open) {
    return null;
  }

  const isExpired = mode === "expired";
  const title = isExpired ? "Session expired" : "Still there?";
  const subtitle = isExpired
    ? "Your session is no longer active. Sign in again to continue."
    : "You have been inactive for 5 minutes. Stay signed in or you will be signed out when the countdown ends.";
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  const urgent = !isExpired && secondsLeft <= 60;

  return (
    <div className="session-expiry-backdrop" role="presentation">
      <div
        className="modal-panel session-expiry-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
        aria-describedby="session-expiry-desc"
      >
        <header className="modal-header">
          <div>
            <h2 id="session-expiry-title">{title}</h2>
            <p id="session-expiry-desc" className="muted modal-subtitle">
              {subtitle}
            </p>
          </div>
        </header>
        <div className="modal-body">
          {!isExpired ? (
            <div
              className={`session-expiry-timer${urgent ? " session-expiry-timer--urgent" : ""}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <div
                className={`session-expiry-timer__ring${urgent ? " session-expiry-timer__ring--urgent" : ""}`}
                style={{ "--progress": String(progress) } as CSSProperties}
              >
                <span className="session-expiry-timer__value">{formatCountdown(secondsLeft)}</span>
              </div>
              <p className="session-expiry-timer__label">
                Automatic sign-out in <strong>{formatCountdown(secondsLeft)}</strong>
              </p>
              <div className="session-expiry-timer__bar" aria-hidden>
                <span className="session-expiry-timer__bar-fill" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          ) : null}
          <p className="muted session-expiry-hint">
            {isExpired
              ? "Unsaved work on this page may be lost."
              : "Choose stay signed in to continue working, or sign out now on this device."}
          </p>
        </div>
        <footer className="modal-footer session-expiry-actions">
          {!isExpired ? (
            <button type="button" className="button primary" disabled={busy} onClick={onStaySignedIn}>
              {busy ? "Restoring…" : "Stay signed in"}
            </button>
          ) : null}
          <button type="button" className="button secondary" disabled={busy} onClick={onSignOut}>
            {isExpired ? "Sign in again" : "Sign out"}
          </button>
        </footer>
      </div>
    </div>
  );
}
