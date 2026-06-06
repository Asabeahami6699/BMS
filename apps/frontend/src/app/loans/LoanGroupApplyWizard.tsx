import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { computeLoanFigures, type LoanQualification } from "@bms/shared";
import type { AppRole, AuthMe } from "../api";
import { createLoanApplication, getAuthMe, getLoanGroup } from "../api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useCustomersLiveSync } from "../hooks/useCustomersLiveSync";
import { useCustomersStore } from "../stores/customersStore";
import { useLoansStore } from "../stores/loansStore";
import { AgentPhotoField } from "../../agent/components/AgentPhotoField";
import { preparePhoto } from "../../lib/preparePhoto";
import { buildWizardReviewSnapshot, LoanApplicationReview } from "./LoanApplicationReview";
import { printLoanDocument } from "./loanPrint";
import { LoanQualificationForm, EMPTY_QUALIFICATION } from "./LoanQualificationForm";
import { LoansLayout } from "./LoansLayout";
import { formatLoanMoney, frequencyLabel, parseMoneyInput, customerDisplayName } from "./loanUi";
import { LoanMoneyInput } from "./LoanMoneyInput";
import type { LoanGroup } from "@bms/shared";

type Props = { role: AppRole };
type Step = 1 | 2 | 3 | 4;

export function LoanGroupApplyWizard({ role: _role }: Props) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  useCustomersLiveSync();
  const [step, setStep] = useState<Step>(1);
  const [animKey, setAnimKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const allGroups = useLoansStore((s) => s.groups);
  const products = useLoansStore((s) => s.products);
  const groups = useMemo(
    () => allGroups.filter((g) => g.status === "active"),
    [allGroups]
  );
  const branches = useCustomersStore((s) => s.branches);
  const customers = useCustomersStore((s) => s.customers);
  const prependApplication = useLoansStore((s) => s.prependApplication);

  const [groupId, setGroupId] = useState("");
  const [groupDetail, setGroupDetail] = useState<LoanGroup | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [customerId, setCustomerId] = useState("");
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
        }
      })
      .catch((err) => showToast(toUserFacingError(err, "Failed to load profile"), "error"));
  }, [showToast]);

  useEffect(() => {
    if (!groupId) {
      setGroupDetail(null);
      setCustomerId("");
      return;
    }
    setGroupLoading(true);
    void getLoanGroup(groupId)
      .then((g) => {
        setGroupDetail(g);
        setCustomerId("");
      })
      .catch((err) => showToast(toUserFacingError(err, "Failed to load group"), "error"))
      .finally(() => setGroupLoading(false));
  }, [groupId, showToast]);

  const activeMembers = useMemo(
    () => (groupDetail?.members ?? []).filter((m) => m.status === "active"),
    [groupDetail?.members]
  );

  const activeProducts = useMemo(
    () => products.filter((p) => p.status === "active" && p.loanType === "group_solidarity"),
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

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const disbursementBranch = activeBranches.find((b) => b.id === branchId);
  const branchLocked = me?.scopeType === "branch" && Boolean(me.branchId);

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

  useEffect(() => {
    if (!selectedCustomer) {
      setExistingPhotoUrl(undefined);
      setExistingIdCardPhotoUrl(undefined);
      return;
    }
    setExistingPhotoUrl(selectedCustomer.photoUrl);
    setExistingIdCardPhotoUrl(selectedCustomer.idCardPhotoUrl);
  }, [selectedCustomer?.id, selectedCustomer?.photoUrl, selectedCustomer?.idCardPhotoUrl]);

  const reviewSnapshot = useMemo(() => {
    if (!selectedProduct || !selectedCustomer || !groupDetail) {
      return null;
    }
    const principal = Number.isFinite(amountNum) ? amountNum : parseMoneyInput(amount);
    if (!Number.isFinite(principal) || principal <= 0) {
      return null;
    }
    return buildWizardReviewSnapshot({
      companyName: me?.tenantName,
      applicant: {
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
      },
      productName: selectedProduct.name,
      principalAmount: principal,
      interestRatePercent: selectedProduct.interestRatePercent,
      termMonths: selectedProduct.termMonths,
      repaymentFrequency: selectedProduct.repaymentFrequency,
      installmentAmount: figures?.installmentAmount,
      installmentsTotal: figures?.installmentsTotal,
      totalRepayable: figures?.totalRepayable,
      applicationNotes: notes.trim() || undefined,
      qualification,
      groupName: groupDetail.name
    });
  }, [
    selectedProduct,
    selectedCustomer,
    groupDetail,
    amountNum,
    amount,
    figures,
    notes,
    qualification,
    me?.tenantName,
    disbursementBranch,
    existingPhotoUrl,
    existingIdCardPhotoUrl
  ]);

  function goTo(next: Step) {
    setStep(next);
    setAnimKey((k) => k + 1);
  }

  function validateStep1(): boolean {
    if (!groupId || !groupDetail) {
      showToast("Select a solidarity group", "error");
      return false;
    }
    if (!customerId) {
      showToast("Select a group member as borrower", "error");
      return false;
    }
    const minRequired = groupDetail.minMembers;
    if ((groupDetail.activeMemberCount ?? activeMembers.length) < minRequired) {
      showToast(`Group needs at least ${minRequired} active members before applying`, "error");
      return false;
    }
    const passport = existingPhotoUrl ?? selectedCustomer?.photoUrl;
    const idPhoto = existingIdCardPhotoUrl ?? selectedCustomer?.idCardPhotoUrl;
    if (!passport || !idPhoto) {
      showToast("Passport photo and ID card photo are required", "error");
      return false;
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
    return true;
  }

  async function handleSubmit() {
    if (!validateStep1() || !validateStep2() || !validateStep3()) {
      return;
    }
    setBusy(true);
    try {
      const principal = Number.isFinite(amountNum) ? amountNum : parseMoneyInput(amount);
      const photoUrl = await preparePhoto(existingPhotoUrl ?? selectedCustomer?.photoUrl);
      const idCardPhotoUrl = await preparePhoto(existingIdCardPhotoUrl ?? selectedCustomer?.idCardPhotoUrl);

      const application = await createLoanApplication({
        customerId,
        groupId,
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
      showToast("Group loan application submitted", "success");
      navigate(`/app/loans/applications/${application.id}`);
    } catch (err) {
      showToast(toUserFacingError(err, "Submission failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoansLayout
      activeNav="apply"
      title="Group solidarity application"
      subtitle="Apply on behalf of a registered group member using a group solidarity product."
      actions={
        <Link to="/app/loans/groups" className="button secondary">
          Manage groups
        </Link>
      }
    >
      <ol className="loans-wizard-steps loans-animate-in loans-animate-in--2" aria-label="Application steps">
        {[
          { n: 1, label: "Group & member" },
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
          <div className="loans-form-grid">
            <label className="field field--wide">
              <span>Solidarity group</span>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Select group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {g.activeMemberCount ?? 0} members
                  </option>
                ))}
              </select>
              {!groups.length ? (
                <p className="field-hint muted">
                  No groups yet. <Link to="/app/loans/groups">Create a group</Link> and add members first.
                </p>
              ) : null}
            </label>

            {groupLoading ? <p>Loading group roster…</p> : null}

            {groupDetail ? (
              <>
                <p className="field-hint muted field--full">
                  {groupDetail.activeMemberCount ?? activeMembers.length} active members · minimum{" "}
                  {groupDetail.minMembers} required
                </p>
                <label className="field field--wide">
                  <span>Borrower (group member)</span>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select member</option>
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.customerId}>
                        {customerDisplayName(m.customerName)} · {m.role}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedCustomer ? (
                  <div className="loans-form-section field--full">
                    <h4>Identity photos</h4>
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
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="loans-form-grid">
            <label className="field">
              <span>Group solidarity product</span>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select product</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.interestRatePercent}% · {frequencyLabel(p.repaymentFrequency)}
                  </option>
                ))}
              </select>
              {!activeProducts.length ? (
                <p className="field-hint loans-field-error">No active group solidarity products — create one under Products.</p>
              ) : null}
            </label>
            <label className="field">
              <span>Disbursement branch</span>
              <select disabled={branchLocked} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
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
              Review group member details before submission. Use print preview for a draft copy.
            </p>
            <LoanApplicationReview snapshot={reviewSnapshot} />
          </>
        ) : null}

        <div className="loans-wizard-actions">
          {step > 1 ? (
            <button type="button" className="button secondary" onClick={() => goTo((step - 1) as Step)}>
              Back
            </button>
          ) : (
            <Link to="/app/loans/groups" className="button secondary">
              Cancel
            </Link>
          )}
          {step === 4 && reviewSnapshot ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => printLoanDocument(reviewSnapshot, { title: "Group Loan Application (Draft)" })}
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
