import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomerRequestType,
  MomoNetworkCode,
  RequestCustomerApprovalInput,
  WithdrawalFulfillmentMode
} from "../../app/api";
import { resolveMomoAccountName } from "../../app/api";
import { Modal } from "../../components/Modal";

const FULFILLMENT_OPTIONS: {
  id: WithdrawalFulfillmentMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "next_day_cash",
    label: "Cash — deliver next visit",
    hint: "Coordinator approves and calls the customer; office teller pays cash; you deliver on your next visit"
  },
  {
    id: "momo",
    label: "Mobile Money (MoMo)",
    hint: "Coordinator sends instantly; receipt sent to your alerts"
  }
];

const MOMO_NETWORKS: { code: MomoNetworkCode; label: string }[] = [
  { code: "MTN", label: "MTN MoMo" },
  { code: "VOD", label: "Telecel Cash" },
  { code: "ATL", label: "AT Money" }
];

const MTN_PREFIXES = new Set(["024", "025", "053", "054", "055", "059"]);
const VOD_PREFIXES = new Set(["020", "050"]);
const ATL_PREFIXES = new Set(["026", "027", "056", "057"]);

function normalizeGhanaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^233[25]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0[25]\d{8}$/.test(digits)) return digits;
  if (/^[25]\d{8}$/.test(digits)) return `0${digits}`;
  return null;
}

function detectNetworkFromPhone(raw: string): MomoNetworkCode | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("233") ? `0${digits.slice(3)}` : digits;
  if (local.length < 3) return null;
  const prefix = local.slice(0, 3);
  if (MTN_PREFIXES.has(prefix)) return "MTN";
  if (VOD_PREFIXES.has(prefix)) return "VOD";
  if (ATL_PREFIXES.has(prefix)) return "ATL";
  return null;
}

function namesLikelyMatch(customerName: string | undefined, resolvedName: string): boolean {
  if (!customerName) return true;
  const normalizeTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  const a = normalizeTokens(customerName);
  const b = new Set(normalizeTokens(resolvedName));
  if (a.length === 0 || b.size === 0) return true;
  return a.some((token) => b.has(token));
}

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "verified"; networkLabel: string; accountName: string }
  | { status: "fallback"; message: string };

type Props = {
  open: boolean;
  customerName?: string;
  priorDeclineReason?: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: RequestCustomerApprovalInput) => void;
};

export function CustomerRequestModal({
  open,
  customerName,
  priorDeclineReason,
  submitting,
  onClose,
  onSubmit
}: Props) {
  const [requestType, setRequestType] = useState<CustomerRequestType>("balance");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<WithdrawalFulfillmentMode>("next_day_cash");
  const [momoNetwork, setMomoNetwork] = useState<MomoNetworkCode>("MTN");
  const [networkManuallyPicked, setNetworkManuallyPicked] = useState(false);
  const [momoNumber, setMomoNumber] = useState("");
  const [momoAccountName, setMomoAccountName] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>({ status: "idle" });
  const lookupSeqRef = useRef(0);

  useEffect(() => {
    if (open) {
      setRequestType("balance");
      setReason("");
      setAmount("");
      setFulfillmentMode("next_day_cash");
      setMomoNetwork("MTN");
      setNetworkManuallyPicked(false);
      setMomoNumber("");
      setMomoAccountName("");
      setLookupState({ status: "idle" });
      lookupSeqRef.current += 1;
    }
  }, [open]);

  const runMomoLookup = useCallback(async (rawPhone: string, network: MomoNetworkCode) => {
    const normalized = normalizeGhanaPhone(rawPhone);
    if (!normalized) {
      return;
    }
    const seq = ++lookupSeqRef.current;
    setLookupState({ status: "loading" });
    try {
      const res = await resolveMomoAccountName(normalized, network);
      if (seq !== lookupSeqRef.current) {
        return;
      }
      if (res.verified && res.accountName) {
        setMomoAccountName(res.accountName);
        setLookupState({
          status: "verified",
          networkLabel: res.networkLabel,
          accountName: res.accountName
        });
      } else {
        setLookupState({
          status: "fallback",
          message:
            res.message ??
            "Could not auto-verify this MoMo number. Enter the account name manually."
        });
      }
    } catch (error) {
      if (seq !== lookupSeqRef.current) {
        return;
      }
      setLookupState({
        status: "fallback",
        message:
          error instanceof Error
            ? `${error.message}. Enter the account name manually.`
            : "Could not verify MoMo number. Enter the account name manually."
      });
    }
  }, []);

  const normalizedPhone = useMemo(() => normalizeGhanaPhone(momoNumber), [momoNumber]);

  // Auto-lookup once a valid 10-digit Ghana MoMo number is entered or network is changed.
  useEffect(() => {
    if (!open || requestType !== "withdrawal" || fulfillmentMode !== "momo") {
      return;
    }
    if (!normalizedPhone) {
      lookupSeqRef.current += 1;
      setLookupState({ status: "idle" });
      return;
    }
    const timer = window.setTimeout(() => {
      void runMomoLookup(normalizedPhone, momoNetwork);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [open, requestType, fulfillmentMode, normalizedPhone, momoNetwork, runMomoLookup]);

  function handleMomoNumberChange(value: string) {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 12);
    setMomoNumber(digitsOnly);
    if (!networkManuallyPicked) {
      const detected = detectNetworkFromPhone(digitsOnly);
      if (detected) {
        setMomoNetwork(detected);
      }
    }
    if (lookupState.status === "verified") {
      setLookupState({ status: "idle" });
    }
  }

  function handleNetworkChange(code: MomoNetworkCode) {
    setMomoNetwork(code);
    setNetworkManuallyPicked(true);
    setLookupState({ status: "idle" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      return;
    }
    if (requestType === "withdrawal") {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return;
      }
      if (fulfillmentMode === "momo") {
        if (!momoNumber.trim() || !momoAccountName.trim()) {
          return;
        }
        onSubmit({
          type: "withdrawal",
          reason: trimmedReason,
          amount: parsed,
          fulfillmentMode: "momo",
          momoNumber: normalizedPhone ?? momoNumber.trim(),
          momoAccountName: momoAccountName.trim()
        });
        return;
      }
      onSubmit({
        type: "withdrawal",
        reason: trimmedReason,
        amount: parsed,
        fulfillmentMode
      });
      return;
    }
    onSubmit({ type: "balance", reason: trimmedReason });
  }

  const amountValid =
    requestType === "balance" || (Number(amount) > 0 && Number.isFinite(Number(amount)));
  const momoValid =
    fulfillmentMode !== "momo" || (Boolean(normalizedPhone) && momoAccountName.trim().length > 0);
  const nameMismatch =
    lookupState.status === "verified" && !namesLikelyMatch(customerName, lookupState.accountName);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request from coordinator"
      subtitle={
        customerName
          ? `Choose what you need for ${customerName}. Your coordinator must approve first.`
          : "Balance view or withdrawal — coordinator approval required."
      }
    >
      <form className="agent-balance-request-form" onSubmit={handleSubmit}>
        {priorDeclineReason ? (
          <p className="agent-balance-request-declined muted">
            Previous request declined: {priorDeclineReason}
          </p>
        ) : null}

        <fieldset className="agent-request-type-fieldset">
          <legend className="agent-request-type-legend">Request type</legend>
          <label className="agent-request-type-option">
            <input
              type="radio"
              name="requestType"
              value="balance"
              checked={requestType === "balance"}
              onChange={() => setRequestType("balance")}
              disabled={submitting}
            />
            <span>
              <strong>View balance</strong>
              <small className="muted">Visible for 6 hours after approval</small>
            </span>
          </label>
          <label className="agent-request-type-option">
            <input
              type="radio"
              name="requestType"
              value="withdrawal"
              checked={requestType === "withdrawal"}
              onChange={() => setRequestType("withdrawal")}
              disabled={submitting}
            />
            <span>
              <strong>Request withdrawal</strong>
              <span className="muted">
                {" "}
                — opening savings deposit cannot be withdrawn
              </span>
              <small className="muted">Customer wants money from their account</small>
            </span>
          </label>
        </fieldset>

        {requestType === "withdrawal" ? (
          <>
            <label className="field">
              <span>Amount (GHS)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50.00"
                required
                disabled={submitting}
              />
            </label>

            <fieldset className="agent-request-type-fieldset">
              <legend className="agent-request-type-legend">How will customer receive it?</legend>
              {FULFILLMENT_OPTIONS.map((opt) => (
                <label className="agent-request-type-option" key={opt.id}>
                  <input
                    type="radio"
                    name="fulfillmentMode"
                    value={opt.id}
                    checked={fulfillmentMode === opt.id}
                    onChange={() => setFulfillmentMode(opt.id)}
                    disabled={submitting}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <small className="muted">{opt.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {fulfillmentMode === "momo" ? (
              <div className="agent-momo-box">
                <label className="field">
                  <span>MoMo network</span>
                  <select
                    value={momoNetwork}
                    onChange={(e) => handleNetworkChange(e.target.value as MomoNetworkCode)}
                    disabled={submitting}
                  >
                    {MOMO_NETWORKS.map((net) => (
                      <option key={net.code} value={net.code}>
                        {net.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Customer MoMo number</span>
                  <div className="agent-momo-phone-row">
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={12}
                      autoComplete="tel-national"
                      value={momoNumber}
                      onChange={(e) => handleMomoNumberChange(e.target.value)}
                      placeholder="e.g. 0244123456"
                      required
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="button secondary compact"
                      disabled={submitting || !normalizedPhone || lookupState.status === "loading"}
                      onClick={() => {
                        if (normalizedPhone) {
                          void runMomoLookup(normalizedPhone, momoNetwork);
                        }
                      }}
                    >
                      {lookupState.status === "loading" ? "Checking…" : "Verify"}
                    </button>
                  </div>
                </label>

                {lookupState.status === "loading" ? (
                  <p className="agent-momo-status agent-momo-status--loading" role="status">
                    Looking up MoMo account name…
                  </p>
                ) : null}

                {lookupState.status === "verified" ? (
                  <p className="agent-momo-status agent-momo-status--verified" role="status">
                    ✓ Verified ({lookupState.networkLabel}): <strong>{lookupState.accountName}</strong>
                  </p>
                ) : null}

                {nameMismatch ? (
                  <p className="agent-momo-status agent-momo-status--warn" role="alert">
                    MoMo name differs from customer profile ({customerName}). Confirm with the customer before sending.
                  </p>
                ) : null}

                {lookupState.status === "fallback" ? (
                  <p className="agent-momo-status agent-momo-status--fallback" role="status">
                    {lookupState.message}
                  </p>
                ) : null}

                <label className="field">
                  <span>Name on MoMo account</span>
                  <input
                    value={momoAccountName}
                    onChange={(e) => setMomoAccountName(e.target.value)}
                    placeholder="Auto-filled on verify, or enter manually"
                    required
                    disabled={submitting}
                  />
                </label>
              </div>
            ) : null}
          </>
        ) : null}

        <label className="field">
          <span>Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this needed?"
            required
            minLength={3}
            disabled={submitting}
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="button"
            disabled={submitting || reason.trim().length < 3 || !amountValid || !momoValid}
          >
            {submitting ? "Sending…" : "Send for approval"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
