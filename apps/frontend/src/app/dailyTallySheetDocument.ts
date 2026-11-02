import { APP_BRAND_NAME } from "@bms/shared";

export type DailyTallySheetOptions = {
  companyName?: string;
  mobilizerName?: string;
  /** ISO date or display date; blank line if omitted. */
  dateLabel?: string;
  rowCount?: number;
};

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page {
    size: A4;
    margin: 7mm;
  }
  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 9pt;
    color: #000;
    margin: 0;
    padding: 0;
    line-height: 1.15;
    background: #fff;
  }
  .tally {
    width: 100%;
  }
  .tally__company {
    text-align: center;
    margin: 0 0 4px;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
  }
  .tally__meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 16px;
    margin: 0 0 4px;
  }
  .tally__meta-item {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px;
    align-items: end;
  }
  .tally__meta-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .tally__meta-line {
    border-bottom: 1px solid #000;
    min-height: 1.1em;
    font-weight: 600;
    padding-bottom: 1px;
  }
  .tally__title {
    text-align: center;
    margin: 0 0 4px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  table.tally__table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .tally__table th,
  .tally__table td {
    border: 1px solid #000;
    padding: 0 3px;
    vertical-align: middle;
  }
  .tally__table th {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: #fff;
    height: 16px;
  }
  .tally__table td {
    height: 16.5px;
  }
  .tally__col-no { width: 7%; text-align: center; }
  .tally__col-name { width: 34%; }
  .tally__col-account { width: 22%; }
  .tally__col-amount { width: 16%; }
  .tally__col-sign { width: 21%; }
  .tally__row-no {
    text-align: center;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .tally__footer td {
    font-weight: 700;
    height: 18px;
  }
  .tally__grand-label {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.72rem;
  }
  @media print {
    html, body, .tally {
      height: auto;
      overflow: hidden;
    }
    .tally__table {
      page-break-inside: avoid;
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

export function buildDailyTallySheetHtml(options: DailyTallySheetOptions = {}): string {
  const company = options.companyName?.trim() || APP_BRAND_NAME;
  const mobilizer = options.mobilizerName?.trim() || "";
  const dateLabel = options.dateLabel?.trim() || "";
  const rowCount = Math.max(1, Math.min(options.rowCount ?? 40, 80));

  const rows = Array.from({ length: rowCount }, (_, index) => {
    const no = index + 1;
    return `<tr>
      <td class="tally__row-no">${no}</td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Daily Tally Sheet</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <article class="tally">
    <h1 class="tally__company">${escapeHtml(company)}</h1>
    <div class="tally__meta">
      <div class="tally__meta-item">
        <span class="tally__meta-label">Name of mobilizer</span>
        <span class="tally__meta-line">${escapeHtml(mobilizer)}</span>
      </div>
      <div class="tally__meta-item">
        <span class="tally__meta-label">Date</span>
        <span class="tally__meta-line">${escapeHtml(dateLabel)}</span>
      </div>
    </div>
    <p class="tally__title">Daily tally sheet</p>
    <table class="tally__table">
      <thead>
        <tr>
          <th class="tally__col-no">No</th>
          <th class="tally__col-name">Name of client</th>
          <th class="tally__col-account">Account no</th>
          <th class="tally__col-amount">Amount</th>
          <th class="tally__col-sign">Signature</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr class="tally__footer">
          <td colspan="3" class="tally__grand-label">Grand total</td>
          <td></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </article>
</body>
</html>`;
}
