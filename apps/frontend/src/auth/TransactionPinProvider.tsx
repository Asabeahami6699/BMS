import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { roleRequiresTransactionPin } from "@bms/shared";
import {
  getTransactionPinStatus,
  setTransactionPin,
  verifyTransactionPin
} from "../app/api";
import { useAuth } from "./AuthContext";
import { TransactionPinModal } from "./TransactionPinModal";
import {
  registerTransactionStepUpRequest,
  storeVerifiedStepUpToken
} from "../lib/transactionPinBridge";
import { clearCachedTransactionStepUpToken, getCachedTransactionStepUpToken } from "../lib/transactionPinSession";

type TransactionPinContextValue = {
  requestStepUp: () => Promise<string>;
};

const TransactionPinContext = createContext<TransactionPinContextValue | null>(null);

export function useTransactionPin() {
  const ctx = useContext(TransactionPinContext);
  if (!ctx) {
    throw new Error("useTransactionPin must be used within TransactionPinProvider");
  }
  return ctx;
}

const PIN_STATUS_POLL_MS = 30_000;

export function TransactionPinProvider({ children }: { children: ReactNode }) {
  const { user, refreshMe } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"verify" | "setup">("verify");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [resetRequired, setResetRequired] = useState(false);
  const resolverRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((reason?: unknown) => void) | null>(null);

  const applyPinStatus = useCallback((status: Awaited<ReturnType<typeof getTransactionPinStatus>>) => {
    setLockedUntil(status.lockedUntil ?? null);
    setResetRequired(status.resetRequired);
    if (status.resetRequired) {
      clearCachedTransactionStepUpToken();
      setMode("setup");
      setModalOpen(true);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setError(null);
    setBusy(false);
    if (rejectRef.current) {
      rejectRef.current(new Error("Transaction PIN entry cancelled"));
      rejectRef.current = null;
      resolverRef.current = null;
    }
  }, []);

  const requestStepUp = useCallback(async (): Promise<string> => {
    if (!user || !roleRequiresTransactionPin(user.role)) {
      return "";
    }

    const cached = getCachedTransactionStepUpToken();
    if (cached) {
      return cached;
    }

    let status: Awaited<ReturnType<typeof getTransactionPinStatus>>;
    try {
      status = await getTransactionPinStatus();
      applyPinStatus(status);
    } catch {
      status = {
        required: true,
        configured: user.transactionPin?.configured ?? false,
        resetRequired: user.transactionPin?.resetRequired ?? false,
        lockedUntil: user.transactionPin?.lockedUntil ?? null
      };
      setLockedUntil(status.lockedUntil ?? null);
      setResetRequired(status.resetRequired);
    }

    if (!status.configured) {
      if (status.resetRequired) {
        setMode("setup");
        setModalOpen(true);
      } else {
        throw new Error(
          "Contact an administrator to reset your transaction PIN before posting transactions"
        );
      }
    } else {
      setMode("verify");
      setModalOpen(true);
    }

    return new Promise<string>((resolve, reject) => {
      resolverRef.current = resolve;
      rejectRef.current = reject;
    });
  }, [applyPinStatus, user]);

  useEffect(() => {
    registerTransactionStepUpRequest(requestStepUp);
    return () => registerTransactionStepUpRequest(null);
  }, [requestStepUp]);

  useEffect(() => {
    if (!user || !roleRequiresTransactionPin(user.role)) {
      setResetRequired(false);
      return;
    }

    let cancelled = false;

    async function pollStatus() {
      try {
        const status = await getTransactionPinStatus();
        if (cancelled) {
          return;
        }
        applyPinStatus(status);
      } catch {
        // ignore transient network errors
      }
    }

    void pollStatus();
    const intervalId = window.setInterval(() => void pollStatus(), PIN_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyPinStatus, user?.userId, user?.role]);

  useEffect(() => {
    if (!user) {
      clearCachedTransactionStepUpToken();
    }
  }, [user?.userId]);

  async function handleSubmit(pin: string, confirmPin?: string) {
    if (!user) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "setup") {
        if (!confirmPin) {
          return;
        }
        await setTransactionPin(pin, confirmPin);
        await refreshMe();
        setResetRequired(false);
        const verified = await verifyTransactionPin(pin);
        storeVerifiedStepUpToken(verified.token, verified.expiresAt);
        setModalOpen(false);
        resolverRef.current?.(verified.token);
        resolverRef.current = null;
        rejectRef.current = null;
        return;
      }
      const verified = await verifyTransactionPin(pin);
      storeVerifiedStepUpToken(verified.token, verified.expiresAt);
      setModalOpen(false);
      resolverRef.current?.(verified.token);
      resolverRef.current = null;
      rejectRef.current = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "PIN verification failed";
      setError(message);
      if (message.toLowerCase().includes("locked")) {
        void getTransactionPinStatus()
          .then((status) => setLockedUntil(status.lockedUntil ?? null))
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <TransactionPinContext.Provider value={{ requestStepUp }}>
      {children}
      <TransactionPinModal
        open={modalOpen}
        mode={mode}
        setupContext={resetRequired ? "admin_reset" : "default"}
        lockedUntil={lockedUntil}
        error={error}
        busy={busy}
        onClose={() => {
          if (resetRequired) {
            setError("Your administrator requires you to set a new transaction PIN before continuing.");
            return;
          }
          closeModal();
        }}
        onSubmit={(pin, confirmPin) => void handleSubmit(pin, confirmPin)}
      />
    </TransactionPinContext.Provider>
  );
}
