import { useEffect, useMemo, useRef, useState } from "react";
import {
  isMomoBankProduct,
  isSavingsDepositBankProduct,
  isSusuDepositBankProduct,
  type BankProductWorkflowField,
  type TenantBankProduct
} from "@bms/shared";
import {
  listGhanaBanks,
  resolveBankAccountName,
  resolveMomoAccountName,
  type BankAccountLookupResult,
  type GhanaBankOption,
  type MomoNetworkCode
} from "../api";
import {
  detectGhanaMomoNetwork,
  isCompleteGhanaMomoPhone,
  MOMO_NETWORK_OPTIONS,
  namesRoughlyMatch,
  parseMomoNetworkLabel
} from "../../lib/momoPhone";
import { toUserFacingError } from "../../lib/networkError";

type Props = {
  product: TenantBankProduct | undefined;
  fields: BankProductWorkflowField[];
  accountNumber: string;
  currentAccountHolderName: string;
  disabled?: boolean;
  onApplyAccountHolderName: (name: string) => void;
};

function isInternalBmsLabel(bankLabel: string): boolean {
  const norm = bankLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return norm === "bms" || norm.startsWith("bms") || norm === "aabanker" || norm.startsWith("aabanker");
}

export function isExternalPartnerProduct(product: TenantBankProduct | undefined): boolean {
  if (!product) return false;
  if (isMomoBankProduct(product)) return true;
  if (isInternalBmsLabel(product.bankLabel)) return false;
  if (product.direction === "deposit") {
    if (isSusuDepositBankProduct(product) || isSavingsDepositBankProduct(product)) {
      return false;
    }
  }
  return Boolean(product.bankLabel.trim());
}

export function PartnerAccountVerifyBar({
  product,
  fields,
  accountNumber,
  currentAccountHolderName,
  disabled,
  onApplyAccountHolderName
}: Props) {
  const isEligible = useMemo(() => {
    if (!isExternalPartnerProduct(product)) return false;
    const keys = new Set(fields.map((f) => f.key));
    return keys.has("account_number") && keys.has("account_holder_name");
  }, [product, fields]);

  const isMomo = Boolean(product && isMomoBankProduct(product));
  const cleanDigits = accountNumber.replace(/\D/g, "");

  const [momoNetwork, setMomoNetwork] = useState<MomoNetworkCode>("MTN");
  const [momoNetworkManual, setMomoNetworkManual] = useState(false);
  const [ghanaBanks, setGhanaBanks] = useState<GhanaBankOption[]>([]);
  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BankAccountLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seqRef = useRef(0);
  const lastLookupKeyRef = useRef<string | null>(null);
  const lastAutoFilledNameRef = useRef<string | null>(null);

  // Reset verification state when switching bank products
  useEffect(() => {
    seqRef.current += 1;
    lastLookupKeyRef.current = null;
    lastAutoFilledNameRef.current = null;
    setResult(null);
    setError(null);
    setSelectedBankCode("");
    const labelLower = (product?.bankLabel ?? "").trim().toLowerCase();
    const needsPicker = !isMomo && (!labelLower || labelLower === "other");
    setShowBankPicker(needsPicker);
    setMomoNetworkManual(false);
    const parsed = parseMomoNetworkLabel(product?.bankLabel ?? product?.name);
    if (parsed) {
      setMomoNetwork(parsed);
    }
  }, [product?.id, product?.bankLabel, product?.name, isMomo]);

  // Lazily fetch Paystack Ghana bank list only if needed (e.g. bankLabel === "Other" or unmatched)
  useEffect(() => {
    if (!isEligible || isMomo || !showBankPicker || ghanaBanks.length > 0) {
      return;
    }
    let cancelled = false;
    void listGhanaBanks()
      .then((res) => {
        if (!cancelled && res.banks.length > 0) {
          setGhanaBanks(res.banks);
        }
      })
      .catch(() => {
        // Non-blocking fallback
      });
    return () => {
      cancelled = true;
    };
  }, [isEligible, isMomo, showBankPicker, ghanaBanks.length]);

  // Auto-detect MoMo network from prefix when user hasn't manually overridden it
  useEffect(() => {
    if (!isMomo || momoNetworkManual) return;
    const detected = detectGhanaMomoNetwork(cleanDigits);
    if (detected && detected !== momoNetwork) {
      setMomoNetwork(detected);
    }
  }, [isMomo, momoNetworkManual, cleanDigits, momoNetwork]);

  // Clear stale verification result when account number changes
  useEffect(() => {
    if (result && result.accountNumber.replace(/\D/g, "") !== cleanDigits) {
      setResult(null);
      setError(null);
      lastLookupKeyRef.current = null;
    }
  }, [cleanDigits, result]);

  async function runVerify(overrideNetwork?: MomoNetworkCode, overrideBankCode?: string) {
    if (!product || !isEligible) return;
    if (isMomo) {
      if (!isCompleteGhanaMomoPhone(cleanDigits)) {
        setError("Enter a complete 10-digit Ghana mobile number first.");
        return;
      }
      const net = overrideNetwork ?? momoNetwork;
      const key = `momo:${net}:${cleanDigits}`;
      const seq = ++seqRef.current;
      setBusy(true);
      setError(null);
      try {
        const res = await resolveMomoAccountName(cleanDigits, net);
        if (seq !== seqRef.current) return;
        const unified: BankAccountLookupResult = {
          configured: res.configured,
          verified: res.verified,
          kind: "momo",
          accountNumber: res.phone,
          bankCode: res.network,
          bankName: res.networkLabel,
          accountName: res.accountName,
          message: res.message
        };
        setResult(unified);
        lastLookupKeyRef.current = key;
        if (unified.verified && unified.accountName) {
          const trimmedCurrent = currentAccountHolderName.trim();
          if (!trimmedCurrent || trimmedCurrent === lastAutoFilledNameRef.current) {
            onApplyAccountHolderName(unified.accountName);
            lastAutoFilledNameRef.current = unified.accountName;
          }
        }
      } catch (err) {
        if (seq !== seqRef.current) return;
        setResult(null);
        setError(toUserFacingError(err, "Could not verify MoMo account"));
      } finally {
        if (seq === seqRef.current) {
          setBusy(false);
        }
      }
      return;
    }

    // Bank account lookup
    if (cleanDigits.length < 6) {
      setError("Enter at least 6 digits of the bank account number first.");
      return;
    }
    const code = (overrideBankCode ?? selectedBankCode).trim() || undefined;
    const bankName = product.bankLabel.trim() || undefined;
    const key = `bank:${code ?? bankName ?? ""}:${cleanDigits}`;
    const seq = ++seqRef.current;
    setBusy(true);
    setError(null);
    try {
      const res = await resolveBankAccountName(cleanDigits, {
        bankCode: code,
        bankName: code ? undefined : bankName
      });
      if (seq !== seqRef.current) return;
      setResult(res);
      lastLookupKeyRef.current = key;
      if (!res.verified && !res.bankCode && res.configured) {
        setShowBankPicker(true);
      }
      if (res.verified && res.accountName) {
        const trimmedCurrent = currentAccountHolderName.trim();
        if (!trimmedCurrent || trimmedCurrent === lastAutoFilledNameRef.current) {
          onApplyAccountHolderName(res.accountName);
          lastAutoFilledNameRef.current = res.accountName;
        }
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      setResult(null);
      setError(toUserFacingError(err, "Could not verify bank account"));
    } finally {
      if (seq === seqRef.current) {
        setBusy(false);
      }
    }
  }

  // Auto-verify MoMo numbers once 10 digits are entered (debounced 350ms)
  useEffect(() => {
    if (!isEligible || !isMomo || disabled) return;
    if (!isCompleteGhanaMomoPhone(cleanDigits)) return;
    const key = `momo:${momoNetwork}:${cleanDigits}`;
    if (lastLookupKeyRef.current === key) return;

    const timer = window.setTimeout(() => {
      void runVerify(momoNetwork);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEligible, isMomo, disabled, cleanDigits, momoNetwork]);

  if (!isEligible || !product) {
    return null;
  }

  const canVerify = isMomo
    ? isCompleteGhanaMomoPhone(cleanDigits)
    : cleanDigits.length >= 6 && (!showBankPicker || Boolean(selectedBankCode));

  const verifiedName = result?.verified ? result.accountName : null;
  const currentTrimmed = currentAccountHolderName.trim();
  const hasMismatch = Boolean(
    verifiedName && currentTrimmed && !namesRoughlyMatch(verifiedName, currentTrimmed)
  );
  const differsFromCurrent = Boolean(
    verifiedName && currentTrimmed && verifiedName.toLowerCase() !== currentTrimmed.toLowerCase()
  );

  return (
    <div className="partner-verify-bar" aria-live="polite">
      <div className="partner-verify-bar__head">
        <div>
          <span className="partner-verify-bar__eyebrow">
            {isMomo ? "MoMo account name lookup" : `${product.bankLabel} account name lookup`}
          </span>
          <span className="muted partner-verify-bar__hint">
            {isMomo
              ? "Enter a 10-digit MoMo number below to auto-verify the registered name."
              : "Enter the partner bank account number below, then verify the account holder name."}
          </span>
        </div>

        <div className="partner-verify-bar__controls">
          {isMomo ? (
            <select
              aria-label="MoMo network"
              className="momo-lookup-network"
              value={momoNetwork}
              disabled={disabled || busy}
              onChange={(e) => {
                const next = e.target.value as MomoNetworkCode;
                setMomoNetwork(next);
                setMomoNetworkManual(true);
                setResult(null);
                setError(null);
                lastLookupKeyRef.current = null;
                if (isCompleteGhanaMomoPhone(cleanDigits)) {
                  void runVerify(next);
                }
              }}
            >
              {MOMO_NETWORK_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : showBankPicker ? (
            <select
              aria-label="Partner Ghana bank"
              className="partner-verify-bar__bank-select"
              value={selectedBankCode}
              disabled={disabled || busy}
              onChange={(e) => {
                setSelectedBankCode(e.target.value);
                setResult(null);
                setError(null);
                lastLookupKeyRef.current = null;
              }}
            >
              <option value="">Select Ghana bank…</option>
              {ghanaBanks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            className="button secondary momo-lookup-btn"
            disabled={disabled || busy || !canVerify}
            onClick={() => void runVerify()}
          >
            {busy ? "Verifying…" : "Verify account name"}
          </button>
        </div>
      </div>

      {busy ? (
        <div className="momo-lookup-status momo-lookup-status--loading">
          Looking up registered account holder name…
        </div>
      ) : verifiedName ? (
        <div className="momo-lookup-status momo-lookup-status--verified">
          <span>✓</span>
          <span>
            Verified ({result?.bankName}): <strong>{verifiedName}</strong>
          </span>
          {differsFromCurrent ? (
            <button
              type="button"
              className="partner-verify-bar__apply-btn"
              onClick={() => {
                onApplyAccountHolderName(verifiedName);
                lastAutoFilledNameRef.current = verifiedName;
              }}
            >
              Use verified name
            </button>
          ) : null}
        </div>
      ) : error ? (
        <div className="momo-lookup-status momo-lookup-status--warn">{error}</div>
      ) : result && !result.verified && result.message ? (
        <div className="momo-lookup-status momo-lookup-status--warn">{result.message}</div>
      ) : null}

      {hasMismatch ? (
        <div className="momo-lookup-status momo-lookup-status--danger">
          Entered holder name (<strong>{currentTrimmed}</strong>) does not match verified bank record (
          <strong>{verifiedName}</strong>). Confirm before posting.
        </div>
      ) : null}
    </div>
  );
}
