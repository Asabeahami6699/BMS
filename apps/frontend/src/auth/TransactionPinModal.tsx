import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal";

type Mode = "verify" | "setup";

type Props = {
  open: boolean;
  mode: Mode;
  setupContext?: "default" | "admin_reset";
  lockedUntil?: string | null;
  error?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (pin: string, confirmPin?: string) => void;
};

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export function TransactionPinModal({
  open,
  mode,
  setupContext = "default",
  lockedUntil,
  error,
  busy,
  onClose,
  onSubmit
}: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const pinRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirmPin("");
      setStep("enter");
      pinRef.current = "";
    }
  }, [open]);

  const locked =
    lockedUntil != null && lockedUntil !== "" && new Date(lockedUntil).getTime() > Date.now();

  const focusInput = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (open && !busy && !locked) {
      focusInput();
    }
  }, [open, busy, locked, step, focusInput]);

  const applyDigits = useCallback(
    (digits: string) => {
      if (busy || locked) {
        return;
      }
      const normalized = digits.replace(/\D/g, "").slice(0, 4);
      if (mode === "setup" && step === "confirm") {
        setConfirmPin(normalized);
        if (normalized.length === 4) {
          onSubmit(pinRef.current, normalized);
        }
        return;
      }
      setPin(normalized);
      pinRef.current = normalized;
      if (normalized.length === 4) {
        if (mode === "setup") {
          setStep("confirm");
          setConfirmPin("");
        } else {
          onSubmit(normalized);
        }
      }
    },
    [busy, locked, mode, onSubmit, step]
  );

  const handlePadKey = useCallback(
    (key: (typeof PIN_KEYS)[number]) => {
      if (busy || locked) {
        return;
      }
      if (key === "clear") {
        if (mode === "setup" && step === "confirm") {
          setConfirmPin("");
        } else {
          setPin("");
          pinRef.current = "";
          if (mode === "setup") {
            setStep("enter");
          }
        }
        focusInput();
        return;
      }
      if (key === "back") {
        if (mode === "setup" && step === "confirm") {
          setConfirmPin((value) => value.slice(0, -1));
        } else {
          const next = pinRef.current.slice(0, -1);
          setPin(next);
          pinRef.current = next;
        }
        focusInput();
        return;
      }
      const active = mode === "setup" && step === "confirm" ? confirmPin : pinRef.current;
      applyDigits(active + key);
      focusInput();
    },
    [applyDigits, busy, confirmPin, focusInput, locked, mode, step]
  );

  useEffect(() => {
    if (!open || busy || locked) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        target !== inputRef.current &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handlePadKey(event.key as (typeof PIN_KEYS)[number]);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        handlePadKey("back");
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        handlePadKey("clear");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, handlePadKey, locked, open]);

  const activeValue = mode === "setup" && step === "confirm" ? confirmPin : pin;

  const setupTitle =
    setupContext === "admin_reset" ? "Set new transaction PIN" : "Set transaction PIN";
  const setupSubtitle =
    setupContext === "admin_reset"
      ? step === "confirm"
        ? "Confirm your new 4-digit PIN"
        : "Your administrator requires you to choose a new 4-digit PIN. Only you will know this PIN."
      : step === "confirm"
        ? "Confirm your 4-digit PIN"
        : "Choose a 4-digit PIN for teller and back-office transactions";

  return (
    <Modal
      open={open}
      title={mode === "setup" ? setupTitle : "Enter transaction PIN"}
      subtitle={
        mode === "setup"
          ? setupSubtitle
          : "Confirm your identity before posting this transaction"
      }
      onClose={onClose}
      panelClassName="modal-panel--narrow transaction-pin-modal"
      footer={
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      }
    >
      <div className="transaction-pin-modal__body">
        <label className="sr-only" htmlFor="transaction-pin-input">
          {mode === "setup" && step === "confirm" ? "Confirm transaction PIN" : "Transaction PIN"}
        </label>
        <input
          ref={inputRef}
          id="transaction-pin-input"
          className="transaction-pin-modal__input"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={4}
          value={activeValue}
          disabled={busy || locked}
          aria-describedby="transaction-pin-hint"
          onChange={(event) => applyDigits(event.target.value)}
        />
        <p id="transaction-pin-hint" className="muted transaction-pin-modal__hint">
          Type digits on your keyboard or use the keypad below.
        </p>
        {locked ? (
          <p className="error-text" role="alert">
            PIN locked until {new Date(lockedUntil!).toLocaleTimeString()}.
          </p>
        ) : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="transaction-pin-modal__dots" aria-live="polite">
          {Array.from({ length: 4 }).map((_, index) => (
            <span
              key={index}
              className={`transaction-pin-modal__dot${index < activeValue.length ? " is-filled" : ""}`}
              aria-hidden
            />
          ))}
        </div>
        <div className="transaction-pin-modal__pad" role="group" aria-label="PIN keypad">
          {PIN_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`transaction-pin-modal__key${
                key === "clear" || key === "back" ? " transaction-pin-modal__key--muted" : ""
              }`}
              disabled={busy || locked}
              onClick={() => handlePadKey(key)}
            >
              {key === "clear" ? "C" : key === "back" ? "⌫" : key}
            </button>
          ))}
        </div>
        {busy ? <p className="muted transaction-pin-modal__busy">Verifying…</p> : null}
      </div>
    </Modal>
  );
}
