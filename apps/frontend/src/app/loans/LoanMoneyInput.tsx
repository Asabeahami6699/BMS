import { useEffect, useState } from "react";
import { formatMoneyInput, parseMoneyInput, sanitizeMoneyTyping } from "./loanUi";

type Props = {
  value: string;
  onChange: (displayValue: string, numericValue: number) => void;
  required?: boolean;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  max?: number;
};

export function LoanMoneyInput({
  value,
  onChange,
  required,
  placeholder = "0.00",
  id,
  disabled,
  max
}: Props) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    setDisplay(value);
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className="loans-money-input"
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      value={display}
      onChange={(e) => {
        const next = sanitizeMoneyTyping(e.target.value);
        setDisplay(next);
        const parsed = parseMoneyInput(next);
        onChange(next, parsed);
      }}
      onBlur={() => {
        const parsed = parseMoneyInput(display);
        if (Number.isFinite(parsed) && parsed > 0) {
          let final = parsed;
          if (max != null && final > max) {
            final = max;
          }
          const formatted = formatMoneyInput(final);
          setDisplay(formatted);
          onChange(formatted, final);
        }
      }}
    />
  );
}
