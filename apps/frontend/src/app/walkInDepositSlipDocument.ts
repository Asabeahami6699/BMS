import { APP_BRAND_NAME } from "@bms/shared";

export type WalkInDepositSlipOptions = {
  companyName?: string;
  companyLogoUrl?: string;
  companyPhone?: string;
};

const SLIP_COUNT = 6; // 2 columns x 3 rows on one A4 portrait sheet

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  }
  @page {
    size: A4 portrait;
    margin: 5mm;
  }
  .sheet {
    width: 200mm;
    height: 283mm;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: 3mm;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  @media screen {
    body {
      background: #eef1f5;
      padding: 8mm;
    }
    .sheet {
      background: #fff;
      width: 210mm;
      height: 297mm;
      padding: 5mm;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    }
  }
  .slip-cut {
    border: 0.75pt dashed #888;
    padding: 1.5mm;
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .slip {
    flex: 1 1 auto;
    border: 1.2pt solid #000;
    border-radius: 1.5mm;
    padding: 2.6mm 3.2mm 2.3mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 1.5mm;
    min-width: 0;
    min-height: 0;
    background: #fff;
  }
  .slip__header {
    display: flex;
    align-items: center;
    gap: 2.4mm;
    padding-bottom: 1.6mm;
    border-bottom: 1.2pt solid #000;
  }
  .slip__logo {
    width: 9.5mm;
    height: 9.5mm;
    object-fit: contain;
    flex: 0 0 auto;
    display: block;
  }
  .slip__brand {
    min-width: 0;
    flex: 1 1 auto;
  }
  .slip__company {
    margin: 0;
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1.12;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slip__subrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2mm;
    margin-top: 0.8mm;
  }
  .slip__badge {
    display: inline-block;
    font-size: 6.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.45mm 1.6mm;
    border: 0.8pt solid #000;
    border-radius: 0.8mm;
    line-height: 1.1;
  }
  .slip__date {
    font-size: 6.8pt;
    font-weight: 600;
    white-space: nowrap;
  }
  .slip__date-line {
    display: inline-block;
    width: 21mm;
    border-bottom: 0.75pt solid #000;
    vertical-align: bottom;
  }
  .slip__fields {
    display: flex;
    flex-direction: column;
    gap: 2mm;
    flex: 1 1 auto;
    justify-content: center;
  }
  .slip__field {
    display: flex;
    flex-direction: column;
    gap: 0.7mm;
  }
  .slip__field--inline {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: end;
    gap: 1.8mm;
  }
  .slip__label {
    font-size: 6.8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #111;
    white-space: nowrap;
  }
  .slip__line {
    border-bottom: 0.8pt solid #000;
    min-height: 4.3mm;
    width: 100%;
  }
  .slip__lines-2 {
    display: flex;
    flex-direction: column;
    gap: 1.6mm;
  }
  .slip__amount-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2mm;
  }
  .slip__amount-box {
    display: flex;
    align-items: center;
    border: 1pt solid #000;
    border-radius: 1mm;
    height: 7mm;
    overflow: hidden;
  }
  .slip__currency {
    font-size: 7.5pt;
    font-weight: 800;
    padding: 0 2.2mm;
    height: 100%;
    display: flex;
    align-items: center;
    border-right: 0.8pt solid #000;
    background: #f2f2f2;
    letter-spacing: 0.04em;
  }
  .slip__amount-space {
    flex: 1 1 auto;
    height: 100%;
  }
  .slip__footer {
    display: grid;
    grid-template-columns: 1fr 19mm;
    gap: 2.8mm;
    align-items: end;
    padding-top: 1.2mm;
    border-top: 0.6pt dotted #666;
  }
  .slip__sig-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.9mm;
  }
  .slip__sig-line {
    border-bottom: 0.8pt solid #000;
    height: 9.5mm;
  }
  .slip__sig-caption {
    font-size: 6.3pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #222;
  }
  .slip__thumb {
    border: 0.85pt solid #000;
    border-radius: 1mm;
    height: 13.2mm;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 0.7mm;
    font-size: 5.7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #333;
  }
  @media print {
    html, body {
      width: 200mm;
      height: 283mm;
      overflow: hidden;
      background: #fff;
      padding: 0;
    }
    .sheet {
      width: 100%;
      height: 283mm;
      padding: 0;
      box-shadow: none;
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

function renderSingleSlip(company: string, logoUrl: string): string {
  const logoHtml = logoUrl
    ? `<img class="slip__logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company)} logo" />`
    : "";

  return `<div class="slip-cut">
    <section class="slip" aria-label="Walk-in deposit slip">
      <header class="slip__header">
        ${logoHtml}
        <div class="slip__brand">
          <p class="slip__company">${escapeHtml(company)}</p>
          <div class="slip__subrow">
            <span class="slip__badge">Walk-in Deposit</span>
            <span class="slip__date">Date: <span class="slip__date-line"></span></span>
          </div>
        </div>
      </header>

      <div class="slip__fields">
        <div class="slip__field slip__field--inline">
          <span class="slip__label">Account No.:</span>
          <div class="slip__line"></div>
        </div>

        <div class="slip__field slip__field--inline">
          <span class="slip__label">Account Name:</span>
          <div class="slip__line"></div>
        </div>

        <div class="slip__field">
          <span class="slip__label">Amount in Words:</span>
          <div class="slip__lines-2">
            <div class="slip__line"></div>
            <div class="slip__line"></div>
          </div>
        </div>

        <div class="slip__amount-row">
          <span class="slip__label">Amount in Figures:</span>
          <div class="slip__amount-box">
            <span class="slip__currency">GHS</span>
            <span class="slip__amount-space"></span>
          </div>
        </div>
      </div>

      <footer class="slip__footer">
        <div class="slip__sig-wrap">
          <div class="slip__sig-line"></div>
          <span class="slip__sig-caption">Signature / Thumbprint</span>
        </div>
        <div class="slip__thumb">Thumbprint</div>
      </footer>
    </section>
  </div>`;
}

export function buildWalkInDepositSlipSheetHtml(options: WalkInDepositSlipOptions = {}): string {
  const company = options.companyName?.trim() || APP_BRAND_NAME;
  const logoUrl = options.companyLogoUrl?.trim() || "";
  const slips = Array.from({ length: SLIP_COUNT }, () => renderSingleSlip(company, logoUrl)).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(company)} — Walk-in Deposit Slips (6 per A4)</title>
    <style>${DOCUMENT_STYLES}</style>
  </head>
  <body>
    <main class="sheet">
      ${slips}
    </main>
  </body>
</html>`;
}
