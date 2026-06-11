import { FormEvent, useEffect, useState } from "react";
import type { HrStaffLoan } from "@bms/shared";
import { calculateStaffLoanMonthlyDeduction } from "@bms/shared";
import { Modal } from "../../../components/Modal";

type Props = {
  open: boolean;
  loan: HrStaffLoan | null;
  busy?: boolean;
  onClose: () => void;
  onApprove: (monthlyDeduction: number) => void;
  onDecline: () => void;
};

function formatMoney(value: number): string {
  return `GHS ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function StaffLoanApprovalModal({ open, loan, busy, onClose, onApprove, onDecline }: Props) {
  const [monthlyDeduction, setMonthlyDeduction] = useState("");

  useEffect(() => {
    if (!loan) {
      return;
    }
    setMonthlyDeduction(String(calculateStaffLoanMonthlyDeduction(loan.amount, loan.termMonths)));
  }, [loan]);

  function handleApprove(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(monthlyDeduction);
    if (!parsed || parsed <= 0) {
      return;
    }
    onApprove(parsed);
  }

  if (!loan) {
    return null;
  }

  const suggested = calculateStaffLoanMonthlyDeduction(loan.amount, loan.termMonths);

  return (
    <Modal
      open={open}
      title="Approve staff loan"
      subtitle={`${loan.userName ?? loan.userId} · ${formatMoney(loan.amount)} over ${loan.termMonths} months`}
      onClose={onClose}
      panelClassName="modal-panel--narrow"
      footer={
        <div className="modal-footer-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onDecline}>
            Decline
          </button>
          <button type="submit" form="staff-loan-approve-form" className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Approve loan"}
          </button>
        </div>
      }
    >
      <form id="staff-loan-approve-form" className="stack-form" onSubmit={handleApprove}>
        <p className="muted">
          <strong>Purpose:</strong> {loan.purpose}
        </p>
        {loan.notes ? (
          <p className="muted">
            <strong>Notes:</strong> {loan.notes}
          </p>
        ) : null}
        <label className="field">
          <span>Monthly payroll deduction (GHS)</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={monthlyDeduction}
            onChange={(e) => setMonthlyDeduction(e.target.value)}
            required
          />
        </label>
        <p className="muted">
          Suggested: {formatMoney(suggested)} ({formatMoney(loan.amount)} ÷ {loan.termMonths} months)
        </p>
      </form>
    </Modal>
  );
}
