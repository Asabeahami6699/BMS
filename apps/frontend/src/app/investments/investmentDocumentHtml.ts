import type {
  InvestmentBeneficiary,
  InvestmentFormConfig,
  InvestmentFormField,
  InvestmentRecord
} from "@bms/shared";
import { formatInvestmentTenureLabel } from "@bms/shared";
import { investmentSectionsOrdered, visibleInvestmentFields, formatInvestmentMoney } from "./investmentUi";

const RAIL_SECTION_IDS = new Set(["photo"]);
const SKIP_FIELD_TYPES = new Set(["file", "signature"]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFieldValue(field: InvestmentFormField, raw: unknown): string {
  if (raw == null || raw === "") {
    return "—";
  }
  if (field.type === "file" || field.type === "signature") {
    return "On file";
  }
  if (field.type === "checkbox") {
    return raw === true || raw === "true" ? "Yes" : "No";
  }
  return String(raw);
}

function infoRow(label: string, value: string, fullWidth = false): string {
  return `<div class="doc-row${fullWidth ? " doc-row--full" : ""}">
    <span class="doc-row__label">${escapeHtml(label)}</span>
    <span class="doc-row__value">${escapeHtml(value)}</span>
  </div>`;
}

function section(title: string, body: string): string {
  return `<section class="doc-block">
    <h3 class="doc-block__title">${escapeHtml(title)}</h3>
    <div class="doc-block__body">${body}</div>
  </section>`;
}

function grid(rows: string): string {
  return `<div class="doc-grid">${rows}</div>`;
}

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 32px;
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.45;
    color: #1a1f36;
    background: #fff;
  }
  .doc {
    display: flex;
    align-items: flex-start;
    gap: 28px;
    max-width: 980px;
    margin: 0 auto;
  }
  .doc-main { flex: 1; min-width: 0; }
  .doc-rail {
    width: 168px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .doc-header {
    margin-bottom: 18px;
    padding: 16px 18px;
    border: 1px solid #d8deea;
    border-radius: 10px;
    background: linear-gradient(135deg, #f4f7ff 0%, #fff 100%);
  }
  .doc-header__eyebrow {
    margin: 0 0 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5c6b8a;
  }
  .doc-header__number {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .doc-header__meta {
    margin: 0;
    color: #5c6b8a;
  }
  .doc-block {
    margin-bottom: 16px;
    break-inside: avoid;
  }
  .doc-block__title {
    margin: 0 0 8px;
    padding-bottom: 6px;
    font-size: 12px;
    font-weight: 700;
    border-bottom: 1px solid #e4e9f2;
    color: #243154;
  }
  .doc-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 20px;
  }
  .doc-row { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .doc-row--full { grid-column: 1 / -1; }
  .doc-row__label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #6b7894;
  }
  .doc-row__value {
    font-size: 11px;
    font-weight: 500;
    color: #1a1f36;
    word-break: break-word;
  }
  .doc-portrait {
    text-align: center;
    padding: 12px;
    border: 1px solid #e4e9f2;
    border-radius: 10px;
    background: #fafbfd;
  }
  .doc-portrait__frame {
    width: 100%;
    aspect-ratio: 3 / 4;
    border-radius: 8px;
    overflow: hidden;
    background: #eef1f7;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .doc-portrait__frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .doc-portrait__fallback {
    font-size: 28px;
    font-weight: 700;
    color: #8a94a8;
  }
  .doc-portrait__name {
    margin: 10px 0 2px;
    font-size: 12px;
    font-weight: 700;
  }
  .doc-portrait__role {
    margin: 0;
    font-size: 10px;
    color: #6b7894;
  }
  .doc-kyc {
    padding: 12px;
    border: 1px solid #e4e9f2;
    border-radius: 10px;
    background: #fafbfd;
  }
  .doc-kyc__title {
    margin: 0 0 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #5c6b8a;
  }
  .doc-kyc__preview {
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #d8deea;
    background: #fff;
  }
  .doc-kyc__preview img {
    width: 100%;
    display: block;
    object-fit: contain;
    max-height: 120px;
  }
  .doc-kyc__missing {
    padding: 16px 8px;
    text-align: center;
    font-size: 10px;
    color: #8a94a8;
    border: 1px dashed #d0d7e6;
    border-radius: 6px;
  }
  .doc-beneficiary {
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px dashed #e4e9f2;
  }
  .doc-beneficiary:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }
  @media print {
    body { padding: 12mm; }
    .doc { gap: 20px; }
  }
`;

type ImageUrls = {
  portraitUrl?: string;
  idPhotoUrl?: string;
};

function buildRailHtml(investment: InvestmentRecord, images: ImageUrls): string {
  const initials = investment.customerName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  const portraitInner = images.portraitUrl
    ? `<img src="${images.portraitUrl}" alt="Customer portrait" />`
    : `<div class="doc-portrait__fallback">${escapeHtml(initials || "?")}</div>`;

  const idInner = images.idPhotoUrl
    ? `<div class="doc-kyc__preview"><img src="${images.idPhotoUrl}" alt="ID verification" /></div>`
    : `<div class="doc-kyc__missing">No ID scan on file</div>`;

  return `<aside class="doc-rail">
    <div class="doc-portrait">
      <div class="doc-portrait__frame">${portraitInner}</div>
      <p class="doc-portrait__name">${escapeHtml(investment.customerName)}</p>
      <p class="doc-portrait__role">${escapeHtml(investment.productName)}</p>
    </div>
    <div class="doc-kyc">
      <p class="doc-kyc__title">ID verification</p>
      ${idInner}
    </div>
  </aside>`;
}

function buildSectionsHtml(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig,
  includeInvestmentTerms: boolean
): string {
  const snapshot = investment.customerSnapshot;
  const sections = investmentSectionsOrdered(formConfig).filter(
    (s) => s.id !== "beneficiaries" && !RAIL_SECTION_IDS.has(s.id)
  );
  const fields = visibleInvestmentFields(formConfig).filter((f) => !SKIP_FIELD_TYPES.has(f.type));
  const blocks: string[] = [];

  if (includeInvestmentTerms) {
    blocks.push(
      section(
        "Investment terms",
        grid(
          [
            infoRow("Principal", formatInvestmentMoney(investment.principalAmount)),
            infoRow("Rate", `${investment.interestRatePercent}%`),
            infoRow("Tenure", formatInvestmentTenureLabel(investment.tenureDays)),
            infoRow("Start date", investment.startDate),
            infoRow("Maturity date", investment.maturityDate),
            infoRow("Expected interest", formatInvestmentMoney(investment.expectedInterest)),
            infoRow("Maturity value", formatInvestmentMoney(investment.expectedMaturityValue)),
            infoRow(
              "Auto renewal",
              String(snapshot.autoRenewal ?? investment.autoRenewal).replace(/_/g, " ")
            ),
            infoRow("Status", investment.status),
            infoRow("Branch", investment.branchName ?? investment.branchId)
          ].join("")
        )
      )
    );
  }

  for (const formSection of sections) {
    const sectionFields = fields.filter((field) => field.sectionId === formSection.id);
    if (!sectionFields.length) {
      continue;
    }
    blocks.push(
      section(
        formSection.title,
        grid(
          sectionFields
            .map((field) =>
              infoRow(
                field.label,
                formatFieldValue(field, snapshot[field.key]),
                field.type === "textarea"
              )
            )
            .join("")
        )
      )
    );
  }

  if (investment.beneficiaries.length > 0) {
    blocks.push(
      section(
        "Beneficiaries",
        investment.beneficiaries
          .map((beneficiary: InvestmentBeneficiary, index) => {
            const suffix = investment.beneficiaries.length > 1 ? ` ${index + 1}` : "";
            return `<div class="doc-beneficiary">${grid(
              [
                infoRow(`Name${suffix}`, beneficiary.name),
                infoRow("Relationship", beneficiary.relationship ?? "—"),
                infoRow("Phone", beneficiary.phone ?? "—"),
                infoRow("Allocation", `${beneficiary.allocationPercent}%`)
              ].join("")
            )}</div>`;
          })
          .join("")
      )
    );
  }

  return blocks.join("");
}

function wrapDocument(title: string, mainHtml: string, railHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <div class="doc">
    <main class="doc-main">
      ${mainHtml}
    </main>
    ${railHtml}
  </div>
</body>
</html>`;
}

export function buildInvestmentCustomerDetailsHtml(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig,
  images: ImageUrls
): string {
  const header = `<header class="doc-header">
    <p class="doc-header__eyebrow">BMS · Investment customer record</p>
    <p class="doc-header__number">${escapeHtml(investment.investmentNumber)}</p>
    <p class="doc-header__meta">${escapeHtml(investment.customerName)}${investment.customerPhone ? ` · ${escapeHtml(investment.customerPhone)}` : ""}</p>
  </header>`;

  const mainHtml = `${header}${buildSectionsHtml(investment, formConfig, true)}`;
  const railHtml = buildRailHtml(investment, images);
  return wrapDocument(
    `Customer record — ${investment.investmentNumber}`,
    mainHtml,
    railHtml
  );
}

export function buildInvestmentApplicationHtml(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig,
  images: ImageUrls
): string {
  const header = `<header class="doc-header">
    <p class="doc-header__eyebrow">BMS · Investment application</p>
    <p class="doc-header__number">${escapeHtml(investment.investmentNumber)}</p>
    <p class="doc-header__meta">${escapeHtml(investment.customerName)} · ${escapeHtml(investment.productName)}</p>
  </header>`;

  const mainHtml = `${header}${buildSectionsHtml(investment, formConfig, true)}`;
  const railHtml = buildRailHtml(investment, images);
  return wrapDocument(
    `Application — ${investment.investmentNumber}`,
    mainHtml,
    railHtml
  );
}

export { DOCUMENT_STYLES };
