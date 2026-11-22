import { formatAccountAmount } from "@bms/shared";
import { useEffect, useState } from "react";

/** Parse a comma-formatted accounting string (e.g. "1,250.50") into a finite number, or NaN if empty/invalid. */
export function parseAccountingAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) {
    return Number.NaN;
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : Number.NaN;
}

/** Format a number as a strict 2-decimal accounting figure with thousands separators (e.g. "1,250.00"). */
export function formatAccountingInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }
  return formatAccountAmount(value);
}

/** Allow digits, commas, and at most one decimal point with up to 2 decimal places while typing. */
function sanitizeAccountingTyping(raw: string): string {
  let value = raw.replace(/[^\d.,]/g, "");
  const firstDot = value.indexOf(".");
  if (firstDot >= 0) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "");
    const [whole, dec = ""] = value.split(".");
    value = `${whole}.${dec.slice(0, 2)}`;
  }
  return value;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** When false, clearing the field keeps it empty on blur instead of snapping to "0.00". */
  allowEmpty?: boolean;
  currencyPrefix?: string;
};

export function AccountingAmountInput({
  value,
  onChange,
  placeholder = "0.00",
  required = false,
  disabled = false,
  autoFocus = false,
  allowEmpty = false,
  currencyPrefix = "GHS"
}: Props) {
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => {
    if (!focused) {
      setLocal(value);
    }
  }, [value, focused]);

  return (
    <div className="accounting-input-wrap">
      {currencyPrefix ? (
        <span className="accounting-input-wrap__prefix" aria-hidden="true">
          {currencyPrefix}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="accounting-input"
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={local}
        onFocus={(e) => {
          setFocused(true);
          // Strip thousands separators while actively editing so cursor movement is effortless.
          const stripped = local.replace(/,/g, "");
          setLocal(stripped);
          // Select whole value on focus so overwriting "0.00" takes a single keystroke.
          window.requestAnimationFrame(() => {
            e.target.select();
          });
        }}
        onChange={(e) => {
          const next = sanitizeAccountingTyping(e.target.value);
          setLocal(next);
          onChange(next);
        }}
        onBlur={() => {
          setFocused(false);
          const trimmed = local.trim();
          if (!trimmed) {
            if (allowEmpty) {
              setLocal("");
              onChange("");
            } else {
              const zero = formatAccountingInput(0);
              setLocal(zero);
              onChange(zero);
            }
            return;
          }
          const parsed = parseAccountingAmount(trimmed);
          if (Number.isFinite(parsed) && parsed >= 0) {
            const formatted = formatAccountingInput(parsed);
            setLocal(formatted);
            onChange(formatted);
          } else if (allowEmpty) {
            setLocal("");
            onChange("");
          } else {
            const zero = formatAccountingInput(0);
            setLocal(zero);
            onChange(zero);
          }
        }}
      />
    </div>
  );
}
