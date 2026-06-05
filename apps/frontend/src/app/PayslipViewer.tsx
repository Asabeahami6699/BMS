import type { Payslip } from "./api";

type Props = {
  payslip: Payslip;
  title?: string;
  subtitle?: string;
};

function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayslipViewer({ payslip, title, subtitle }: Props) {
  return (
    <article className="payslip-viewer payroll-panel-inner">
      <header className="payslip-viewer__head">
        <div>
          {title ? <h3>{title}</h3> : null}
          {subtitle ? <p className="muted">{subtitle}</p> : null}
          <p className="muted payslip-viewer__period">Period · {payslip.periodId}</p>
          {payslip.runAt ? (
            <p className="muted payslip-viewer__run">
              Published · {new Date(payslip.runAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="payslip-viewer__net-badge">
          <span className="muted">Net pay</span>
          <strong>{formatMoney(payslip.netPay)}</strong>
        </div>
      </header>

      <div className="payslip-viewer__grid">
        <section className="payslip-viewer__section">
          <h4>Earnings</h4>
          <ul className="payslip-viewer__lines">
            {payslip.lines.map((line) => (
              <li key={line.key}>
                <span>{line.label}</span>
                <strong>{formatMoney(line.amount)}</strong>
              </li>
            ))}
          </ul>
          <div className="payslip-viewer__subtotal">
            <span>Gross pay</span>
            <strong>{formatMoney(payslip.grossPay)}</strong>
          </div>
        </section>

        <section className="payslip-viewer__section payslip-viewer__section--deductions">
          <h4>Deductions</h4>
          {payslip.deductionLines.length > 0 ? (
            <>
              <ul className="payslip-viewer__lines">
                {payslip.deductionLines.map((line) => (
                  <li key={line.key}>
                    <span>{line.label}</span>
                    <strong className="deduction-amount">−{formatMoney(line.amount)}</strong>
                  </li>
                ))}
              </ul>
              <div className="payslip-viewer__subtotal">
                <span>Total deductions</span>
                <strong className="deduction-amount">−{formatMoney(payslip.totalDeductions)}</strong>
              </div>
            </>
          ) : (
            <p className="muted">No deductions configured for this staff member.</p>
          )}
        </section>
      </div>

      <footer className="payslip-viewer__footer">
        <span>Take-home pay</span>
        <strong>{formatMoney(payslip.netPay)}</strong>
      </footer>
    </article>
  );
}
