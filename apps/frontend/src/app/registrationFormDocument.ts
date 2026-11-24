import { APP_BRAND_NAME, type RegistrationFormSetup } from "@bms/shared";

export type RegistrationFormDocumentOptions = {
  setup: RegistrationFormSetup;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogoUrl?: string;
  /** Marks the paper form as the built-in default layout. */
  isDefault?: boolean;
};

/** Fixed paper labels for account-type checkboxes (single-line bar). */
const PAPER_ACCOUNT_TYPE_LABELS = ["Susu", "Savings", "Current"] as const;

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    margin: 0;
    padding: 0;
  }
  @page {
    size: A4 portrait;
    margin: 9mm 10mm;
  }
  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 9.5pt;
    color: #000;
    line-height: 1.25;
    background: #fff;
  }
  .reg-doc {
    width: 100%;
    max-width: 190mm;
    margin: 0 auto;
    color: #000;
    background: #fff;
  }
  @media screen {
    body {
      background: #eef1f5;
      padding: 12mm 8mm;
    }
    .reg-doc {
      width: 210mm;
      max-width: 210mm;
      min-height: 297mm;
      padding: 9mm 10mm;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
    }
  }
  .reg-doc__masthead {
    display: grid;
    grid-template-columns: 1fr 34mm;
    gap: 4mm;
    align-items: stretch;
    margin-bottom: 4mm;
  }
  .reg-doc__masthead-left {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
  }
  .reg-doc__brand {
    display: flex;
    align-items: center;
    gap: 3.5mm;
    padding-bottom: 2.5mm;
    border-bottom: 2px solid #000;
  }
  .reg-doc__logo {
    width: 15.5mm;
    height: 15.5mm;
    object-fit: contain;
    flex: 0 0 auto;
    display: block;
  }
  .reg-doc__brand-text {
    min-width: 0;
    flex: 1 1 auto;
  }
  .reg-doc__company {
    margin: 0;
    font-size: 13.5pt;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    line-height: 1.15;
  }
  .reg-doc__contact {
    margin: 1mm 0 0;
    font-size: 7.5pt;
    color: #222;
    line-height: 1.2;
  }
  .reg-doc__title {
    margin: 1.5mm 0 0;
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .reg-doc__account-bar {
    margin-top: 2.8mm;
    border: 1.2px solid #000;
    padding: 2.2mm 3mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 3mm;
    flex-wrap: nowrap;
  }
  .reg-doc__account-heading {
    font-size: 7.8pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  .reg-doc__accounts {
    display: inline-flex;
    align-items: center;
    gap: 5.5mm;
    flex-wrap: nowrap;
  }
  .reg-doc__account {
    display: inline-flex;
    align-items: center;
    gap: 1.8mm;
    font-weight: 700;
    font-size: 9pt;
    white-space: nowrap;
  }
  .reg-doc__box {
    width: 3.8mm;
    height: 3.8mm;
    border: 1.4px solid #000;
    display: inline-block;
    flex: 0 0 auto;
  }
  .reg-doc__photo {
    border: 1.2px solid #000;
    width: 34mm;
    min-height: 34mm;
    padding: 2mm;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .reg-doc__photo-inner {
    border: 1px dashed #666;
    width: 100%;
    height: 100%;
    min-height: 29mm;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2mm;
    line-height: 1.25;
  }
  .reg-doc__section {
    margin-bottom: 4mm;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .reg-doc__section:last-child {
    margin-bottom: 0;
  }
  .reg-doc__section h2 {
    margin: 0 0 2.8mm;
    font-size: 7.8pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    border: 1.2px solid #000;
    background: #f2f2f2;
    padding: 1.3mm 2.5mm;
  }
  .reg-doc__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3.4mm 5.5mm;
  }
  .reg-doc__field--wide {
    grid-column: 1 / -1;
  }
  .reg-doc__label {
    font-size: 6.8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1.15;
  }
  .reg-doc__line {
    border-bottom: 1px solid #000;
    min-height: 6.4mm;
    margin-top: 0.6mm;
  }
  .reg-doc__note {
    font-size: 7.5pt;
    margin: 3mm 0 0;
    line-height: 1.3;
  }
  .reg-doc__sign-block {
    margin-top: 2mm;
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 10mm;
  }
  .reg-doc__sign-line {
    border-top: 1px solid #000;
    margin-top: 10.5mm;
    padding-top: 1.3mm;
    font-size: 7.5pt;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .reg-doc__office {
    margin-top: 3.5mm;
    border-top: 2px solid #000;
    padding-top: 3mm;
  }
  @media print {
    html, body {
      width: 100%;
      height: auto;
      background: #fff;
      padding: 0;
      margin: 0;
    }
    .reg-doc {
      width: 100%;
      max-width: none;
      min-height: auto;
      padding: 0;
      box-shadow: none;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isUsableLogoUrl(logoUrl: string | undefined | null): logoUrl is string {
  if (!logoUrl?.trim()) {
    return false;
  }
  const value = logoUrl.trim();
  return /^data:image\/(jpeg|png|webp|gif|svg\+xml)/i.test(value) || /^https?:\/\//i.test(value);
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
  const logoUrl = isUsableLogoUrl(options.companyLogoUrl) ? options.companyLogoUrl.trim() : undefined;

  const contactParts = [
    options.companyAddress?.trim(),
    options.companyPhone?.trim() ? `Tel: ${options.companyPhone.trim()}` : undefined
  ].filter((part): part is string => Boolean(part));

  const contactHtml =
    contactParts.length > 0
      ? `<p class="reg-doc__contact">${escapeHtml(contactParts.join("  •  "))}</p>`
      : "";

  const logoHtml = logoUrl
    ? `<img class="reg-doc__logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company)} logo" />`
    : "";

  const accountBlocks = PAPER_ACCOUNT_TYPE_LABELS.map(
    (label) => `<label class="reg-doc__account">
      <span class="reg-doc__box" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
    </label>`
  ).join("");

  // Keep fields paired cleanly in 2 columns so the entire form fits on one A4 sheet.
  const personalFieldDefs: Array<{ label: string; wide?: boolean }> = [
    { label: "Full name" },
    { label: "Phone number" },
    { label: "Date of birth (DOB)" },
    { label: "Occupation" },
    { label: "Marital status" },
    ...(fields.houseNumber !== "hidden" ? [{ label: "House number" }] : []),
    { label: "Location / area" },
    ...(fields.email !== "hidden" ? [{ label: "Email address" }] : []),
    ...(fields.idCardNumber !== "hidden"
      ? [
          { label: "ID type (Ghana Card / Voter's / NHIS / Driver's Licence / Passport)" },
          { label: "ID card number" }
        ]
      : []),
    ...(fields.dailyContribution !== "hidden" ? [{ label: "Daily contribution (GHS)" }] : [])
  ];

  // If optional hidden settings produce an odd count, expand Location/Area or the last field cleanly
  // only when it won't add an extra row (i.e. leave it spanning its own final row).
  if (personalFieldDefs.length % 2 === 1) {
    const last = personalFieldDefs[personalFieldDefs.length - 1];
    if (last) {
      last.wide = true;
    }
  }

  const personalFields = personalFieldDefs.map((field) => blankField(field.label, field.wide)).join("");

  const showNextOfKin = fields.nextOfKin !== "hidden";
  const kinFields = [
    blankField("Next of kin full name"),
    blankField("Next of kin phone"),
    blankField("Next of kin location"),
    blankField("Next of kin house number")
  ].join("");

  const officeFields = [
    blankField("Home branch"),
    blankField("Assigned field agent"),
    blankField("Account number"),
    blankField("Registration date"),
    blankField("Staff name"),
    blankField("Approved by")
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
    <header class="reg-doc__masthead">
      <div class="reg-doc__masthead-left">
        <div class="reg-doc__brand">
          ${logoHtml}
          <div class="reg-doc__brand-text">
            <h1 class="reg-doc__company">${escapeHtml(company)}</h1>
            ${contactHtml}
            <p class="reg-doc__title">Customer Registration Form</p>
          </div>
        </div>

        <div class="reg-doc__account-bar" role="group" aria-label="Account type">
          <span class="reg-doc__account-heading">Account Type:</span>
          <div class="reg-doc__accounts">${accountBlocks}</div>
        </div>
      </div>

      <div class="reg-doc__photo">
        <div class="reg-doc__photo-inner">Customer<br />Photo</div>
      </div>
    </header>

    <section class="reg-doc__section">
      <h2>Customer Details</h2>
      <div class="reg-doc__grid">${personalFields}</div>
      <p class="reg-doc__note">
        I confirm that the information on this form is true and I agree to the account rules that apply.
        ID card photo is captured in the system registration only (not on this paper form).
      </p>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Customer signature / thumbprint</div>
        <div class="reg-doc__sign-line">Date</div>
      </div>
    </section>

    ${
      showNextOfKin
        ? `<section class="reg-doc__section">
      <h2>Next of Kin</h2>
      <div class="reg-doc__grid">${kinFields}</div>
    </section>`
        : ""
    }

    <section class="reg-doc__section reg-doc__office">
      <h2>Office Use Only</h2>
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

const SIMPLIFIED_KYC_EXTRA_STYLES = `
  @page {
    size: A4 portrait;
    margin: 6.5mm 9mm;
  }
  @media screen {
    .reg-doc--kyc {
      padding: 6.5mm 9mm;
    }
  }
  .reg-doc--kyc .reg-doc__masthead {
    grid-template-columns: 1fr 29mm;
    gap: 3.5mm;
    margin-bottom: 2.8mm;
  }
  .reg-doc--kyc .reg-doc__brand {
    padding-bottom: 2mm;
  }
  .reg-doc--kyc .reg-doc__logo {
    width: 14.5mm;
    height: 14.5mm;
  }
  .reg-doc--kyc .reg-doc__company {
    font-size: 15pt;
  }
  .reg-doc--kyc .reg-doc__contact {
    font-size: 9pt;
  }
  .reg-doc--kyc .reg-doc__title {
    margin-top: 1.2mm;
    font-size: 10.8pt;
  }
  .reg-doc--kyc .reg-doc__photo {
    width: 29mm;
    min-height: 28mm;
    padding: 1.6mm;
  }
  .reg-doc--kyc .reg-doc__photo-inner {
    min-height: 24mm;
    font-size: 8.4pt;
    padding: 1.2mm;
  }
  .reg-doc--kyc .reg-doc__section {
    margin: 0 0 2.8mm;
  }
  .reg-doc--kyc .reg-doc__section:last-child {
    margin-bottom: 0;
  }
  .reg-doc--kyc .reg-doc__section h2 {
    margin: 0 0 2mm;
    padding: 1.2mm 2.6mm;
    font-size: 9.6pt;
  }
  .reg-doc--kyc .reg-doc__grid {
    gap: 2.3mm 5mm;
  }
  .reg-doc--kyc .reg-doc__label {
    font-size: 8.8pt;
    line-height: 1.2;
  }
  .reg-doc--kyc .reg-doc__line {
    min-height: 5.8mm;
    margin-top: 0.4mm;
  }
  .reg-doc--kyc .reg-doc__note {
    margin: 2mm 0 0;
    font-size: 9.2pt;
    line-height: 1.3;
  }
  .reg-doc--kyc .reg-doc__sign-block {
    margin-top: 1.2mm;
  }
  .reg-doc--kyc .reg-doc__sign-line {
    margin-top: 7mm;
    padding-top: 1.2mm;
    font-size: 9pt;
  }
  .reg-doc__kyc-pill {
    display: inline-block;
    margin-top: 1.4mm;
    padding: 0.8mm 2.6mm;
    border-radius: 3px;
    border: 1px solid #b45309;
    background: #fef3c7;
    color: #92400e;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .reg-doc__introducer {
    padding: 2.2mm 3mm;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    background: #f8fafc;
  }
  .reg-doc__introducer h2 {
    margin-top: 0;
  }
  .reg-doc--kyc .reg-doc__office {
    padding-top: 0;
  }
`;

export function buildSimplifiedKycRegistrationFormDocumentHtml(
  options: RegistrationFormDocumentOptions
): string {
  const company = options.companyName?.trim() || APP_BRAND_NAME;
  const fields = options.setup.fields;
  const logoUrl = isUsableLogoUrl(options.companyLogoUrl) ? options.companyLogoUrl.trim() : undefined;

  const contactParts = [
    options.companyAddress?.trim(),
    options.companyPhone?.trim() ? `Tel: ${options.companyPhone.trim()}` : undefined
  ].filter((part): part is string => Boolean(part));

  const contactHtml =
    contactParts.length > 0
      ? `<p class="reg-doc__contact">${escapeHtml(contactParts.join("  •  "))}</p>`
      : "";

  const logoHtml = logoUrl
    ? `<img class="reg-doc__logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company)} logo" />`
    : "";

  const personalFieldDefs: Array<{ label: string; wide?: boolean }> = [
    { label: "Full name" },
    { label: "Phone number" },
    { label: "Nationality / country of origin" },
    { label: "Date of birth (DOB)" },
    { label: "Occupation" },
    ...(fields.houseNumber !== "hidden" ? [{ label: "House / shop number" }] : []),
    { label: "Location / area / landmark" },
    ...(fields.dailyContribution !== "hidden" ? [{ label: "Daily Susu contribution (GHS)" }] : [])
  ];
  if (personalFieldDefs.length % 2 === 1) {
    const last = personalFieldDefs[personalFieldDefs.length - 1];
    if (last) last.wide = true;
  }
  const personalFields = personalFieldDefs.map((f) => blankField(f.label, f.wide)).join("");

  const introducerFields = [
    blankField("Introducer full name"),
    blankField("Introducer phone number"),
    blankField("Relationship (Landlord / Employer / Market Leader / Customer)"),
    blankField("Introducer Ghana Card number (GHA-XXXXXXXXX-X)")
  ].join("");

  const showNextOfKin = fields.nextOfKin !== "hidden";
  const kinFields = [
    blankField("Next of kin full name"),
    blankField("Next of kin phone"),
    blankField("Next of kin location / house number", true)
  ].join("");

  const officeFields = [
    blankField("Home branch"),
    blankField("Assigned field agent"),
    blankField("Account number"),
    blankField("Registration date & Approved by")
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tier 1 Simplified KYC Registration Form</title>
  <style>${DOCUMENT_STYLES}${SIMPLIFIED_KYC_EXTRA_STYLES}</style>
</head>
<body>
  <article class="reg-doc reg-doc--kyc">
    <header class="reg-doc__masthead">
      <div class="reg-doc__masthead-left">
        <div class="reg-doc__brand">
          ${logoHtml}
          <div class="reg-doc__brand-text">
            <h1 class="reg-doc__company">${escapeHtml(company)}</h1>
            ${contactHtml}
            <p class="reg-doc__title">Customer Registration Form — Simplified KYC (No National ID)</p>
            <span class="reg-doc__kyc-pill">BoG Tier 1 · Simplified KYC (Susu Only)</span>
          </div>
        </div>
      </div>

      <div class="reg-doc__photo">
        <div class="reg-doc__photo-inner">Customer<br />Face Photo<br />(Required)</div>
      </div>
    </header>

    <section class="reg-doc__section">
      <h2>1. Customer Details</h2>
      <div class="reg-doc__grid">${personalFields}</div>
      <p class="reg-doc__note">
        I confirm that the details above are true, agree to the Tier 1 Simplified KYC Susu account rules, and undertake to
        provide a valid ID when obtained.
      </p>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Customer signature / thumbprint</div>
        <div class="reg-doc__sign-line">Date</div>
      </div>
    </section>

    <section class="reg-doc__section reg-doc__introducer">
      <h2>2. Local Introducer Attestation (Valid Ghana Card Holder — Mandatory)</h2>
      <div class="reg-doc__grid">${introducerFields}</div>
      <p class="reg-doc__note">
        I confirm that I personally know the applicant named above, verify their residential or business address, and vouch
        for their identity for this Tier 1 Simplified KYC Susu account.
      </p>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Introducer signature / thumbprint</div>
        <div class="reg-doc__sign-line">Date</div>
      </div>
    </section>

    ${
      showNextOfKin
        ? `<section class="reg-doc__section">
      <h2>3. Next of Kin</h2>
      <div class="reg-doc__grid">${kinFields}</div>
    </section>`
        : ""
    }

    <section class="reg-doc__section reg-doc__office">
      <h2>${showNextOfKin ? "4" : "3"}. Office Use Only</h2>
      <div class="reg-doc__grid">${officeFields}</div>
      <div class="reg-doc__sign-block">
        <div class="reg-doc__sign-line">Field agent / staff signature</div>
        <div class="reg-doc__sign-line">Coordinator approval signature &amp; date</div>
      </div>
    </section>
  </article>
</body>
</html>`;
}
