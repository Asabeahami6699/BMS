import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";

const GHS_DENOMINATIONS = [
  { value: 200, label: "GHS 200" },
  { value: 100, label: "GHS 100" },
  { value: 50, label: "GHS 50" },
  { value: 20, label: "GHS 20" },
  { value: 10, label: "GHS 10" },
  { value: 5, label: "GHS 5" },
  { value: 2, label: "GHS 2" },
  { value: 1, label: "GHS 1" },
  { value: 0.5, label: "GHS 0.50" },
  { value: 0.2, label: "GHS 0.20" },
  { value: 0.1, label: "GHS 0.10" },
  { value: 0.05, label: "GHS 0.05" },
  { value: 0.01, label: "GHS 0.01" }
] as const;

function parseCount(raw: string): number {
  if (!raw.trim()) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (amount: number) => void;
};

export function BranchCounterCashCalculator({ open, onClose, onApply }: Props) {
  const [counts, setCounts] = useState<Record<number, string>>({});

  useEffect(() => {
    if (open) {
      setCounts({});
    }
  }, [open]);

  const rows = useMemo(
    () =>
      GHS_DENOMINATIONS.map((denom) => {
        const qty = parseCount(counts[denom.value] ?? "");
        return {
          ...denom,
          qty,
          subtotal: denom.value * qty
        };
      }),
    [counts]
  );

  const total = rows.reduce((sum, row) => sum + row.subtotal, 0);

  function handleDone() {
    if (total <= 0) {
      return;
    }
    onApply(total);
  }

  return (
    <Modal
      open={open}
      title="Cash calculator"
      subtitle="Count notes and coins by denomination. Done fills the transaction amount."
      onClose={onClose}
      panelClassName="branch-counter-calc-modal"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" disabled={total <= 0} onClick={handleDone}>
            Done · GHS {formatMoney(total)}
          </button>
        </>
      }
    >
      <div className="branch-counter-calc">
        <div className="branch-counter-calc__head" role="row">
          <span role="columnheader">Denomination</span>
          <span role="columnheader">Qty</span>
          <span role="columnheader">Subtotal</span>
        </div>
        <div className="branch-counter-calc__rows">
          {rows.map((row) => (
            <div key={row.value} className="branch-counter-calc__row" role="row">
              <span className="branch-counter-calc__denom" role="cell">
                {row.label}
              </span>
              <label className="branch-counter-calc__qty-field" role="cell">
                <span className="sr-only">Quantity for {row.label}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="input-no-spin branch-counter-calc__qty"
                  placeholder="0"
                  value={counts[row.value] ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "" || /^\d+$/.test(next)) {
                      setCounts((prev) => ({ ...prev, [row.value]: next }));
                    }
                  }}
                />
              </label>
              <span className="branch-counter-calc__subtotal" role="cell">
                GHS {formatMoney(row.subtotal)}
              </span>
            </div>
          ))}
        </div>
        <div className="branch-counter-calc__total">
          <span>Total cash</span>
          <strong>GHS {formatMoney(total)}</strong>
        </div>
      </div>
    </Modal>
  );
}
