import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LoanApplication, LoanScheduleInstallment } from "@bms/shared";
import type { AppRole, AuthMe, Branch, LoanDetail } from "./api";
import {
  approveLoanApplication,
  disburseLoan,
  getAuthMe,
  getLoanDetail,
  listBranches,
  recordLoanRepayment,
  rejectLoanApplication
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { LoanStatusTimeline } from "./loans/LoanStatusTimeline";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { LoansLayout } from "./loans/LoansLayout";
import {
  estimateAffordabilityRatio,
  formatLoanDate,
  formatLoanDateTime,
  formatLoanMoney,
  frequencyLabel,
  loanIncomeSourceLabel,
  loanPurposeLabel,
  LOAN_STATUS_LABELS,
  LOAN_STATUS_PILL,
  SCHEDULE_STATUS_LABELS,
  SCHEDULE_STATUS_PILL,
  customerDisplayName,
  parseMoneyInput
} from "./loans/loanUi";
import { LoanMoneyInput } from "./loans/LoanMoneyInput";
import { useLoansStore } from "./stores/loansStore";
import { usePageLoading } from "./hooks/usePageLoading";
import { applicationToReviewSnapshot } from "./loans/loanDocument";
import { printLoanDocument } from "./loans/loanPrint";

type Props = { role: AppRole };

export function LoanDetailPage({ role: _role }: Props) {
  const { loanId } = useParams<{ loanId: string }>();
  const { showToast } = useToast();
  const patchStoreApplication = useLoansStore((s) => s.patchApplication);
  const { canApprove, canDisburse, canRecordRepayment } = useLoanPermissions();

  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayAmountNum, setRepayAmountNum] = useState(NaN);
  const [repayBranchId, setRepayBranchId] = useState("");

  usePageLoading(loading || busy, "loan-detail");

  const load = useCallback(async () => {
    if (!loanId) {
      return;
    }
    setLoading(true);
    try {
      const [detailRow, branchRows, meRow] = await Promise.all([
        getLoanDetail(loanId),
        listBranches(),
        getAuthMe()
      ]);
      setDetail(detailRow);
      setBranches(branchRows.filter((b) => b.status !== "inactive"));
      setMe(meRow);
      if (meRow.scopeType === "branch" && meRow.branchId) {
        setRepayBranchId(meRow.branchId);
      }
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to load loan"), "error");
    } finally {
      setLoading(false);
    }
  }, [loanId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const app = detail?.application;
  const customer = detail?.customer;
  const schedule = detail?.schedule ?? [];
  const repayments = detail?.repayments ?? [];
  const branchLocked = me?.scopeType === "branch" && Boolean(me.branchId);

  const nextInstallment = useMemo(() => {
    return [...schedule]
      .filter((s) => s.status !== "paid")
      .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
  }, [schedule]);

  const nextInstallmentDue = useMemo(() => {
    if (!nextInstallment) {
      return 0;
    }
    return Math.round((nextInstallment.amountDue - nextInstallment.amountPaid) * 100) / 100;
  }, [nextInstallment]);

  const progressPct = useMemo(() => {
    if (!app || !app.totalRepayable) {
      return 0;
    }
    return Math.min(100, Math.round((app.totalRepaid / app.totalRepayable) * 100));
  }, [app]);

  const affordabilityPct = useMemo(
    () =>
      estimateAffordabilityRatio(app?.monthlyIncome, app?.monthlyExpenses, app?.installmentAmount),
    [app?.monthlyIncome, app?.monthlyExpenses, app?.installmentAmount]
  );

  function patchApplication(updated: LoanApplication) {
    setDetail((prev) => (prev ? { ...prev, application: updated } : prev));
    patchStoreApplication(updated);
  }

  async function handleApprove() {
    if (!loanId) {
      return;
    }
    setBusy(true);
    try {
      patchApplication(await approveLoanApplication(loanId));
      showToast("Application approved", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Approve failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!loanId || !rejectReason.trim()) {
      return;
    }
    setBusy(true);
    try {
      patchApplication(await rejectLoanApplication(loanId, rejectReason.trim()));
      showToast("Application rejected", "success");
      setShowReject(false);
    } catch (err) {
      showToast(toUserFacingError(err, "Reject failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisburse() {
    if (!loanId) {
      return;
    }
    setBusy(true);
    try {
      patchApplication(await disburseLoan(loanId));
      await load();
      showToast("Loan disbursed — repayment schedule created", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Disburse failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function postRepayment(amount: number, settleAll: boolean) {
    if (!loanId || !repayBranchId) {
      return;
    }
    setBusy(true);
    try {
      const result = await recordLoanRepayment(loanId, {
        amount,
        branchId: repayBranchId,
        settleAll
      });
      setDetail((prev) =>
        prev
          ? {
              application: result.application,
              schedule: result.schedule,
              repayments: [result.repayment, ...prev.repayments]
            }
          : prev
      );
      patchStoreApplication(result.application);
      setRepayAmount("");
      setRepayAmountNum(NaN);
      showToast(
        settleAll
          ? `Loan settled — ${formatLoanMoney(result.repayment.amount)}`
          : `Repayment recorded — ${formatLoanMoney(result.repayment.amount)}`,
        "success"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Repayment failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRepay(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number.isFinite(repayAmountNum) ? repayAmountNum : parseMoneyInput(repayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid repayment amount", "error");
      return;
    }
    await postRepayment(amount, false);
  }

  async function handleSettleAll() {
    if (!app) {
      return;
    }
    await postRepayment(app.outstandingPrincipal, true);
  }

  const canPrintOfficial =
    app?.status === "approved" || app?.status === "disbursed" || app?.status === "closed";

  function handlePrintOfficial() {
    if (!app) {
      return;
    }
    try {
      const snapshot = applicationToReviewSnapshot(
        app,
        {
          fullName: customer?.fullName ?? app.customerName ?? "Applicant",
          email: customer?.email,
          phone: customer?.phone ?? "",
          location: customer?.location,
          houseNumber: customer?.houseNumber,
          idCardNumber: customer?.idCardNumber,
          accountNumber: customer?.accountNumber,
          photoUrl: customer?.photoUrl,
          idCardPhotoUrl: customer?.idCardPhotoUrl,
          nextOfKin: customer?.nextOfKin,
          branchName: branches.find((b) => b.id === app.branchId)
            ? `${branches.find((b) => b.id === app.branchId)!.name} (${branches.find((b) => b.id === app.branchId)!.code})`
            : undefined
        },
        { companyName: me?.tenantName }
      );
      printLoanDocument(snapshot, { title: "Loan Application Record" });
    } catch (err) {
      showToast(toUserFacingError(err, "Could not print loan record"), "error");
    }
  }

  if (loading || !app) {
    return (
      <LoansLayout activeNav="applications" title="Loan details" subtitle={loading ? "Loading…" : "Not found"}>
        <div className="card loans-skeleton loans-animate-in">Loading loan portfolio record…</div>
      </LoansLayout>
    );
  }

  return (
    <LoansLayout
      activeNav="applications"
      title={customerDisplayName(app.customerName)}
      subtitle={`${app.productName ?? "Product"} · ${LOAN_STATUS_LABELS[app.status]}`}
      actions={
        <>
          {canPrintOfficial ? (
            <button type="button" className="button primary" onClick={handlePrintOfficial}>
              Print loan record
            </button>
          ) : null}
          <Link to="/app/loans/applications" className="button secondary">
            ← Portfolio
          </Link>
        </>
      }
    >
      <div className="loans-detail-grid loans-animate-in loans-animate-in--2">
        <section className="card loans-detail-main">
          <LoanStatusTimeline application={app} />

          <div className="loans-progress" aria-label="Repayment progress">
            <div className="loans-progress__bar" style={{ width: `${progressPct}%` }} />
            <span>{progressPct}% repaid</span>
          </div>

          <dl className="loans-summary-dl">
            <div>
              <dt>Principal</dt>
              <dd>{formatLoanMoney(app.principalAmount)}</dd>
            </div>
            <div>
              <dt>Total repayable</dt>
              <dd>{formatLoanMoney(app.totalRepayable)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{formatLoanMoney(app.outstandingPrincipal)}</dd>
            </div>
            <div>
              <dt>Installment</dt>
              <dd>
                {app.installmentAmount != null
                  ? `${formatLoanMoney(app.installmentAmount)} ${frequencyLabel(app.repaymentFrequency).toLowerCase()}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Next due</dt>
              <dd>{formatLoanDate(app.nextDueDate ?? nextInstallment?.dueDate)}</dd>
            </div>
            <div>
              <dt>Applied</dt>
              <dd>{formatLoanDateTime(app.appliedAt)}</dd>
            </div>
          </dl>

          {app.applicationNotes ? (
            <p className="loans-notes">
              <strong>Notes:</strong> {app.applicationNotes}
            </p>
          ) : null}

          {app.loanPurpose || app.guarantor ? (
            <div className="loans-assessment loans-animate-in loans-animate-in--3">
              <h4>Credit assessment</h4>
              {!canPrintOfficial ? (
                <p className="field-hint muted loans-review-note">
                  Official printable loan record is available after approval.
                </p>
              ) : null}
              <dl className="loans-summary-dl">
                <div>
                  <dt>Purpose</dt>
                  <dd>{loanPurposeLabel(app.loanPurpose, app.loanPurposeOther)}</dd>
                </div>
                <div>
                  <dt>Income source</dt>
                  <dd>{loanIncomeSourceLabel(app.sourceOfIncome, app.sourceOfIncomeOther)}</dd>
                </div>
                <div>
                  <dt>Occupation</dt>
                  <dd>{app.occupation ?? "—"}</dd>
                </div>
                {app.employerOrBusiness ? (
                  <div>
                    <dt>Employer / business</dt>
                    <dd>{app.employerOrBusiness}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Monthly income</dt>
                  <dd>{app.monthlyIncome != null ? formatLoanMoney(app.monthlyIncome) : "—"}</dd>
                </div>
                {app.monthlyExpenses != null ? (
                  <div>
                    <dt>Monthly expenses</dt>
                    <dd>{formatLoanMoney(app.monthlyExpenses)}</dd>
                  </div>
                ) : null}
                {app.existingLoanBalance != null ? (
                  <div>
                    <dt>Existing loan balance</dt>
                    <dd>{formatLoanMoney(app.existingLoanBalance)}</dd>
                  </div>
                ) : null}
                {app.yearsAtCurrentJob != null ? (
                  <div>
                    <dt>Years in role</dt>
                    <dd>{app.yearsAtCurrentJob}</dd>
                  </div>
                ) : null}
                {affordabilityPct != null ? (
                  <div>
                    <dt>Installment vs disposable income</dt>
                    <dd className={affordabilityPct > 40 ? "loans-field-error" : undefined}>
                      {affordabilityPct}% of disposable income
                    </dd>
                  </div>
                ) : null}
              </dl>
              {app.guarantor ? (
                <div className="loans-assessment__guarantor">
                  <h5>Guarantor</h5>
                  <p>
                    <strong>{app.guarantor.fullName}</strong> · {app.guarantor.relationship}
                  </p>
                  <p className="muted">
                    {app.guarantor.phone} · {app.guarantor.occupation}
                    {app.guarantor.employerOrBusiness ? ` · ${app.guarantor.employerOrBusiness}` : ""}
                  </p>
                  <p className="muted">
                    {app.guarantor.location}
                    {app.guarantor.monthlyIncome
                      ? ` · ${formatLoanMoney(app.guarantor.monthlyIncome)}/mo`
                      : ""}
                    {app.guarantor.idCardNumber ? ` · ID ${app.guarantor.idCardNumber}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {app.rejectionReason ? (
            <p className="loans-notes loans-notes--danger">
              <strong>Rejection:</strong> {app.rejectionReason}
            </p>
          ) : null}

          <div className="loans-detail-actions">
            {app.status === "pending_approval" && canApprove ? (
              <>
                <button type="button" className="button primary" disabled={busy} onClick={() => void handleApprove()}>
                  Approve
                </button>
                <button type="button" className="button secondary" disabled={busy} onClick={() => setShowReject(true)}>
                  Reject
                </button>
              </>
            ) : null}
            {app.status === "approved" && canDisburse ? (
              <button type="button" className="button primary" disabled={busy} onClick={() => void handleDisburse()}>
                Disburse loan
              </button>
            ) : null}
          </div>
        </section>

        <aside className="card loans-detail-side">
          <span className={`status-pill status-pill--${LOAN_STATUS_PILL[app.status]} loans-status-pill`}>
            {LOAN_STATUS_LABELS[app.status]}
          </span>
          <p className="loans-detail-customer">
            <strong>{customerDisplayName(app.customerName)}</strong>
          </p>
          {app.status === "disbursed" && canRecordRepayment ? (
            <form className="loans-repay-form" onSubmit={(e) => void handleRepay(e)}>
              <h4>Record repayment</h4>
              {nextInstallment ? (
                <p className="loans-next-installment muted">
                  Next: installment #{nextInstallment.installmentNumber} · due{" "}
                  {formatLoanDate(nextInstallment.dueDate)} · {formatLoanMoney(nextInstallmentDue)}
                </p>
              ) : null}
              <label className="field">
                <span>Amount</span>
                <LoanMoneyInput
                  required
                  value={repayAmount}
                  max={nextInstallmentDue > 0 ? nextInstallmentDue : app.outstandingPrincipal}
                  onChange={(display, numeric) => {
                    setRepayAmount(display);
                    setRepayAmountNum(numeric);
                  }}
                />
              </label>
              <p className="field-hint muted">
                Pay the current installment only. Installments cannot be skipped.
              </p>
              <label className="field">
                <span>Apply to installment</span>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={
                    nextInstallment
                      ? `#${nextInstallment.installmentNumber} · ${formatLoanDate(nextInstallment.dueDate)}`
                      : "All paid"
                  }
                />
              </label>
              <button
                type="button"
                className="button secondary loans-settle-all"
                disabled={busy || app.outstandingPrincipal <= 0}
                onClick={() => void handleSettleAll()}
              >
                Settle all ({formatLoanMoney(app.outstandingPrincipal)})
              </button>
              <label className="field">
                <span>Branch</span>
                <select
                  required
                  disabled={branchLocked}
                  value={repayBranchId}
                  onChange={(e) => setRepayBranchId(e.target.value)}
                >
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="button primary" disabled={busy}>
                Post repayment
              </button>
            </form>
          ) : null}
        </aside>
      </div>

      {schedule.length > 0 ? (
        <section className="card loans-animate-in loans-animate-in--3">
          <h3>Repayment schedule</h3>
          <ScheduleTable schedule={schedule} />
        </section>
      ) : null}

      {repayments.length > 0 ? (
        <section className="card loans-animate-in loans-animate-in--4">
          <h3>Repayment history</h3>
          <ul className="loans-history">
            {repayments.map((r) => (
              <li key={r.id}>
                <strong>{formatLoanMoney(r.amount)}</strong>
                <span className="muted">{formatLoanDateTime(r.createdAt)}</span>
                {r.installmentNumber ? (
                  <span className="muted">Installment #{r.installmentNumber}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showReject ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowReject(false)}>
          <div className="modal card loans-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Reject application</h3>
            <label className="field">
              <span>Reason</span>
              <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </label>
            <div className="loans-wizard-actions">
              <button type="button" className="button secondary" onClick={() => setShowReject(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!rejectReason.trim() || busy}
                onClick={() => void handleReject()}
              >
                Confirm reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </LoansLayout>
  );
}

function ScheduleTable({ schedule }: { schedule: LoanScheduleInstallment[] }) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Due date</th>
            <th>Due</th>
            <th>Paid</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => (
            <tr key={row.id}>
              <td>{row.installmentNumber}</td>
              <td>{formatLoanDate(row.dueDate)}</td>
              <td>{formatLoanMoney(row.amountDue)}</td>
              <td>{formatLoanMoney(row.amountPaid)}</td>
              <td>
                <span className={`status-pill status-pill--${SCHEDULE_STATUS_PILL[row.status]}`}>
                  {SCHEDULE_STATUS_LABELS[row.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
