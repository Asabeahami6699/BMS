import { FormEvent, useMemo, useState } from "react";
import { calculateStaffLoanMonthlyDeduction } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable } from "../../components/AdminDataTable";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

function formatMoney(value?: number | null): string {
  if (value == null) {
    return "—";
  }
  return `GHS ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function UniversalOpsStaffLoansPage({ displayName }: Props) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState("12");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  useUniversalOpsLiveSync({ scope: "loans" });

  const { loans, loading, actionBusy, applyLoan, refreshLoans } = useUniversalOpsStore(
    useShallow((s) => ({
      loans: s.staffLoans,
      loading: s.loansLoading,
      actionBusy: s.actionBusy,
      applyLoan: s.applyLoan,
      refreshLoans: s.refreshLoans
    }))
  );

  const activeLoan = useMemo(
    () => loans.find((l) => l.status === "active" || l.status === "approved" || l.status === "pending"),
    [loans]
  );

  const previewDeduction = useMemo(() => {
    const parsedAmount = Number(amount);
    const parsedTerm = Number(termMonths);
    if (!parsedAmount || !parsedTerm) {
      return null;
    }
    return calculateStaffLoanMonthlyDeduction(parsedAmount, parsedTerm);
  }, [amount, termMonths]);

  function closeModal() {
    setModalOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(amount);
    const parsedTerm = Number(termMonths);
    if (!parsedAmount || !parsedTerm || !purpose.trim()) {
      return;
    }
    try {
      await applyLoan({
        amount: parsedAmount,
        purpose: purpose.trim(),
        termMonths: parsedTerm,
        notes: notes.trim() || undefined
      });
      showToast("Loan application submitted", "success");
      closeModal();
      setAmount("");
      setPurpose("");
      setNotes("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to apply", "error");
    }
  }

  return (
    <>
      <UniversalOpsShell
        title="Staff Loan Portal"
        subtitle="Apply for staff loans and monitor repayments from your payslip."
        displayName={displayName}
        actions={
          <div className="universal-ops__actions">
            <button type="button" className="button primary" onClick={() => setModalOpen(true)}>
              Apply for loan
            </button>
            <button type="button" className="button secondary" onClick={() => void refreshLoans()}>
              Refresh
            </button>
          </div>
        }
      >
        <section className="card universal-ops__kpi-row">
          <div className="universal-ops__kpi">
            <span className="muted">Outstanding balance</span>
            <strong>{formatMoney(activeLoan?.outstandingBalance ?? activeLoan?.amount)}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Monthly deduction</span>
            <strong>{formatMoney(activeLoan?.monthlyDeduction)}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Term</span>
            <strong>{activeLoan ? `${activeLoan.termMonths} months` : "—"}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Loan status</span>
            <strong>{activeLoan?.status ?? "None active"}</strong>
          </div>
        </section>

        <AdminDataTable
          variant="desk"
          title="Loan history"
          subtitle="Applications and repayment schedules."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search purpose or status…"
          columns={[
            { key: "amount", label: "Amount" },
            { key: "purpose", label: "Purpose" },
            { key: "term", label: "Term" },
            { key: "monthly", label: "Monthly" },
            { key: "status", label: "Status" }
          ]}
          rows={loans.map((l) => ({
            id: l.id,
            amount: formatMoney(l.amount),
            purpose: l.purpose,
            term: `${l.termMonths} mo`,
            monthly: formatMoney(l.monthlyDeduction),
            status: l.status
          }))}
          rowKey={(r) => r.id}
          emptyMessage={loading ? "Loading…" : "No loan applications yet."}
        />

        <UniversalOpsQuickLinks excludePath="operations/staff-loans" />
      </UniversalOpsShell>

      <Modal
        open={modalOpen}
        title="Apply for staff loan"
        subtitle="HR will review your request and set the monthly payslip deduction."
        onClose={closeModal}
        panelClassName="modal-panel--narrow"
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="button secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" form="staff-loan-apply-form" className="button primary" disabled={actionBusy}>
              {actionBusy ? "Submitting…" : "Submit application"}
            </button>
          </div>
        }
      >
        <form id="staff-loan-apply-form" className="stack-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="field">
              <span>Loan amount (GHS)</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000"
                required
              />
            </label>
            <label className="field">
              <span>Repayment period (months)</span>
              <input
                type="number"
                min={1}
                max={60}
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                required
              />
            </label>
          </div>
          {previewDeduction != null ? (
            <p className="muted">Estimated monthly deduction: {formatMoney(previewDeduction)}</p>
          ) : null}
          <label className="field">
            <span>Purpose</span>
            <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. School fees" required />
          </label>
          <label className="field">
            <span>Supporting notes</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional context for HR review" />
          </label>
        </form>
      </Modal>
    </>
  );
}
