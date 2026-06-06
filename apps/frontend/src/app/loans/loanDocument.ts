import type { LoanApplication, LoanQualification } from "@bms/shared";
import type { NextOfKinDetails } from "@bms/shared";
import {
  formatLoanDate,
  formatLoanDateTime,
  formatLoanMoney,
  frequencyLabel,
  loanIncomeSourceLabel,
  loanPurposeLabel
} from "./loanUi";

export type LoanApplicantProfile = {
  fullName: string;
  email?: string;
  phone: string;
  location?: string;
  houseNumber?: string;
  idCardNumber?: string;
  accountNumber?: string;
  photoUrl?: string;
  idCardPhotoUrl?: string;
  nextOfKin?: NextOfKinDetails;
  branchName?: string;
};

export type LoanReviewSnapshot = {
  companyName?: string;
  applicationId?: string;
  statusLabel?: string;
  watermark?: string;
  applicant: LoanApplicantProfile;
  productName: string;
  principalAmount: number;
  interestRatePercent: number;
  termMonths: number;
  repaymentFrequency: "weekly" | "monthly";
  installmentAmount?: number;
  installmentsTotal?: number;
  totalRepayable?: number;
  totalInterest?: number;
  applicationNotes?: string;
  qualification: LoanQualification;
  appliedAt?: string;
  approvedAt?: string;
  disbursedAt?: string;
  rejectionReason?: string;
  groupName?: string;
};

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 11pt;
    color: #000;
    margin: 0;
    padding: 24px;
    line-height: 1.45;
    background: #fff;
  }
  .loan-doc {
    max-width: 820px;
    margin: 0 auto;
    color: #000;
  }
  .loan-doc__watermark {
    position: fixed;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 3rem;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.12);
    pointer-events: none;
    z-index: 0;
  }
  .loan-doc__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 2px solid #000;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .loan-doc__brand h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #000;
  }
  .loan-doc__brand p {
    margin: 4px 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: #000;
  }
  .loan-doc__meta {
    text-align: right;
    font-size: 0.85rem;
    color: #000;
  }
  .loan-doc__title {
    text-align: center;
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 0 16px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #000;
  }
  .loan-doc__section {
    margin-bottom: 14px;
    page-break-inside: avoid;
    color: #000;
  }
  .loan-doc__section h2 {
    margin: 0 0 8px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #000;
    background: #fff;
    padding: 5px 8px;
    border: 1px solid #000;
  }
  .loan-doc__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
  .loan-doc__field { min-height: 1.6em; color: #000; }
  .loan-doc__label {
    font-size: 0.74rem;
    font-weight: 700;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .loan-doc__value {
    border-bottom: 1px solid #000;
    min-height: 1.4em;
    padding-bottom: 2px;
    color: #000;
    font-weight: 500;
  }
  .loan-doc__value--blank { min-height: 1.6em; }
  .loan-doc__photos {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    margin-bottom: 10px;
  }
  .loan-doc__photo-box {
    border: 1px solid #000;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: #000;
    overflow: hidden;
    background: #fff;
  }
  .loan-doc__photo-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: grayscale(100%);
  }
  .loan-doc__signatures {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
    margin-top: 28px;
  }
  .loan-doc__sig-line {
    border-top: 1px solid #000;
    padding-top: 4px;
    font-size: 0.78rem;
    font-weight: 600;
    text-align: center;
    color: #000;
  }
  .loan-doc__footer {
    margin-top: 20px;
    font-size: 0.78rem;
    font-weight: 500;
    color: #000;
    text-align: center;
  }
  @media print {
    html, body {
      background: #fff !important;
      color: #000 !important;
    }
    body { padding: 10mm; }
    .loan-doc, .loan-doc * {
      color: #000 !important;
    }
    .loan-doc__section h2 {
      background: #fff !important;
      border: 1px solid #000 !important;
    }
    .loan-doc__value {
      border-bottom-color: #000 !important;
    }
    .loan-doc__photo-box {
      border-color: #000 !important;
      background: #fff !important;
    }
    .loan-doc__photo-box img {
      filter: grayscale(100%) contrast(1.05);
    }
    .loan-doc__watermark {
      color: rgba(0, 0, 0, 0.14) !important;
    }
  }
`;

function field(label: string, value?: string | number | null, blank = false): string {
  const display =
    value != null && String(value).trim() !== "" ? escapeHtml(String(value)) : blank ? "&nbsp;" : "—";
  return `
    <div class="loan-doc__field">
      <div class="loan-doc__label">${escapeHtml(label)}</div>
      <div class="loan-doc__value${blank && !value ? " loan-doc__value--blank" : ""}">${display}</div>
    </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function photoBox(label: string, src?: string, blank = false): string {
  const inner = src
    ? `<img src="${src}" alt="${escapeHtml(label)}" />`
    : blank
      ? "Attach photo"
      : "—";
  return `<div class="loan-doc__photo-box" title="${escapeHtml(label)}">${inner}</div>`;
}

function buildDocumentBody(data: LoanReviewSnapshot | null, blank: boolean): string {
  const q = data?.qualification;
  const a = data?.applicant;
  const wm = data?.watermark
    ? `<div class="loan-doc__watermark" aria-hidden="true">${escapeHtml(data.watermark)}</div>`
    : "";

  const photos = `
    <div class="loan-doc__photos">
      ${photoBox("Passport photo", blank ? undefined : a?.photoUrl, blank)}
      <div>
        ${field("Full name", blank ? undefined : a?.fullName, blank)}
        ${field("Ghana Card / ID no.", blank ? undefined : a?.idCardNumber, blank)}
        ${field("Phone", blank ? undefined : a?.phone, blank)}
      </div>
    </div>
    <div class="loan-doc__field" style="margin-bottom:8px">
      <div class="loan-doc__label">ID card photo (front)</div>
      ${photoBox("ID card", blank ? undefined : a?.idCardPhotoUrl, blank)}
    </div>`;

  return `
    ${wm}
    <div class="loan-doc__header">
      <div class="loan-doc__brand">
        <h1>${escapeHtml(data?.companyName ?? "________________________")}</h1>
        <p>Loans &amp; Credit Department</p>
      </div>
      <div class="loan-doc__meta">
        ${blank ? field("Application ref.", undefined, true) : field("Application ref.", data?.applicationId ?? "Draft")}
        ${blank ? field("Date", undefined, true) : field("Date", data?.appliedAt ? formatLoanDate(data.appliedAt) : formatLoanDate(new Date().toISOString()))}
        ${data?.statusLabel && !blank ? field("Status", data.statusLabel) : ""}
      </div>
    </div>
    <p class="loan-doc__title">Loan Application Form</p>

    <section class="loan-doc__section">
      <h2>Section A — Applicant personal details</h2>
      ${photos}
      <div class="loan-doc__grid">
        ${field("Email", blank ? undefined : a?.email, blank)}
        ${field("Account no.", blank ? undefined : a?.accountNumber, blank)}
        ${field("Location / area", blank ? undefined : a?.location, blank)}
        ${field("House no. / GPS", blank ? undefined : a?.houseNumber, blank)}
        ${field("Home branch", blank ? undefined : a?.branchName, blank)}
      </div>
    </section>

    <section class="loan-doc__section">
      <h2>Section B — Employment &amp; income</h2>
      <div class="loan-doc__grid">
        ${field("Occupation / role", blank ? undefined : q?.occupation, blank)}
        ${field("Employer / business", blank ? undefined : q?.employerOrBusiness, blank)}
        ${field(
          "Source of income",
          blank ? undefined : q ? loanIncomeSourceLabel(q.sourceOfIncome, q.sourceOfIncomeOther) : undefined,
          blank
        )}
        ${field(
          "Monthly income (GHS)",
          blank ? undefined : q?.monthlyIncome != null ? formatLoanMoney(q.monthlyIncome) : undefined,
          blank
        )}
        ${field(
          "Monthly expenses (GHS)",
          blank ? undefined : q?.monthlyExpenses != null ? formatLoanMoney(q.monthlyExpenses) : undefined,
          blank
        )}
        ${field(
          "Existing loan balance",
          blank ? undefined : q?.existingLoanBalance != null ? formatLoanMoney(q.existingLoanBalance) : undefined,
          blank
        )}
        ${field("Years in current role", blank ? undefined : q?.yearsAtCurrentJob, blank)}
      </div>
    </section>

    <section class="loan-doc__section">
      <h2>Section C — Loan request</h2>
      <div class="loan-doc__grid">
        ${field("Product", blank ? undefined : data?.productName, blank)}
        ${field("Solidarity group", blank ? undefined : data?.groupName, blank)}
        ${field(
          "Principal (GHS)",
          blank ? undefined : data?.principalAmount != null ? formatLoanMoney(data.principalAmount) : undefined,
          blank
        )}
        ${field(
          "Interest rate",
          blank ? undefined : data?.interestRatePercent != null ? `${data.interestRatePercent}%` : undefined,
          blank
        )}
        ${field("Term (months)", blank ? undefined : data?.termMonths, blank)}
        ${field(
          "Repayment",
          blank ? undefined : data?.repaymentFrequency ? frequencyLabel(data.repaymentFrequency) : undefined,
          blank
        )}
        ${field(
          "Installment (GHS)",
          blank ? undefined : data?.installmentAmount != null ? formatLoanMoney(data.installmentAmount) : undefined,
          blank
        )}
        ${field("No. of installments", blank ? undefined : data?.installmentsTotal, blank)}
        ${field(
          "Total repayable",
          blank ? undefined : data?.totalRepayable != null ? formatLoanMoney(data.totalRepayable) : undefined,
          blank
        )}
        ${field(
          "Purpose",
          blank ? undefined : q ? loanPurposeLabel(q.loanPurpose, q.loanPurposeOther) : undefined,
          blank
        )}
        ${field("Notes", blank ? undefined : data?.applicationNotes, blank)}
      </div>
    </section>

    <section class="loan-doc__section">
      <h2>Section D — Guarantor</h2>
      <div class="loan-doc__grid">
        ${field("Full name", blank ? undefined : q?.guarantor.fullName, blank)}
        ${field("Phone", blank ? undefined : q?.guarantor.phone, blank)}
        ${field("Relationship", blank ? undefined : q?.guarantor.relationship, blank)}
        ${field("Occupation", blank ? undefined : q?.guarantor.occupation, blank)}
        ${field("Employer / business", blank ? undefined : q?.guarantor.employerOrBusiness, blank)}
        ${field(
          "Monthly income",
          blank ? undefined : q?.guarantor.monthlyIncome != null ? formatLoanMoney(q.guarantor.monthlyIncome) : undefined,
          blank
        )}
        ${field("Location", blank ? undefined : q?.guarantor.location, blank)}
        ${field("ID number", blank ? undefined : q?.guarantor.idCardNumber, blank)}
      </div>
    </section>

    <section class="loan-doc__section">
      <h2>Section E — Next of kin</h2>
      <div class="loan-doc__grid">
        ${field("Full name", blank ? undefined : a?.nextOfKin?.fullName, blank)}
        ${field("Phone", blank ? undefined : a?.nextOfKin?.phone, blank)}
        ${field("Location", blank ? undefined : a?.nextOfKin?.location, blank)}
        ${field("House no.", blank ? undefined : a?.nextOfKin?.houseNumber, blank)}
      </div>
    </section>

    <section class="loan-doc__section">
      <h2>Section F — Office use only</h2>
      <div class="loan-doc__grid">
        ${field("Recommended by", undefined, true)}
        ${field("Credit officer", undefined, true)}
        ${blank ? field("Decision", undefined, true) : field("Decision", data?.statusLabel)}
        ${blank ? field("Approved date", undefined, true) : field("Approved date", data?.approvedAt ? formatLoanDateTime(data.approvedAt) : undefined)}
        ${blank ? field("Disbursed date", undefined, true) : field("Disbursed date", data?.disbursedAt ? formatLoanDateTime(data.disbursedAt) : undefined)}
        ${data?.rejectionReason && !blank ? field("Rejection reason", data.rejectionReason) : field("Rejection reason", undefined, blank)}
      </div>
      <div class="loan-doc__signatures">
        <div class="loan-doc__sig-line">Applicant signature</div>
        <div class="loan-doc__sig-line">Guarantor signature</div>
        <div class="loan-doc__sig-line">Authorised officer</div>
      </div>
    </section>

    <p class="loan-doc__footer">
      I declare that the information provided is true and complete. I authorise ${escapeHtml(
        data?.companyName ?? "the institution"
      )} to verify my details and contact my guarantor.
    </p>`;
}

export function buildLoanDocumentHtml(options: {
  blank?: boolean;
  data?: LoanReviewSnapshot;
  title?: string;
}): string {
  const blank = options.blank ?? false;
  const title = options.title ?? (blank ? "Loan Application Form (Blank)" : "Loan Application");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <div class="loan-doc">
    ${buildDocumentBody(options.data ?? null, blank)}
  </div>
</body>
</html>`;
}

export function applicationToReviewSnapshot(
  application: LoanApplication,
  applicant: LoanApplicantProfile,
  options?: { companyName?: string; watermark?: string }
): LoanReviewSnapshot {
  return {
    companyName: options?.companyName,
    applicationId: application.id,
    statusLabel: application.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    watermark: options?.watermark,
    applicant,
    productName: application.productName ?? "—",
    groupName: application.groupName,
    principalAmount: application.principalAmount,
    interestRatePercent: application.interestRatePercent,
    termMonths: application.termMonths,
    repaymentFrequency: application.repaymentFrequency,
    installmentAmount: application.installmentAmount,
    installmentsTotal: application.installmentsTotal,
    totalRepayable: application.totalRepayable,
    totalInterest: application.totalInterest,
    applicationNotes: application.applicationNotes,
    qualification: {
      loanPurpose: application.loanPurpose ?? "personal",
      loanPurposeOther: application.loanPurposeOther,
      sourceOfIncome: application.sourceOfIncome ?? "other",
      sourceOfIncomeOther: application.sourceOfIncomeOther,
      occupation: application.occupation ?? "",
      employerOrBusiness: application.employerOrBusiness,
      monthlyIncome: application.monthlyIncome ?? 0,
      monthlyExpenses: application.monthlyExpenses,
      existingLoanBalance: application.existingLoanBalance,
      yearsAtCurrentJob: application.yearsAtCurrentJob,
      guarantor: application.guarantor ?? {
        fullName: "",
        phone: "",
        relationship: "",
        occupation: "",
        location: ""
      }
    },
    appliedAt: application.appliedAt,
    approvedAt: application.approvedAt,
    disbursedAt: application.disbursedAt,
    rejectionReason: application.rejectionReason
  };
}
