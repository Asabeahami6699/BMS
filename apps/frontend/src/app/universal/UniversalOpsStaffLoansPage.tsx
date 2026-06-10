import { UniversalOpsFeatureGrid, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsStaffLoansPage({ displayName }: Props) {
  return (
    <UniversalOpsShell
      title="Staff Loan Portal"
      subtitle="Apply for staff loans and monitor repayments from your payslip."
      displayName={displayName}
      actions={
        <button type="button" className="button primary">
          Apply for loan
        </button>
      }
    >
      <section className="card universal-ops__kpi-row">
        <div className="universal-ops__kpi">
          <span className="muted">Outstanding balance</span>
          <strong>GHS —</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Monthly deduction</span>
          <strong>GHS —</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Next instalment</span>
          <strong>—</strong>
        </div>
        <div className="universal-ops__kpi">
          <span className="muted">Loan status</span>
          <strong>None active</strong>
        </div>
      </section>

      <section className="card stack-form">
        <h3>Loan application</h3>
        <p className="muted">Loan amount, purpose, repayment period, and supporting notes.</p>
        <div className="form-grid">
          <label className="field">
            <span>Loan amount (GHS)</span>
            <input type="number" min={0} placeholder="e.g. 5000" disabled />
          </label>
          <label className="field">
            <span>Repayment period (months)</span>
            <input type="number" min={1} placeholder="e.g. 12" disabled />
          </label>
        </div>
        <label className="field">
          <span>Purpose</span>
          <input type="text" placeholder="e.g. School fees" disabled />
        </label>
        <label className="field">
          <span>Supporting notes</span>
          <textarea rows={3} placeholder="Optional context for HR review" disabled />
        </label>
      </section>

      <UniversalOpsFeatureGrid
        items={[
          { title: "Repayment schedule", description: "Instalment dates and amounts until closure." },
          { title: "Loan status", description: "Draft, under review, approved, or declined." },
          { title: "Payslip deduction", description: "See how much is recovered each payroll run." }
        ]}
      />
    </UniversalOpsShell>
  );
}
