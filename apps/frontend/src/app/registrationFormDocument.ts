import { APP_BRAND_NAME, type RegistrationFormSetup } from "@bms/shared";

export type RegistrationFormDocumentOptions = {
  setup: RegistrationFormSetup;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  /** Marks the paper form as the built-in default layout. */
  isDefault?: boolean;
};

/** Fixed paper labels for account-type checkboxes. */
const PAPER_ACCOUNT_TYPE_LABELS = ["Susu", "Savings", "Current", "Meba Daakye", "Group"] as const;

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page {
    size: A4;
    margin: 10mm;
  }
  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 10.5pt;
    color: #000;
    margin: 0;
    padding: 0;
    line-height: 1.35;
    background: #fff;
  }
  .reg-doc {
    width: 100%;
    color: #000;
  }
  .reg-doc__company {
    text-align: center;
    margin: 0 0 6px;
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .reg-doc__title {
    text-align: center;
    margin: 0 0 10px;
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
  }
  .reg-doc__top {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 12px;
    align-items: start;
    margin-bottom: 12px;
  }
  .reg-doc__section {
    margin-bottom: 10px;
    page-break-inside: avoid;
  }
  .reg-doc__section h2 {
    margin: 0 0 6px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    border: 1px solid #000;
    padding: 3px 7px;
  }
  .reg-doc__accounts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
    min-height: 110px;
    border: 1px solid #000;
    padding: 10px;
  }
  .reg-doc__account {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .reg-doc__box {
    width: 14px;
    height: 14px;
    border: 1.5px solid #000;
    flex: 0 0 auto;
  }
  .reg-doc__photo {
    border: 1px solid #000;
    height: 130px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 6px;
  }
  .reg-doc__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px 14px;
  }
  .reg-doc__field--wide { grid-column: 1 / -1; }
  .reg-doc__label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .reg-doc__line {
    border-bottom: 1px solid #000;
    min-height: 1.45em;
    margin-top: 2px;
  }
  .reg-doc__note {
    font-size: 0.8rem;
    margin: 0 0 6px;
  }
  .reg-doc__id-photo {
    border: 1px solid #000;
    min-height: 90px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    margin-top: 8px;
  }
  .reg-doc__sign-block {
    margin-top: 10px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .reg-doc__sign-line {
    border-top: 1px solid #000;
    margin-top: 34px;
    padding-top: 5px;
    font-size: 0.78rem;
    font-weight: 700;
    text-align: center;
  }
  .reg-doc__office {
    margin-top: 12px;
    border-top: 2px solid #000;
    padding-top: 8px;
  }
  @media print {
    body { padding: 0; }
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function blankField(label: string, wide = false): string {
  return `<div class="reg-doc__field${wide ? " reg-doc__field--wide" : ""}">
    <div class="reg-doc__label">${escapeHtml(label)}</div>
    <div class="reg-doc__line"></div>
  </div>`;
}

export function buildRegistrationFormDocumentHtml(options: RegistrationFormDocumentOptions): string {
  const company = options.companyName?.trim() || APP_BRAND_NAME;
  const fields = options.setup.fields;

  const accountBlocks = PAPER_ACCOUNT_TYPE_LABELS.map(
    (label) => `<label class="reg-doc__account">
      <span class="reg-doc__box" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
    </label>`
  ).join("");

  const personalFields = [
    blankField("Full name"),
    blankField("Phone"),
    blankField("Date of birth (DOB)"),
    blankField("Occupation"),
    blankField("Marital status"),
    blankField("Location / area", true),
    fields.houseNumber !== "hidden" ? blankField("House number") : "",
    fields.email !== "hidden" ? blankField("Email", true) : "",
    fields.idCardNumber !== "hidden" ? blankField("ID card number") : "",
    fields.dailyContribution !== "hidden" ? blankField("Daily contribution (GHS)") : ""
  ]
    .filter(Boolean)
    .join("");

  const kinFields = [
    blankField("Next of kin full name"),
    blankField("Next of kin phone"),
    blankField("Next of kin location", true),
    blankField("Next of kin house number")
  ].join("");

  const officeFields = [
    blankField("Home branch"),
    blankField("Assigned field agent"),
    blankField("Account number"),
    blankField("Registration date"),
    blankField("Staff name")
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Customer Registration Form</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <article class="reg-doc">
    <h1 class="reg-doc__company">${escapeHtml(company)}</h1>
    <p class="reg-doc__title">Customer Registration Form</p>

    <div class="reg-doc__top">
      <section class="reg-doc__section" style="margin:0">
        <h2>Account type</h2>
        <div class="reg-doc__accounts">${accountBlocks}</div>
      </section>
      <div class="reg-doc__photo">Customer photo</div>
    </div>

    <section class="reg-doc__section">
      <h2>Customer details</h2>
      <div class="reg-doc__grid">${personalFields}</div>
      ${fields.idCardPhoto !== "hidden" ? `<div class="reg-doc__id-photo">ID card photo</div>` : ""}
      <p class="reg-doc__note" style="margin-top:8px">
        I confirm that the information on this form is true and I agree to the account rules that apply.
      </p>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Customer signature</div>
        <div class="reg-doc__sign-line">Date</div>
      </div>
    </section>

    <section class="reg-doc__section">
      <h2>Next of kin</h2>
      <div class="reg-doc__grid">${kinFields}</div>
    </section>

    <section class="reg-doc__section reg-doc__office">
      <h2>Office use</h2>
      <div class="reg-doc__grid">${officeFields}</div>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Office / staff signature</div>
        <div class="reg-doc__sign-line">Date</div>
      </div>
    </section>
  </article>
</body>
</html>`;
}
