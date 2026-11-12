import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { canUseSusuLoanBridge, type LoanApplication, type LoanScheduleInstallment } from "@bms/shared";
import type { AppRole } from "./api";
import {
  approveLoanApplication,
  disburseLoan,
  recordLoanRepayment,
  rejectLoanApplication
} from "./api";
import { useAuth } from "../auth/AuthContext";
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
import { selectLoanDetail, useLoansStore } from "./stores/loansStore";
import { useBranchesStore } from "./stores/branchesStore";
import { usePageLoading } from "./hooks/usePageLoading";
import { applicationToReviewSnapshot } from "./loans/loanDocument";
import { printLoanDocument } from "./loans/loanPrint";

type Props = { role: AppRole };

export function LoanDetailPage({ role: _role }: Props) {
  const { loanId } = useParams<{ loanId: string }>();
  const { showToast } = useToast();
  const { user: me } = useAuth();
  const patchStoreApplication = useLoansStore((s) => s.patchApplication);
  const setLoanDetail = useLoansStore((s) => s.setLoanDetail);
  const ensureLoanDetail = useLoansStore((s) => s.ensureLoanDetail);
  const startDetailLiveSync = useLoansStore((s) => s.startDetailLiveSync);
  const stopDetailLiveSync = useLoansStore((s) => s.stopDetailLiveSync);
  const detail = useLoansStore((s) => selectLoanDetail(s, loanId));
  const detailLoading = useLoansStore((s) => Boolean(loanId && s.detailLoadingByLoanId[loanId]));
  const detailError = useLoansStore((s) => (loanId ? s.detailErrorByLoanId[loanId] : null));
  const branchRows = useBranchesStore((s) => s.branches);
  const hydrateBranches = useBranchesStore((s) => s.hydrate);
  const startBranchesLiveSync = useBranchesStore((s) => s.startLiveSync);
  const stopBranchesLiveSync = useBranchesStore((s) => s.stopLiveSync);
  const { canApprove, canDisburse, canRecordRepayment } = useLoanPermissions();

  const branches = useMemo(
    () => branchRows.filter((b) => b.status !== "inactive"),
    [branchRows]
  );
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayAmountNum, setRepayAmountNum] = useState(NaN);
  const [repayBranchId, setRepayBranchId] = useState("");
  const [paymentSource, setPaymentSource] = useState<"cash" | "susu_account">("cash");

  const loading = detailLoading || (Boolean(loanId) && !detail && !detailError);

  usePageLoading(loading || busy, "loan-detail");

  const bridgeActive = canUseSusuLoanBridge(me?.subscribedModules, me?.susuLoanBridgeEnabled);

  useEffect(() => {
    if (!loanId) {
      return;
    }
    void ensureLoanDetail(loanId);
    startDetailLiveSync(loanId);
    hydrateBranches();
    startBranchesLiveSync();
    return () => {
      stopDetailLiveSync();
      stopBranchesLiveSync();
    };
  }, [
    loanId,
    ensureLoanDetail,
    startDetailLiveSync,
    stopDetailLiveSync,
    hydrateBranches,
    startBranchesLiveSync,
    stopBranchesLiveSync
  ]);

  useEffect(() => {
    if (detailError) {
      showToast(detailError, "error");
    }
  }, [detailError, showToast]);

  useEffect(() => {
    if (me?.scopeType === "branch" && me.branchId) {
      setRepayBranchId(me.branchId);
    }
  }, [me?.scopeType, me?.branchId]);

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

  const overdueInstallments = useMemo(() => {
    const now = new Date();
    return schedule.filter((s) => {
      if (s.status === "paid" || s.status === "pending") {
        return false;
      }
      if (s.status === "overdue") {
        return true;
      }
      return s.status === "partial" && new Date(`${s.dueDate}T23:59:59`) < now;
    });
  }, [schedule]);

  const hasOverdue = overdueInstallments.length > 0;

  const overdueBulkDue = useMemo(() => {
    if (!hasOverdue) {
      return 0;
    }
    return (
      Math.round(
        overdueInstallments.reduce((sum, s) => sum + Math.max(0, s.amountDue - s.amountPaid), 0) *
          100
      ) / 100
    );
  }, [hasOverdue, overdueInstallments]);

  const repayMax = hasOverdue && overdueBulkDue > 0 ? overdueBulkDue : nextInstallmentDue;

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
    if (!loanId || !detail) {
      patchStoreApplication(updated);
      return;
    }
    setLoanDetail(loanId, { ...detail, application: updated });
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
      await ensureLoanDetail(loanId, { force: true });
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
        settleAll,
        paymentSource: bridgeActive ? paymentSource : "cash"
      });
      setLoanDetail(loanId, {
        application: result.application,
        customer: detail?.customer,
        schedule: result.schedule,
        repayments: [result.repayment, ...(detail?.repayments ?? [])]
      });
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

          {app.susuCreditSnapshot ? (
            <div className="loans-susu-snapshot">
              <h4>Susu credit snapshot</h4>
              <p className="muted">
                Captured {formatLoanDateTime(app.susuCreditSnapshot.capturedAt)} via Susu↔Loans bridge
                (advisory for qualification).
              </p>
              <dl className="loans-preview-dl">
                <div>
                  <dt>Account balance</dt>
                  <dd>{formatLoanMoney(app.susuCreditSnapshot.accountBalance)}</dd>
                </div>
                <div>
                  <dt>Withdrawable</dt>
                  <dd>{formatLoanMoney(app.susuCreditSnapshot.withdrawableBalance)}</dd>
                </div>
                <div>
                  <dt>Locked</dt>
                  <dd>{formatLoanMoney(app.susuCreditSnapshot.lockedBalance)}</dd>
                </div>
                {app.susuCreditSnapshot.dailySusuCount90d != null ? (
                  <div>
                    <dt>Susu posts (90d)</dt>
                    <dd>
                      {app.susuCreditSnapshot.dailySusuCount90d}
                      {app.susuCreditSnapshot.dailySusuTotal90d != null
                        ? ` · ${formatLoanMoney(app.susuCreditSnapshot.dailySusuTotal90d)}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
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
              {hasOverdue ? (
                <p className="loans-next-installment" role="status">
                  {overdueInstallments.length} overdue installment
                  {overdueInstallments.length === 1 ? "" : "s"} · bulk catch-up up to{" "}
                  {formatLoanMoney(overdueBulkDue)} spreads across due repayments
                </p>
              ) : null}
              {bridgeActive ? (
                <label className="field">
                  <span>Payment source</span>
                  <select
                    value={paymentSource}
                    onChange={(e) => setPaymentSource(e.target.value as "cash" | "susu_account")}
                    disabled={busy}
                  >
                    <option value="cash">Cash / manual</option>
                    <option value="susu_account">From Susu account</option>
                  </select>
                  {paymentSource === "susu_account" ? (
                    <p className="field-hint muted">
                      Debits the customer&apos;s Susu/savings balance, then posts the loan repayment.
                      The Susu ledger shows loan repayment as the reason, and the customer is notified by SMS when enabled.
                    </p>
                  ) : null}
                </label>
              ) : null}
              <label className="field">
                <span>Amount</span>
                <LoanMoneyInput
                  required
                  value={repayAmount}
                  max={repayMax > 0 ? repayMax : app.outstandingPrincipal}
                  onChange={(display, numeric) => {
                    setRepayAmount(display);
                    setRepayAmountNum(numeric);
                  }}
                />
              </label>
              <p className="field-hint muted">
                {hasOverdue
                  ? "Overdue bulk payment: enter any amount up to the total due; it spreads across overdue installments in order."
                  : "Pay the current installment only. Installments cannot be skipped until overdue."}
              </p>
              <label className="field">
                <span>{hasOverdue ? "Applies across" : "Apply to installment"}</span>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={
                    hasOverdue
                      ? `${overdueInstallments.length} due installment(s) · max ${formatLoanMoney(overdueBulkDue)}`
                      : nextInstallment
                        ? `#${nextInstallment.installmentNumber} · ${formatLoanDate(nextInstallment.dueDate)}`
                        : "All paid"
                  }
                />
              </label>
              {hasOverdue && overdueBulkDue > 0 ? (
                <button
                  type="button"
                  className="button secondary loans-settle-all"
                  disabled={busy}
                  onClick={() => {
                    setRepayAmount(overdueBulkDue.toFixed(2));
                    setRepayAmountNum(overdueBulkDue);
                  }}
                >
                  Fill overdue total ({formatLoanMoney(overdueBulkDue)})
                </button>
              ) : null}
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
                {r.paymentSource === "susu_account" ? (
                  <span className="muted">From Susu account</span>
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
