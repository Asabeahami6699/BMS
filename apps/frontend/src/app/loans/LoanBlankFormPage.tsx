import type { AppRole } from "../api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { LoansLayout } from "./LoansLayout";
import { downloadBlankLoanFormHtml, printBlankLoanForm } from "./loanPrint";

type Props = { role: AppRole; companyName?: string };

export function LoanBlankFormPage({ role: _role, companyName }: Props) {
  const { showToast } = useToast();

  function handlePrint() {
    try {
      printBlankLoanForm(companyName);
    } catch (err) {
      showToast(toUserFacingError(err, "Could not open print view"), "error");
    }
  }

  function handleDownload() {
    downloadBlankLoanFormHtml(companyName);
    showToast("Blank form downloaded — open in a browser and print to PDF", "success");
  }

  return (
    <LoansLayout
      activeNav="overview"
      title="Loan application form"
      subtitle="Official blank form for walk-in applicants or offline collection."
      actions={
        <>
          <button type="button" className="button secondary" onClick={handleDownload}>
            Download HTML
          </button>
          <button type="button" className="button primary" onClick={handlePrint}>
            Print blank form
          </button>
        </>
      }
    >
      <section className="card loans-animate-in">
        <h3>Document structure</h3>
        <p className="muted">
          The printable form follows the same sections used in the digital application workflow. Companies
          can download the HTML file, open it in any browser, fill it by hand or digitally, then save as PDF
          via Print → Save as PDF.
        </p>
        <ol className="loans-form-outline">
          <li>
            <strong>Section A — Applicant personal details</strong> — passport photo, ID photo, contact and
            address
          </li>
          <li>
            <strong>Section B — Employment &amp; income</strong> — occupation, employer, monthly income and
            expenses
          </li>
          <li>
            <strong>Section C — Loan request</strong> — product, amount, term, repayment, purpose
          </li>
          <li>
            <strong>Section D — Guarantor</strong> — guarantor identity and income
          </li>
          <li>
            <strong>Section E — Next of kin</strong> — emergency contact
          </li>
          <li>
            <strong>Section F — Office use only</strong> — credit decision, approval dates, signatures
          </li>
        </ol>
        <p className="field-hint muted">
          After a loan is approved in BMS, open the application record and use <strong>Print loan record</strong>{" "}
          for the official outcome document with decision and dates filled in.
        </p>
      </section>
    </LoansLayout>
  );
}
