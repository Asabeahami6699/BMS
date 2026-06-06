import type { LoanQualification } from "@bms/shared";
import type { LoanReviewSnapshot } from "./loanDocument";
import {
  estimateAffordabilityRatio,
  formatLoanMoney,
  frequencyLabel,
  loanIncomeSourceLabel,
  loanPurposeLabel
} from "./loanUi";

type Props = {
  snapshot: LoanReviewSnapshot;
  showPhotos?: boolean;
};

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  if (!value || value === "—") {
    return null;
  }
  return (
    <div className="loans-review-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function LoanApplicationReview({ snapshot, showPhotos = true }: Props) {
  const { applicant, qualification: q } = snapshot;
  const affordability = estimateAffordabilityRatio(
    q.monthlyIncome,
    q.monthlyExpenses,
    snapshot.installmentAmount
  );

  return (
    <div className="loans-review loans-review--full">
      <div className="loans-review__block">
        <h4>Applicant — personal</h4>
        {showPhotos ? (
          <div className="loans-review-photos">
            <figure>
              {applicant.photoUrl ? (
                <img src={applicant.photoUrl} alt="Passport photo" />
              ) : (
                <span className="muted">No passport photo</span>
              )}
              <figcaption>Passport photo</figcaption>
            </figure>
            <figure>
              {applicant.idCardPhotoUrl ? (
                <img src={applicant.idCardPhotoUrl} alt="ID card" />
              ) : (
                <span className="muted">No ID photo</span>
              )}
              <figcaption>ID card photo</figcaption>
            </figure>
          </div>
        ) : null}
        <dl className="loans-review-dl">
          <ReviewRow label="Full name" value={applicant.fullName} />
          <ReviewRow label="Phone" value={applicant.phone} />
          <ReviewRow label="Email" value={applicant.email} />
          <ReviewRow label="Ghana Card / ID" value={applicant.idCardNumber} />
          <ReviewRow label="Account no." value={applicant.accountNumber} />
          <ReviewRow label="Location" value={applicant.location} />
          <ReviewRow label="House / GPS" value={applicant.houseNumber} />
          <ReviewRow label="Home branch" value={applicant.branchName} />
        </dl>
      </div>

      {applicant.nextOfKin ? (
        <div className="loans-review__block">
          <h4>Next of kin</h4>
          <dl className="loans-review-dl">
            <ReviewRow label="Name" value={applicant.nextOfKin.fullName} />
            <ReviewRow label="Phone" value={applicant.nextOfKin.phone} />
            <ReviewRow label="Location" value={applicant.nextOfKin.location} />
            <ReviewRow label="House no." value={applicant.nextOfKin.houseNumber} />
          </dl>
        </div>
      ) : null}

      <div className="loans-review__block">
        <h4>Loan terms</h4>
        <dl className="loans-review-dl">
          <ReviewRow label="Product" value={snapshot.productName} />
          <ReviewRow label="Solidarity group" value={snapshot.groupName} />
          <ReviewRow label="Principal" value={formatLoanMoney(snapshot.principalAmount)} />
          <ReviewRow label="Interest" value={`${snapshot.interestRatePercent}%`} />
          <ReviewRow label="Term" value={`${snapshot.termMonths} months`} />
          <ReviewRow label="Repayment" value={frequencyLabel(snapshot.repaymentFrequency)} />
          {snapshot.installmentAmount != null ? (
            <ReviewRow label="Installment" value={formatLoanMoney(snapshot.installmentAmount)} />
          ) : null}
          {snapshot.installmentsTotal != null ? (
            <ReviewRow label="Installments" value={String(snapshot.installmentsTotal)} />
          ) : null}
          {snapshot.totalRepayable != null ? (
            <ReviewRow label="Total repayable" value={formatLoanMoney(snapshot.totalRepayable)} />
          ) : null}
          {snapshot.applicationNotes ? (
            <ReviewRow label="Notes" value={snapshot.applicationNotes} />
          ) : null}
        </dl>
      </div>

      <div className="loans-review__block">
        <h4>Credit assessment</h4>
        <dl className="loans-review-dl">
          <ReviewRow
            label="Purpose"
            value={loanPurposeLabel(q.loanPurpose, q.loanPurposeOther)}
          />
          <ReviewRow
            label="Income source"
            value={loanIncomeSourceLabel(q.sourceOfIncome, q.sourceOfIncomeOther)}
          />
          <ReviewRow label="Occupation" value={q.occupation} />
          <ReviewRow label="Employer / business" value={q.employerOrBusiness} />
          <ReviewRow label="Monthly income" value={formatLoanMoney(q.monthlyIncome)} />
          {q.monthlyExpenses != null ? (
            <ReviewRow label="Monthly expenses" value={formatLoanMoney(q.monthlyExpenses)} />
          ) : null}
          {q.existingLoanBalance != null ? (
            <ReviewRow label="Existing loans" value={formatLoanMoney(q.existingLoanBalance)} />
          ) : null}
          {q.yearsAtCurrentJob != null ? (
            <ReviewRow label="Years in role" value={String(q.yearsAtCurrentJob)} />
          ) : null}
          {affordability != null ? (
            <ReviewRow
              label="Installment vs disposable income"
              value={`${affordability}%${affordability > 40 ? " — review carefully" : ""}`}
            />
          ) : null}
        </dl>
      </div>

      <div className="loans-review__block">
        <h4>Guarantor</h4>
        <dl className="loans-review-dl">
          <ReviewRow label="Name" value={q.guarantor.fullName} />
          <ReviewRow label="Phone" value={q.guarantor.phone} />
          <ReviewRow label="Relationship" value={q.guarantor.relationship} />
          <ReviewRow label="Occupation" value={q.guarantor.occupation} />
          <ReviewRow label="Employer / business" value={q.guarantor.employerOrBusiness} />
          {q.guarantor.monthlyIncome != null ? (
            <ReviewRow label="Monthly income" value={formatLoanMoney(q.guarantor.monthlyIncome)} />
          ) : null}
          <ReviewRow label="Location" value={q.guarantor.location} />
          <ReviewRow label="ID number" value={q.guarantor.idCardNumber} />
        </dl>
      </div>
    </div>
  );
}

export function buildWizardReviewSnapshot(input: {
  companyName?: string;
  applicant: LoanReviewSnapshot["applicant"];
  productName: string;
  principalAmount: number;
  interestRatePercent: number;
  termMonths: number;
  repaymentFrequency: "weekly" | "monthly";
  installmentAmount?: number;
  installmentsTotal?: number;
  totalRepayable?: number;
  applicationNotes?: string;
  qualification: LoanQualification;
  groupName?: string;
}): LoanReviewSnapshot {
  return {
    companyName: input.companyName,
    watermark: "DRAFT — NOT APPROVED",
    applicant: input.applicant,
    productName: input.productName,
    groupName: input.groupName,
    principalAmount: input.principalAmount,
    interestRatePercent: input.interestRatePercent,
    termMonths: input.termMonths,
    repaymentFrequency: input.repaymentFrequency,
    installmentAmount: input.installmentAmount,
    installmentsTotal: input.installmentsTotal,
    totalRepayable: input.totalRepayable,
    applicationNotes: input.applicationNotes,
    qualification: input.qualification,
    statusLabel: "Pending submission"
  };
}
