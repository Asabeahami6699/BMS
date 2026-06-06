import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeLoanFigures, type LoanQualification } from "@bms/shared";
import type { LoanBorrowerRegistration } from "@bms/shared";
import type { AppRole, AuthMe } from "../api";
import { createLoanApplication, getAuthMe } from "../api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useCustomersLiveSync } from "../hooks/useCustomersLiveSync";
import { useCustomersStore } from "../stores/customersStore";
import { useLoansStore } from "../stores/loansStore";
import { AgentPhotoField } from "../../agent/components/AgentPhotoField";
import { preparePhoto } from "../../lib/preparePhoto";
import { buildWizardReviewSnapshot, LoanApplicationReview } from "./LoanApplicationReview";
import { LoanAiReviewAssist } from "./LoanAiReviewAssist";
import { printLoanDocument } from "./loanPrint";
import { LoanBorrowerForm, EMPTY_BORROWER } from "./LoanBorrowerForm";
import { LoanQualificationForm, EMPTY_QUALIFICATION } from "./LoanQualificationForm";
import { LoansLayout } from "./LoansLayout";
import {
  formatLoanMoney,
  frequencyLabel,
  parseMoneyInput
} from "./loanUi";
import { LoanMoneyInput } from "./LoanMoneyInput";

type Props = { role: AppRole };

type Step = 1 | 2 | 3 | 4;

export function LoanApplyWizard({ role: _role }: Props) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  useCustomersLiveSync();
  const [step, setStep] = useState<Step>(1);
  const [animKey, setAnimKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const customers = useCustomersStore((s) => s.customers);
  const branches = useCustomersStore((s) => s.branches);
  const products = useLoansStore((s) => s.products);
  const prependApplication = useLoansStore((s) => s.prependApplication);

  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [newCustomer, setNewCustomer] = useState<LoanBorrowerRegistration>(EMPTY_BORROWER);
  const [me, setMe] = useState<AuthMe | null>(null);

  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountNum, setAmountNum] = useState(NaN);
  const [notes, setNotes] = useState("");
  const [qualification, setQualification] = useState<LoanQualification>(EMPTY_QUALIFICATION);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | undefined>();
  const [existingIdCardPhotoUrl, setExistingIdCardPhotoUrl] = useState<string | undefined>();

  useEffect(() => {
    void getAuthMe()
      .then((meRow) => {
        setMe(meRow);
        if (meRow.scopeType === "branch" && meRow.branchId) {
          setBranchId(meRow.branchId);
          setNewCustomer((v) => ({ ...v, homeBranchId: meRow.branchId! }));
        }
      })
      .catch((err) => showToast(toUserFacingError(err, "Failed to load profile"), "error"));
  }, [showToast]);

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.status === "active"),
    [customers]
  );
  const activeProducts = useMemo(
    () => products.filter((p) => p.status === "active" && (p.loanType ?? "individual") === "individual"),
    [products]
  );
  const activeBranches = useMemo(
    () => branches.filter((b) => b.status !== "inactive"),
    [branches]
  );

  const selectedProduct = useMemo(
    () => activeProducts.find((p) => p.id === productId),
    [activeProducts, productId]
  );

  const amountOutOfRange = useMemo(() => {
    if (!selectedProduct || !Number.isFinite(amountNum) || amountNum <= 0) {
      return false;
    }
    return amountNum < selectedProduct.minAmount || amountNum > selectedProduct.maxAmount;
  }, [selectedProduct, amountNum]);

  const figures = useMemo(() => {
    if (!selectedProduct || !Number.isFinite(amountNum) || amountNum <= 0 || amountOutOfRange) {
      return null;
    }
    return computeLoanFigures(
      amountNum,
      selectedProduct.interestRatePercent,
      selectedProduct.termMonths,
      selectedProduct.repaymentFrequency
    );
  }, [selectedProduct, amountNum, amountOutOfRange]);

  const branchLocked = me?.scopeType === "branch" && Boolean(me.branchId);
  const selectedCustomer = activeCustomers.find((c) => c.id === customerId);
  const disbursementBranch = activeBranches.find((b) => b.id === branchId);

  useEffect(() => {
    if (customerMode !== "existing" || !selectedCustomer) {
      setExistingPhotoUrl(undefined);
      setExistingIdCardPhotoUrl(undefined);
      return;
    }
    setExistingPhotoUrl(selectedCustomer.photoUrl);
    setExistingIdCardPhotoUrl(selectedCustomer.idCardPhotoUrl);
  }, [customerMode, selectedCustomer?.id, selectedCustomer?.photoUrl, selectedCustomer?.idCardPhotoUrl]);

  const reviewSnapshot = useMemo(() => {
    const applicant =
      customerMode === "existing" && selectedCustomer
        ? {
            fullName: selectedCustomer.fullName,
            email: selectedCustomer.email,
            phone: selectedCustomer.phone,
            location: selectedCustomer.location,
            houseNumber: selectedCustomer.houseNumber,
            idCardNumber: selectedCustomer.idCardNumber,
            accountNumber: selectedCustomer.accountNumber,
            photoUrl: existingPhotoUrl ?? selectedCustomer.photoUrl,
            idCardPhotoUrl: existingIdCardPhotoUrl ?? selectedCustomer.idCardPhotoUrl,
            nextOfKin: selectedCustomer.nextOfKin,
            branchName: disbursementBranch
              ? `${disbursementBranch.name} (${disbursementBranch.code})`
              : undefined
          }
        : {
            fullName: newCustomer.fullName,
            email: newCustomer.email,
            phone: newCustomer.phone,
            location: newCustomer.location,
            houseNumber: newCustomer.houseNumber,
            idCardNumber: newCustomer.idCardNumber,
            photoUrl: newCustomer.photoUrl,
            idCardPhotoUrl: newCustomer.idCardPhotoUrl,
            nextOfKin: newCustomer.nextOfKin,
            branchName: activeBranches.find((b) => b.id === newCustomer.homeBranchId)
              ? `${activeBranches.find((b) => b.id === newCustomer.homeBranchId)!.name} (${activeBranches.find((b) => b.id === newCustomer.homeBranchId)!.code})`
              : undefined
          };

    if (!selectedProduct) {
      return null;
    }

    const principal = Number.isFinite(amountNum) ? amountNum : parseMoneyInput(amount);
    if (!Number.isFinite(principal) || principal <= 0) {
      return null;
    }

    return buildWizardReviewSnapshot({
      companyName: me?.tenantName,
      applicant,
      productName: selectedProduct.name,
      principalAmount: principal,
      interestRatePercent: selectedProduct.interestRatePercent,
      termMonths: selectedProduct.termMonths,
      repaymentFrequency: selectedProduct.repaymentFrequency,
      installmentAmount: figures?.installmentAmount,
      installmentsTotal: figures?.installmentsTotal,
      totalRepayable: figures?.totalRepayable,
      applicationNotes: notes.trim() || undefined,
      qualification
    });
  }, [
    customerMode,
    selectedCustomer,
    newCustomer,
    existingPhotoUrl,
    existingIdCardPhotoUrl,
    selectedProduct,
    amountNum,
    amount,
    figures,
    notes,
    qualification,
    me?.tenantName,
    disbursementBranch,
    activeBranches
  ]);

  function goTo(next: Step) {
    setStep(next);
    setAnimKey((k) => k + 1);
  }

  function validateStep1(): boolean {
    if (customerMode === "existing" && !customerId) {
      showToast("Select an existing customer", "error");
      return false;
    }
    if (customerMode === "new") {
      const b = newCustomer;
      if (
        !b.fullName.trim() ||
        !b.phone.trim() ||
        !b.location.trim() ||
        !b.houseNumber.trim() ||
        !b.idCardNumber.trim() ||
        !b.homeBranchId ||
        !b.photoUrl ||
        !b.idCardPhotoUrl ||
        !b.nextOfKin.fullName.trim() ||
        !b.nextOfKin.phone.trim()
      ) {
        showToast("Complete borrower details including passport and ID photos", "error");
        return false;
      }
    }
    if (customerMode === "existing") {
      const passport = existingPhotoUrl ?? selectedCustomer?.photoUrl;
      const idPhoto = existingIdCardPhotoUrl ?? selectedCustomer?.idCardPhotoUrl;
      if (!passport || !idPhoto) {
        showToast("Passport photo and ID card photo are required", "error");
        return false;
      }
    }
    return true;
  }

  function validateStep2(): boolean {
    if (!productId || !branchId || !amount.trim()) {
      showToast("Select product, branch, and amount", "error");
      return false;
    }
    const principal = Number.isFinite(amountNum) ? amountNum : parseMoneyInput(amount);
    if (!selectedProduct || !Number.isFinite(principal) || principal <= 0) {
      showToast("Enter a valid loan amount", "error");
      return false;
    }
    if (principal < selectedProduct.minAmount || principal > selectedProduct.maxAmount) {
      showToast(
        `Principal must stay within ${formatLoanMoney(selectedProduct.minAmount)} – ${formatLoanMoney(selectedProduct.maxAmount)}`,
        "error"
      );
      return false;
    }
    return true;
  }

  function validateStep3(): boolean {
    const q = qualification;
    if (
      !q.occupation.trim() ||
      !Number.isFinite(q.monthlyIncome) ||
      q.monthlyIncome <= 0 ||
      !q.guarantor.fullName.trim() ||
      !q.guarantor.phone.trim() ||
      !q.guarantor.relationship.trim() ||
      !q.guarantor.occupation.trim() ||
      !q.guarantor.location.trim()
    ) {
      showToast("Complete income details and guarantor information", "error");
      return false;
    }
    if (q.loanPurpose === "other" && !q.loanPurposeOther?.trim()) {
      showToast("Describe the loan purpose", "error");
      return false;
    }
    if (q.sourceOfIncome === "other" && !q.sourceOfIncomeOther?.trim()) {
      showToast("Describe the income source", "error");
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    if (!validateStep1() || !validateStep2() || !validateStep3()) {
      return;
    }
    setBusy(true);
    try {
      const principal = Number.isFinite(amountNum) ? amountNum : parseMoneyInput(amount);
      let newCustomerPayload = customerMode === "new" ? newCustomer : undefined;
      if (newCustomerPayload) {
        newCustomerPayload = {
          ...newCustomerPayload,
          photoUrl: await preparePhoto(newCustomerPayload.photoUrl),
          idCardPhotoUrl: await preparePhoto(newCustomerPayload.idCardPhotoUrl)
        };
      }
      const photoUrl =
        customerMode === "existing"
          ? await preparePhoto(existingPhotoUrl ?? selectedCustomer?.photoUrl)
          : undefined;
      const idCardPhotoUrl =
        customerMode === "existing"
          ? await preparePhoto(existingIdCardPhotoUrl ?? selectedCustomer?.idCardPhotoUrl)
          : undefined;

      const application = await createLoanApplication({
        customerId: customerMode === "existing" ? customerId : undefined,
        newCustomer: newCustomerPayload,
        photoUrl,
        idCardPhotoUrl,
        productId,
        branchId,
        principalAmount: principal,
        applicationNotes: notes.trim() || undefined,
        loanPurpose: qualification.loanPurpose,
        loanPurposeOther: qualification.loanPurposeOther?.trim() || undefined,
        sourceOfIncome: qualification.sourceOfIncome,
        sourceOfIncomeOther: qualification.sourceOfIncomeOther?.trim() || undefined,
        occupation: qualification.occupation.trim(),
        employerOrBusiness: qualification.employerOrBusiness?.trim() || undefined,
        monthlyIncome: qualification.monthlyIncome,
        monthlyExpenses: qualification.monthlyExpenses,
        existingLoanBalance: qualification.existingLoanBalance,
        yearsAtCurrentJob: qualification.yearsAtCurrentJob,
        guarantor: {
          ...qualification.guarantor,
          fullName: qualification.guarantor.fullName.trim(),
          phone: qualification.guarantor.phone.trim(),
          relationship: qualification.guarantor.relationship.trim(),
          occupation: qualification.guarantor.occupation.trim(),
          location: qualification.guarantor.location.trim(),
          employerOrBusiness: qualification.guarantor.employerOrBusiness?.trim() || undefined,
          idCardNumber: qualification.guarantor.idCardNumber?.trim() || undefined
        }
      });
      prependApplication(application);
      showToast("Loan application submitted", "success");
      navigate(`/app/loans/applications/${application.id}`);
    } catch (err) {
      const message =
        err instanceof Error && err.message === "PHOTO_TOO_LARGE"
          ? "Photo is too large after compression"
          : toUserFacingError(err, "Submission failed");
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoansLayout
      activeNav="apply"
      title="New loan application"
      subtitle="Register a borrower or select an existing customer, then submit for credit approval."
    >
      <ol className="loans-wizard-steps loans-animate-in loans-animate-in--2" aria-label="Application steps">
        {[
          { n: 1, label: "Customer" },
          { n: 2, label: "Loan terms" },
          { n: 3, label: "Credit assessment" },
          { n: 4, label: "Review" }
        ].map((s) => (
          <li
            key={s.n}
            className={`loans-wizard-steps__item${step === s.n ? " loans-wizard-steps__item--active" : ""}${
              step > s.n ? " loans-wizard-steps__item--done" : ""
            }`}
          >
            <span>{s.n}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <section key={animKey} className="card loans-wizard-panel loans-animate-in loans-animate-in--3">
        {step === 1 ? (
          <>
            <div className="loans-mode-toggle">
              <button
                type="button"
                className={`loans-mode-toggle__btn${customerMode === "existing" ? " loans-mode-toggle__btn--active" : ""}`}
                onClick={() => setCustomerMode("existing")}
              >
                Existing customer
              </button>
              <button
                type="button"
                className={`loans-mode-toggle__btn${customerMode === "new" ? " loans-mode-toggle__btn--active" : ""}`}
                onClick={() => setCustomerMode("new")}
              >
                Register new borrower
              </button>
            </div>

            {customerMode === "existing" ? (
              <>
                <label className="field">
                  <span>Search customer</span>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select customer</option>
                    {activeCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} {c.accountNumber ? `· ${c.accountNumber}` : ""} · {c.phone}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCustomer ? (
                  <div className="loans-form-section field--full">
                    <h4>Identity photos</h4>
                    <p className="field-hint muted">
                      Required for loan file. Capture or upload if not already on the customer record.
                    </p>
                    <div className="loans-form-grid">
                      <AgentPhotoField
                        label="Passport photo"
                        hint="Clear face photo of the applicant."
                        required
                        photoUrl={existingPhotoUrl ?? selectedCustomer.photoUrl}
                        onPhotoChange={setExistingPhotoUrl}
                      />
                      <AgentPhotoField
                        label="ID card photo"
                        hint="Front of Ghana Card or valid ID document."
                        required
                        photoUrl={existingIdCardPhotoUrl ?? selectedCustomer.idCardPhotoUrl}
                        onPhotoChange={setExistingIdCardPhotoUrl}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <LoanBorrowerForm
                value={newCustomer}
                onChange={setNewCustomer}
                branches={activeBranches}
                branchLocked={branchLocked}
              />
            )}
          </>
        ) : null}

        {step === 2 ? (
          <div className="loans-form-grid">
            <label className="field">
              <span>Loan product</span>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select product</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.interestRatePercent}% · {frequencyLabel(p.repaymentFrequency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Disbursement branch</span>
              <select
                disabled={branchLocked}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">Select branch</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Principal amount</span>
              <LoanMoneyInput
                required
                value={amount}
                onChange={(display, numeric) => {
                  setAmount(display);
                  setAmountNum(numeric);
                }}
              />
              {selectedProduct ? (
                <p className={`field-hint${amountOutOfRange ? " loans-field-error" : " muted"}`}>
                  Allowed range: {formatLoanMoney(selectedProduct.minAmount)} –{" "}
                  {formatLoanMoney(selectedProduct.maxAmount)}
                </p>
              ) : null}
            </label>
            <label className="field field--full">
              <span>Application notes</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            {figures && selectedProduct ? (
              <div className="loans-preview-card field--full">
                <h4>Repayment preview</h4>
                <dl className="loans-preview-dl">
                  <div>
                    <dt>Frequency</dt>
                    <dd>{frequencyLabel(selectedProduct.repaymentFrequency)}</dd>
                  </div>
                  <div>
                    <dt>Installments</dt>
                    <dd>{figures.installmentsTotal}</dd>
                  </div>
                  <div>
                    <dt>Per installment</dt>
                    <dd>{formatLoanMoney(figures.installmentAmount)}</dd>
                  </div>
                  <div>
                    <dt>Total repayable</dt>
                    <dd>{formatLoanMoney(figures.totalRepayable)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <LoanQualificationForm value={qualification} onChange={setQualification} />
        ) : null}

        {step === 4 && reviewSnapshot ? (
          <>
            <p className="field-hint muted loans-review-note">
              Review all applicant details before submission. Use print preview for a draft copy — the official
              loan record print is available after approval.
            </p>
            <LoanApplicationReview snapshot={reviewSnapshot} />
            <LoanAiReviewAssist snapshot={reviewSnapshot} loanType="individual" />
          </>
        ) : null}

        <div className="loans-wizard-actions">
          {step > 1 ? (
            <button type="button" className="button secondary" onClick={() => goTo((step - 1) as Step)}>
              Back
            </button>
          ) : (
            <button type="button" className="button secondary" onClick={() => navigate("/app/loans/applications")}>
              Cancel
            </button>
          )}
          {step === 4 && reviewSnapshot ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                try {
                  printLoanDocument(reviewSnapshot, { title: "Loan Application (Draft)" });
                } catch (err) {
                  showToast(toUserFacingError(err, "Could not print"), "error");
                }
              }}
            >
              Print preview
            </button>
          ) : null}
          {step < 4 ? (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                if (step === 1 && validateStep1()) {
                  goTo(2);
                } else if (step === 2 && validateStep2()) {
                  goTo(3);
                } else if (step === 3 && validateStep3()) {
                  goTo(4);
                }
              }}
            >
              Continue
            </button>
          ) : (
            <button type="button" className="button primary" disabled={busy} onClick={() => void handleSubmit()}>
              {busy ? "Submitting…" : "Submit application"}
            </button>
          )}
        </div>
      </section>
    </LoansLayout>
  );
}
